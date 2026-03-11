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
 *   supervisor-checks.ts       — standards loading, deterministic verification
 *   supervisor-bus.ts          — bus signal publishing
 *   supervisor-llm.ts          — LLM review process lifecycle
 *   mind-supervisor.ts         — this file: orchestrator entry point
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { MindsEventType } from "../../transport/minds-events.ts";
import { killPane as killPaneImpl } from "../tmux-utils.ts";

// Internal imports (used by runMindSupervisor below)
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
  errorMessage,
} from "./supervisor-types.ts";
import { createSupervisorStateMachine } from "./supervisor-state-machine.ts";
import { buildAgentReviewPrompt, parseReviewVerdict, buildFeedbackContent } from "./supervisor-review.ts";
import { writeMindAgentFile, cleanupMindAgentFile } from "./supervisor-agent.ts";
import {
  spawnDrone as spawnDroneImpl,
  relaunchDroneInWorktree as relaunchDroneImpl,
  installDroneStopHook as installDroneStopHookImpl,
  waitForDroneCompletion as waitForDroneCompletionImpl,
  buildSupervisorDroneBrief,
} from "./supervisor-drone.ts";
import { loadStandards, runDeterministicChecksDefault } from "./supervisor-checks.ts";
import { publishSignalDefault } from "./supervisor-bus.ts";
import { callLlmReviewDefault } from "./supervisor-llm.ts";

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
// Force-rejection helper (deterministic checks override LLM verdict)
// ---------------------------------------------------------------------------

function applyForceRejections(verdict: ReviewVerdict, checks: CheckResults): void {
  if (!checks.testsPass && verdict.approved) {
    verdict.approved = false;
    verdict.findings.push({
      file: "(tests)",
      line: 0,
      severity: "error",
      message: "Tests are failing. Fix all test failures before approval.",
    });
  }
  if (checks.boundaryPass === false && verdict.approved) {
    verdict.approved = false;
    verdict.findings.push(...(checks.boundaryFindings ?? []));
  }
  if (checks.contractsPass === false && verdict.approved) {
    verdict.approved = false;
    verdict.findings.push(...(checks.contractFindings ?? []));
  }
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
          const msg = `Failed to spawn drone: ${errorMessage(err)}`;
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
          const msg = `Failed to re-launch drone: ${errorMessage(err)}`;
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
      const checks = deps.runDeterministicChecks(currentWorktree, config.baseBranch, config.mindName, config.tasks);

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

      // Write the Mind agent file for this review iteration
      writeMindAgentFile({
        mindName: config.mindName,
        worktreePath: currentWorktree,
        repoRoot: config.repoRoot,
        standards,
        ownsFiles: checks.ownsFiles ?? [],
        previousFeedback,
        iteration,
      });

      // Build lean prompt (no standards — agent file has them)
      const prompt = buildAgentReviewPrompt({
        diff: checks.diff,
        testOutput: checks.testOutput,
        tasks: config.tasks,
        iteration,
      });

      let verdict: ReviewVerdict;
      try {
        const rawResponse = await deps.callLlmReview(prompt, reviewTimeoutMs, {
          worktreePath: currentWorktree,
          agentName: "Mind",
        });
        verdict = parseReviewVerdict(rawResponse);
      } catch (err) {
        // LLM call failed or timed out -- treat as rejection with error finding
        verdict = {
          approved: false,
          findings: [{
            file: "(review)",
            line: 0,
            severity: "error",
            message: `LLM review failed: ${errorMessage(err)}`,
          }],
        };
      }

      // Deterministic checks override LLM verdict (tests, boundary, contracts)
      applyForceRejections(verdict, checks);

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
    const msg = `Supervisor error: ${errorMessage(err)}`;
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

    // Clean up Mind agent file
    const isPlaceholderWorktree = !currentWorktree || currentWorktree.startsWith("(");
    if (!isPlaceholderWorktree) {
      cleanupMindAgentFile(currentWorktree);
    }

    // Clean up sentinel file if present (skip if worktree was never resolved)
    if (!isPlaceholderWorktree) {
      const sentinelPath = join(currentWorktree, SENTINEL_FILENAME);
      if (existsSync(sentinelPath)) {
        try { rmSync(sentinelPath, { force: true }); } catch { /* ignore */ }
      }
    }
  }

  return result;
}
