/**
 * mind-supervisor.ts -- Deterministic Mind supervisor orchestrator.
 *
 * Replaces the LLM-driven Mind (Claude Code Opus in a tmux pane reading
 * a 300-line CLAUDE.md operating manual). This TypeScript process handles
 * ALL control flow deterministically:
 *
 *   1. Publish MIND_STARTED via bus
 *   2. Spawn Drone via drone-pane.ts (tmux pane with Claude Code Sonnet)
 *   3. Wait for Drone completion (sentinel file via Stop hook)
 *   4. Run deterministic checks: git diff, bun test (scoped)
 *   5. Publish REVIEW_STARTED
 *   6. Call `claude -p` with structured review prompt (diff + checklist -> JSON verdict)
 *   7. If approved: publish MIND_COMPLETE, exit
 *   8. If rejected: write REVIEW-FEEDBACK-{n}.md, re-launch drone IN SAME WORKTREE, go to step 3
 *   9. Max iterations then approve with warnings
 *
 * The LLM is only invoked for the one thing that requires judgment: code review.
 *
 * Module structure:
 *   supervisor-types.ts        — enums, interfaces, constants
 *   supervisor-state-machine.ts — state machine with validated transitions
 *   supervisor-review.ts       — review prompt, verdict parsing, feedback
 *   supervisor-drone.ts        — drone spawning, re-launch, completion detection
 *   mind-supervisor.ts         — this file: orchestrator entry point
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { publishMindsEvent } from "../transport/publish-event.ts";
import { MindsEventType } from "../transport/minds-events.ts";
import { resolveMindsDir } from "../shared/paths.js";
import { killPane as killPaneImpl } from "./tmux-utils.ts";
import { formatTaskList } from "../cli/lib/drone-brief.ts";

// Re-export types and functions from sub-modules for backward compatibility
export {
  SupervisorState,
  type SupervisorConfig,
  type SupervisorDeps,
  type CheckResults,
  type ReviewFinding,
  type ReviewVerdict,
  type StateMachine,
  type SupervisorResult,
  DEFAULT_REVIEW_TIMEOUT_MS,
  SENTINEL_FILENAME,
} from "./supervisor-types.ts";

export { createSupervisorStateMachine } from "./supervisor-state-machine.ts";
export { buildReviewPrompt, parseReviewVerdict, buildFeedbackContent } from "./supervisor-review.ts";
export type { ReviewPromptParams } from "./supervisor-review.ts";
export { installDroneStopHook } from "./supervisor-drone.ts";

// Internal imports (not re-exported)
import {
  SupervisorState,
  type SupervisorConfig,
  type SupervisorDeps,
  type CheckResults,
  type ReviewFinding,
  type ReviewVerdict,
  type SupervisorResult,
  DEFAULT_REVIEW_TIMEOUT_MS,
  SENTINEL_FILENAME,
} from "./supervisor-types.ts";
import { createSupervisorStateMachine } from "./supervisor-state-machine.ts";
import { buildReviewPrompt, parseReviewVerdict, buildFeedbackContent } from "./supervisor-review.ts";
import {
  spawnDrone as spawnDroneImpl,
  relaunchDroneInWorktree as relaunchDroneImpl,
  installDroneStopHook as installDroneStopHookImpl,
  waitForDroneCompletion as waitForDroneCompletionImpl,
} from "./supervisor-drone.ts";

// ---------------------------------------------------------------------------
// Bus Signal Publishing
// ---------------------------------------------------------------------------

async function publishSignalDefault(
  busUrl: string,
  channel: string,
  type: MindsEventType,
  mindName: string,
  waveId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const ticketId = channel.replace(/^minds-/, "");
  await publishMindsEvent(busUrl, channel, {
    type,
    source: "supervisor",
    ticketId,
    payload: { mindName, waveId, ...extra },
  });
}

// ---------------------------------------------------------------------------
// Load Engineering Standards
// ---------------------------------------------------------------------------

function loadStandards(repoRoot: string): string {
  const mindsDir = resolveMindsDir(repoRoot);
  const standardsPath = join(mindsDir, "STANDARDS.md");
  const projectStandardsPath = join(mindsDir, "STANDARDS-project.md");

  let standards = "";
  if (existsSync(standardsPath)) {
    standards = readFileSync(standardsPath, "utf-8");
  }
  if (existsSync(projectStandardsPath)) {
    standards += "\n\n" + readFileSync(projectStandardsPath, "utf-8");
  }
  return standards;
}

// ---------------------------------------------------------------------------
// Build Drone Brief
// ---------------------------------------------------------------------------

function buildSupervisorDroneBrief(config: SupervisorConfig, feedbackFile?: string): string {
  const taskList = formatTaskList(config.tasks);
  const mindsDir = resolveMindsDir(config.repoRoot);
  const testPath = `${mindsDir}/${config.mindName}/`;

  const depsSection = config.dependencies.length > 0
    ? `\n---\n\n## Dependencies\n\n${config.dependencies.map((d) => `@${d}`).join(", ")} -- completed and merged in previous waves.\n`
    : "";

  const feedbackSection = feedbackFile
    ? `\n---\n\n## Review Feedback\n\nRead ${feedbackFile} at the worktree root for issues from the previous review. Fix all items and check them off.\n`
    : "";

  return `---
name: Drone Brief
role: Implementation tasks for the Drone code worker
scope: Complete all tasks, commit when done
---

# Drone Brief: @${config.mindName}

| Field | Value |
|-------|-------|
| **Ticket** | ${config.ticketId} |
| **Wave** | ${config.waveId} |
| **Feature** | ${config.featureDir} |

---

## Tasks

${taskList}

---

## Completion Criteria

All tasks above are checked off AND all tests pass.
${depsSection}${feedbackSection}
## Instructions

1. Read and understand each task above.
2. Implement ALL tasks in order (unless marked [P] for parallel-safe).
3. Write tests for each change (TDD: red -> green -> refactor).
4. Run \`bun test ${testPath}\` to verify your changes pass.
5. Commit your work with a descriptive message referencing ${config.ticketId}.
6. When done, exit cleanly. Do NOT retry on failure -- report and stop.
`;
}

// ---------------------------------------------------------------------------
// Deterministic Checks (git diff + bun test)
// ---------------------------------------------------------------------------

function runDeterministicChecksDefault(worktreePath: string, baseBranch: string, mindName: string): CheckResults {
  const findings: ReviewFinding[] = [];

  // Get diff relative to base branch
  const diffProc = Bun.spawnSync(
    ["git", "-C", worktreePath, "diff", `${baseBranch}...HEAD`],
    { stdout: "pipe", stderr: "pipe" }
  );
  let diff = new TextDecoder().decode(diffProc.stdout);

  if (diffProc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(diffProc.stderr);
    findings.push({
      file: "(git diff)",
      line: 0,
      severity: "error",
      message: `git diff failed (exit ${diffProc.exitCode}): ${stderr.trim() || "unknown error"}. Review cannot proceed on an empty diff.`,
    });
    diff = "";
  }

  // Run scoped tests
  const testProc = Bun.spawnSync(
    ["bun", "test", `minds/${mindName}/`],
    { cwd: worktreePath, stdout: "pipe", stderr: "pipe", timeout: 120_000 }
  );
  const testStdout = new TextDecoder().decode(testProc.stdout);
  const testStderr = new TextDecoder().decode(testProc.stderr);
  const testOutput = testStdout + (testStderr ? `\n${testStderr}` : "");
  const testsPass = testProc.exitCode === 0;

  return { diff, testOutput, testsPass, findings };
}

// ---------------------------------------------------------------------------
// LLM Review (claude -p) with timeout — Item 2: proper process cleanup
// ---------------------------------------------------------------------------

async function callLlmReviewDefault(prompt: string, timeoutMs: number = DEFAULT_REVIEW_TIMEOUT_MS): Promise<string> {
  const proc = Bun.spawn(
    ["claude", "-p", "--model", "sonnet", "--output-format", "text"],
    {
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  // Race the process against a timeout, clearing the timer on completion
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Review timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  let output: string, stderr: string, exitCode: number;
  try {
    [output, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      timeoutPromise,
    ]) as [string, string, number];
  } catch (err) {
    // On ANY error (timeout or read failure), ensure the process is killed.
    // First try SIGTERM, then escalate to SIGKILL after a short window.
    try { proc.kill("SIGTERM"); } catch { /* already dead */ }
    // Give the process 2 seconds to die from SIGTERM before escalating
    const killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 2000);
    // Wait for the process to actually exit so we don't orphan it
    try { await proc.exited; } catch { /* ignore */ }
    clearTimeout(killTimer);
    throw err;
  } finally {
    clearTimeout(timeoutTimer);
  }

  if (exitCode !== 0) {
    throw new Error(`claude -p failed (exit ${exitCode}): ${stderr}`);
  }

  return output.trim();
}

// ---------------------------------------------------------------------------
// Default dependencies (production implementations)
// ---------------------------------------------------------------------------

function createDefaultDeps(): SupervisorDeps {
  return {
    spawnDrone: spawnDroneImpl,
    relaunchDroneInWorktree: relaunchDroneImpl,
    waitForDroneCompletion: waitForDroneCompletionImpl,
    publishSignal: publishSignalDefault,
    runDeterministicChecks: runDeterministicChecksDefault,
    callLlmReview: callLlmReviewDefault,
    installDroneStopHook: installDroneStopHookImpl,
    killPane: killPaneImpl,
  };
}

// ---------------------------------------------------------------------------
// Main Supervisor Entry Point
// ---------------------------------------------------------------------------

export async function runMindSupervisor(
  config: SupervisorConfig,
  depsOverride?: Partial<SupervisorDeps>,
): Promise<SupervisorResult> {
  if (config.maxIterations < 1) {
    throw new Error(`maxIterations must be >= 1, got ${config.maxIterations}`);
  }

  const deps = { ...createDefaultDeps(), ...depsOverride };

  const sm = createSupervisorStateMachine(config);
  const result: SupervisorResult = {
    ok: false,
    iterations: 0,
    approved: false,
    approvedWithWarnings: false,
    findings: [],
    allPaneIds: [],
    worktree: config.worktreePath,
    branch: "",
    errors: [],
  };

  const allFindings: ReviewFinding[] = [];
  const allSpawnedPanes: string[] = [];

  let currentDronePane: string | undefined;
  let currentWorktree = config.worktreePath;
  let currentBranch = "";

  const reviewTimeoutMs = config.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
  const standards = loadStandards(config.repoRoot);

  try {
    // ---- Step 1: Publish MIND_STARTED ----
    console.log(`[supervisor] @${config.mindName}: Starting (max ${config.maxIterations} iterations)`);
    await deps.publishSignal(
      config.busUrl, config.channel,
      MindsEventType.MIND_STARTED,
      config.mindName, config.waveId,
    );

    // ---- Main loop ----
    while (!sm.isMaxIterations()) {
      // ---- Step 2: Spawn or re-launch Drone ----
      sm.transition(SupervisorState.DRONE_RUNNING);
      const iteration = sm.incrementIteration();
      result.iterations = iteration;

      if (iteration === 1) {
        // First iteration: spawn drone via drone-pane.ts (creates worktree)
        console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- spawning drone`);

        const briefContent = buildSupervisorDroneBrief(config);

        let drone: Awaited<ReturnType<typeof spawnDroneImpl>>;
        try {
          drone = await deps.spawnDrone(config, briefContent);
        } catch (err) {
          const msg = `Failed to spawn drone: ${(err as Error).message}`;
          console.error(`[supervisor] @${config.mindName}: ${msg}`);
          result.errors.push(msg);
          sm.transition(SupervisorState.FAILED);
          break;
        }

        currentDronePane = drone.paneId;
        allSpawnedPanes.push(drone.paneId);
        currentWorktree = drone.worktree;
        currentBranch = drone.branch;
        result.dronePaneId = drone.paneId;
        result.worktree = drone.worktree;
        result.branch = drone.branch;

        // Install the Stop hook for sentinel-based completion detection
        deps.installDroneStopHook(drone.worktree);

        console.log(`[supervisor] @${config.mindName}: Drone spawned in pane ${drone.paneId}`);
      } else {
        // Subsequent iterations: re-launch drone in the SAME worktree
        console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- re-launching drone in existing worktree`);

        const feedbackFile = `REVIEW-FEEDBACK-${iteration - 1}.md`;
        const briefContent = buildSupervisorDroneBrief(config, feedbackFile);

        try {
          const newPaneId = deps.relaunchDroneInWorktree({
            oldPaneId: currentDronePane!,
            callerPane: config.callerPane,
            worktreePath: currentWorktree,
            briefContent,
            busUrl: config.busUrl,
            mindName: config.mindName,
          });
          currentDronePane = newPaneId;
          allSpawnedPanes.push(newPaneId);
          result.dronePaneId = newPaneId;

          // Reinstall the Stop hook (sentinel file was consumed by previous iteration)
          deps.installDroneStopHook(currentWorktree);
        } catch (err) {
          const msg = `Failed to re-launch drone: ${(err as Error).message}`;
          console.error(`[supervisor] @${config.mindName}: ${msg}`);
          result.errors.push(msg);
          sm.transition(SupervisorState.FAILED);
          break;
        }

        console.log(`[supervisor] @${config.mindName}: Drone re-launched in pane ${currentDronePane}`);
      }

      // ---- Step 3: Wait for Drone completion ----
      const completion = await deps.waitForDroneCompletion(currentDronePane!, currentWorktree, config.droneTimeoutMs);
      if (!completion.ok) {
        const msg = completion.error ?? "Drone failed";
        console.error(`[supervisor] @${config.mindName}: ${msg}`);
        result.errors.push(msg);
        deps.killPane(currentDronePane!);
        sm.transition(SupervisorState.FAILED);
        break;
      }

      console.log(`[supervisor] @${config.mindName}: Drone completed, running checks`);

      // ---- Step 4: Deterministic checks ----
      sm.transition(SupervisorState.CHECKING);
      const checks = deps.runDeterministicChecks(currentWorktree, config.baseBranch, config.mindName);

      // ---- Step 5: Publish REVIEW_STARTED ----
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.REVIEW_STARTED,
        config.mindName, config.waveId,
        { iteration },
      );

      // ---- Step 6: LLM Review ----
      sm.transition(SupervisorState.REVIEWING);
      console.log(`[supervisor] @${config.mindName}: Reviewing (iteration ${iteration})`);

      // Read ALL previous feedback files for the reviewer's context
      let previousFeedback: string | undefined;
      if (iteration > 1) {
        const feedbackParts: string[] = [];
        for (let i = 1; i < iteration; i++) {
          const fbPath = join(currentWorktree, `REVIEW-FEEDBACK-${i}.md`);
          if (existsSync(fbPath)) {
            feedbackParts.push(readFileSync(fbPath, "utf-8"));
          }
        }
        if (feedbackParts.length > 0) {
          previousFeedback = feedbackParts.join("\n\n---\n\n");
        }
      }

      const prompt = buildReviewPrompt({
        diff: checks.diff,
        testOutput: checks.testOutput,
        standards,
        tasks: config.tasks,
        iteration,
        previousFeedback,
      });

      let verdict: ReviewVerdict;
      try {
        const rawResponse = await deps.callLlmReview(prompt, reviewTimeoutMs);
        verdict = parseReviewVerdict(rawResponse);
      } catch (err) {
        // LLM call failed or timed out -- treat as rejection with error finding
        verdict = {
          approved: false,
          findings: [{
            file: "(review)",
            line: 0,
            severity: "error",
            message: `LLM review failed: ${(err as Error).message}`,
          }],
        };
      }

      // Force rejection if tests fail, regardless of LLM verdict
      if (!checks.testsPass && verdict.approved) {
        verdict.approved = false;
        verdict.findings.push({
          file: "(tests)",
          line: 0,
          severity: "error",
          message: "Tests are failing. Fix all test failures before approval.",
        });
      }

      // Accumulate findings across all iterations, tagging each with its iteration
      for (const finding of verdict.findings) {
        allFindings.push({ ...finding, iteration });
      }
      result.findings = allFindings;

      // ---- Step 7: Verdict ----
      if (verdict.approved) {
        console.log(`[supervisor] @${config.mindName}: APPROVED on iteration ${iteration}`);
        sm.transition(SupervisorState.DONE);
        result.ok = true;
        result.approved = true;
        break;
      }

      // Check if we're at max iterations after this rejection
      if (sm.isMaxIterations()) {
        console.log(
          `[supervisor] @${config.mindName}: Max iterations (${config.maxIterations}) reached. Approving with warnings.`
        );
        sm.transition(SupervisorState.DONE);
        result.ok = true;
        result.approved = true;
        result.approvedWithWarnings = true;
        break;
      }

      // ---- Step 8: Write feedback to the SAME worktree ----
      console.log(
        `[supervisor] @${config.mindName}: REJECTED (${verdict.findings.length} findings). Writing feedback.`
      );

      const testFailures = !checks.testsPass ? checks.testOutput : undefined;
      const feedbackContent = buildFeedbackContent(iteration, verdict.findings, testFailures);
      writeFileSync(join(currentWorktree, `REVIEW-FEEDBACK-${iteration}.md`), feedbackContent);

      // Publish REVIEW_FEEDBACK signal
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.REVIEW_FEEDBACK,
        config.mindName, config.waveId,
        { iteration, findingsCount: verdict.findings.length },
      );

      // Loop continues: relaunchDroneInWorktree at the top of the next iteration
    }

    // Handle edge case where loop exits due to isMaxIterations at START
    if (sm.getState() === SupervisorState.INIT) {
      sm.transition(SupervisorState.DONE);
      result.ok = true;
      result.approved = true;
      result.approvedWithWarnings = true;
    }

    // ---- Publish MIND_COMPLETE or MIND_FAILED ----
    if (result.ok) {
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_COMPLETE,
        config.mindName, config.waveId,
        { iterations: result.iterations, approvedWithWarnings: result.approvedWithWarnings },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_COMPLETE published`);
    } else {
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_FAILED,
        config.mindName, config.waveId,
        { iterations: result.iterations, error: result.errors.join("; ") },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_FAILED published`);
    }

  } catch (err) {
    const msg = `Supervisor error: ${(err as Error).message}`;
    console.error(`[supervisor] @${config.mindName}: ${msg}`);
    result.errors.push(msg);
    result.ok = false;
    // Publish MIND_FAILED from catch block so the bus listener doesn't wait
    try {
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_FAILED,
        config.mindName, config.waveId,
        { error: msg },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_FAILED published (from catch)`);
    } catch {
      // Best effort -- bus may be down too
    }
  } finally {
    // Record all tracked panes in the result for observability
    result.allPaneIds = [...allSpawnedPanes];

    // Cleanup: kill ALL spawned drone panes (not just the last one)
    for (const paneId of allSpawnedPanes) {
      deps.killPane(paneId);
    }

    // Clean up sentinel file if present (skip if worktree was never resolved)
    const isPlaceholderWorktree = !currentWorktree || currentWorktree.startsWith("(");
    if (!isPlaceholderWorktree) {
      const sentinelPath = join(currentWorktree, SENTINEL_FILENAME);
      if (existsSync(sentinelPath)) {
        try { Bun.spawnSync(["rm", "-f", sentinelPath]); } catch { /* ignore */ }
      }
    }
  }

  return result;
}
