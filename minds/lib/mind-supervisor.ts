/**
 * mind-supervisor.ts -- Deterministic Mind supervisor state machine.
 *
 * Replaces the LLM-driven Mind (Claude Code Opus in a tmux pane reading
 * a 300-line CLAUDE.md operating manual). This TypeScript process handles
 * ALL control flow deterministically:
 *
 *   1. Publish MIND_STARTED via bus
 *   2. Spawn Drone via drone-pane.ts (tmux pane with Claude Code Sonnet)
 *   3. Wait for Drone completion (poll tmux pane process)
 *   4. Run deterministic checks: git diff, bun test (scoped)
 *   5. Publish REVIEW_STARTED
 *   6. Call `claude -p` with structured review prompt (diff + checklist -> JSON verdict)
 *   7. If approved: publish MIND_COMPLETE, exit
 *   8. If rejected: write REVIEW-FEEDBACK-{n}.md, re-launch drone, go to step 3
 *   9. Max iterations then approve with warnings
 *
 * The LLM is only invoked for the one thing that requires judgment: code review.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { publishMindsEvent } from "../transport/publish-event.ts";
import { MindsEventType } from "../transport/minds-events.ts";
import { resolveMindsDir } from "../shared/paths.js";
import type { MindTask } from "../cli/lib/implement-types.ts";
import { formatTaskList } from "../cli/lib/drone-brief.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum SupervisorState {
  INIT = "INIT",
  DRONE_RUNNING = "DRONE_RUNNING",
  CHECKING = "CHECKING",
  REVIEWING = "REVIEWING",
  DONE = "DONE",
  FAILED = "FAILED",
}

export interface SupervisorConfig {
  mindName: string;
  ticketId: string;
  waveId: string;
  tasks: MindTask[];
  repoRoot: string;
  busUrl: string;
  busPort: number;
  channel: string;
  worktreePath: string;
  baseBranch: string;
  callerPane: string;
  mindsSourceDir: string;
  featureDir: string;
  dependencies: string[];
  maxIterations: number;
  droneTimeoutMs: number;
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
}

export interface ReviewVerdict {
  approved: boolean;
  findings: ReviewFinding[];
}

export interface StateMachine {
  getState(): SupervisorState;
  transition(to: SupervisorState): void;
  getIteration(): number;
  incrementIteration(): number;
  isMaxIterations(): boolean;
}

export interface SupervisorResult {
  ok: boolean;
  iterations: number;
  approved: boolean;
  approvedWithWarnings: boolean;
  findings: ReviewFinding[];
  dronePaneId?: string;
  worktree: string;
  branch: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<SupervisorState, SupervisorState[]> = {
  [SupervisorState.INIT]: [SupervisorState.DRONE_RUNNING, SupervisorState.FAILED],
  [SupervisorState.DRONE_RUNNING]: [SupervisorState.CHECKING, SupervisorState.FAILED],
  [SupervisorState.CHECKING]: [SupervisorState.REVIEWING, SupervisorState.FAILED],
  [SupervisorState.REVIEWING]: [SupervisorState.DONE, SupervisorState.DRONE_RUNNING, SupervisorState.FAILED],
  [SupervisorState.DONE]: [],
  [SupervisorState.FAILED]: [],
};

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export function createSupervisorStateMachine(config: SupervisorConfig): StateMachine {
  let state = SupervisorState.INIT;
  let iteration = 0;

  return {
    getState() {
      return state;
    },

    transition(to: SupervisorState) {
      const allowed = VALID_TRANSITIONS[state];
      if (!allowed.includes(to)) {
        throw new Error(
          `Invalid transition from ${state} to ${to}. Allowed: [${allowed.join(", ")}]`
        );
      }
      state = to;
    },

    getIteration() {
      return iteration;
    },

    incrementIteration() {
      iteration++;
      return iteration;
    },

    isMaxIterations() {
      return iteration >= config.maxIterations;
    },
  };
}

// ---------------------------------------------------------------------------
// Review Prompt Construction
// ---------------------------------------------------------------------------

const MAX_DIFF_CHARS = 50_000;

export interface ReviewPromptParams {
  diff: string;
  testOutput: string;
  standards: string;
  tasks: MindTask[];
  iteration: number;
  previousFeedback?: string;
}

export function buildReviewPrompt(params: ReviewPromptParams): string {
  const { diff, testOutput, standards, tasks, iteration, previousFeedback } = params;

  // Truncate very large diffs to avoid exceeding context limits
  let truncatedDiff = diff;
  if (diff.length > MAX_DIFF_CHARS) {
    truncatedDiff = diff.slice(0, MAX_DIFF_CHARS) + "\n\n[truncated — diff exceeded 50k chars]";
  }

  const taskList = tasks
    .map((t) => `- ${t.id}: ${t.description}`)
    .join("\n");

  const previousSection = previousFeedback
    ? `\n## Previous Feedback (for context)\n\n${previousFeedback}\n`
    : "";

  return `You are reviewing code changes for iteration ${iteration} of a drone implementation cycle.

## Tasks Assigned

${taskList}

## Git Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Test Results

\`\`\`
${testOutput}
\`\`\`

## Engineering Standards

${standards}
${previousSection}
## Instructions

Review the diff against the tasks and engineering standards. Check:
1. All tasks are implemented
2. No files modified outside the mind's boundary
3. No duplicated logic
4. All new exported functions have tests
5. All tests pass (check the test output above)
6. No lint errors or dead code
7. Error messages include context

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:

\`\`\`json
{
  "approved": true | false,
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "error" | "warning",
      "message": "Description of the issue"
    }
  ]
}
\`\`\`

If approved, findings should be an empty array.
If any issue is found (even minor ones like unused imports), set approved to false and list all findings.`;
}

// ---------------------------------------------------------------------------
// Verdict Parsing
// ---------------------------------------------------------------------------

export function parseReviewVerdict(raw: string): ReviewVerdict {
  // Strategy 1: Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    return normalizeVerdict(parsed);
  } catch {
    // Not direct JSON
  }

  // Strategy 2: Extract from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return normalizeVerdict(parsed);
    } catch {
      // Code block wasn't valid JSON
    }
  }

  // Strategy 3: Find JSON object in the text
  const jsonMatch = raw.match(/\{[\s\S]*"approved"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeVerdict(parsed);
    } catch {
      // Matched something that looked like JSON but wasn't
    }
  }

  // Fallback: unparseable response => treat as rejection
  return {
    approved: false,
    findings: [
      {
        file: "(review)",
        line: 0,
        severity: "error",
        message: `Failed to parse review verdict from LLM response. Raw response starts with: "${raw.slice(0, 100)}..."`,
      },
    ],
  };
}

function normalizeVerdict(parsed: Record<string, unknown>): ReviewVerdict {
  const approved = parsed.approved === true;
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings: ReviewFinding[] = rawFindings.map((f: Record<string, unknown>) => ({
    file: String(f.file ?? "(unknown)"),
    line: typeof f.line === "number" ? f.line : 0,
    severity: f.severity === "warning" ? "warning" : "error",
    message: String(f.message ?? "(no message)"),
  }));

  return { approved, findings };
}

// ---------------------------------------------------------------------------
// Feedback File Generation
// ---------------------------------------------------------------------------

export function buildFeedbackContent(
  round: number,
  findings: ReviewFinding[],
  testFailures?: string,
): string {
  let content = `# Review Feedback (Round ${round})\n\n`;

  if (testFailures) {
    content += `## Test Failures\n\n\`\`\`\n${testFailures}\n\`\`\`\n\n`;
  }

  if (findings.length > 0) {
    content += `## Findings\n\n`;
    for (const f of findings) {
      const severity = f.severity === "error" ? "[ERROR]" : "[WARNING]";
      content += `- [ ] ${severity} ${f.file}:${f.line} — ${f.message}\n`;
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// Drone Spawning (wrapper around drone-pane.ts)
// ---------------------------------------------------------------------------

interface DroneSpawnResult {
  paneId: string;
  worktree: string;
  branch: string;
}

async function spawnDrone(config: SupervisorConfig, briefContent: string): Promise<DroneSpawnResult> {
  const dronePanePath = join(config.mindsSourceDir, "lib", "drone-pane.ts");

  // Write the drone brief to a temp file
  const stateDir = join(resolveMindsDir(config.repoRoot), "state");
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  const briefPath = join(stateDir, `drone-brief-${config.mindName}-${config.waveId}.md`);
  writeFileSync(briefPath, briefContent);

  const args = [
    "bun", dronePanePath,
    "--mind", config.mindName,
    "--ticket", config.ticketId,
    "--pane", config.callerPane,
    "--brief-file", briefPath,
    "--bus-url", config.busUrl,
    "--channel", config.channel,
    "--wave-id", config.waveId,
    "--base", config.baseBranch,
  ];

  const proc = Bun.spawn(args, {
    cwd: config.repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`drone-pane.ts failed for @${config.mindName}: ${stderr}`);
  }

  let result: { drone_pane: string; worktree: string; branch: string };
  try {
    result = JSON.parse(output.trim());
  } catch {
    throw new Error(`drone-pane.ts returned invalid JSON: ${output}`);
  }

  return {
    paneId: result.drone_pane,
    worktree: result.worktree,
    branch: result.branch,
  };
}

// ---------------------------------------------------------------------------
// Drone Completion Detection
// ---------------------------------------------------------------------------

/**
 * Poll a tmux pane to detect when the Claude Code process has exited.
 *
 * Detection strategy: Check if the pane's foreground process (the shell's
 * child) is still a `claude` or `bun` process. When Claude Code exits,
 * the pane either shows a shell prompt (zsh/bash) or the pane itself dies.
 *
 * We use `tmux list-panes -t {paneId} -F '#{pane_pid}'` to get the shell PID,
 * then check if that shell has a child process that's still claude/bun.
 */
async function waitForDroneCompletion(
  paneId: string,
  timeoutMs: number,
  pollIntervalMs: number = 5000,
): Promise<{ ok: boolean; error?: string }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Check if pane still exists
    const paneCheck = Bun.spawnSync(
      ["tmux", "list-panes", "-t", paneId, "-F", "#{pane_pid}"],
      { stdout: "pipe", stderr: "pipe" }
    );

    if (paneCheck.exitCode !== 0) {
      // Pane no longer exists — drone finished (pane was killed or exited)
      return { ok: true };
    }

    const shellPid = new TextDecoder().decode(paneCheck.stdout).trim();
    if (!shellPid) {
      return { ok: true };
    }

    // Check if the shell has any child processes (claude/bun)
    const childCheck = Bun.spawnSync(
      ["pgrep", "-P", shellPid],
      { stdout: "pipe", stderr: "pipe" }
    );

    if (childCheck.exitCode !== 0) {
      // No child processes — Claude Code has exited
      return { ok: true };
    }

    // Also check the last lines of the pane for completion indicators
    const captureResult = Bun.spawnSync(
      ["tmux", "capture-pane", "-t", paneId, "-p", "-S", "-5"],
      { stdout: "pipe", stderr: "pipe" }
    );

    if (captureResult.exitCode === 0) {
      const lastLines = new TextDecoder().decode(captureResult.stdout);
      // Claude Code shows the $ prompt when done, or shows specific exit messages
      if (/\$\s*$/.test(lastLines.trim()) || /claude.*exited/i.test(lastLines)) {
        return { ok: true };
      }
    }

    await Bun.sleep(pollIntervalMs);
  }

  return { ok: false, error: `Drone timed out after ${timeoutMs}ms` };
}

// ---------------------------------------------------------------------------
// Deterministic Checks (git diff + bun test)
// ---------------------------------------------------------------------------

interface CheckResults {
  diff: string;
  testOutput: string;
  testsPass: boolean;
}

function runDeterministicChecks(worktreePath: string, baseBranch: string, mindName: string): CheckResults {
  // Get diff relative to base branch
  const diffProc = Bun.spawnSync(
    ["git", "-C", worktreePath, "diff", `${baseBranch}...HEAD`],
    { stdout: "pipe", stderr: "pipe" }
  );
  const diff = new TextDecoder().decode(diffProc.stdout);

  // Run scoped tests
  const testProc = Bun.spawnSync(
    ["bun", "test", `minds/${mindName}/`],
    { cwd: worktreePath, stdout: "pipe", stderr: "pipe", timeout: 120_000 }
  );
  const testStdout = new TextDecoder().decode(testProc.stdout);
  const testStderr = new TextDecoder().decode(testProc.stderr);
  const testOutput = testStdout + (testStderr ? `\n${testStderr}` : "");
  const testsPass = testProc.exitCode === 0;

  return { diff, testOutput, testsPass };
}

// ---------------------------------------------------------------------------
// LLM Review (claude -p)
// ---------------------------------------------------------------------------

async function callLlmReview(prompt: string): Promise<string> {
  const proc = Bun.spawn(
    ["claude", "-p", "--model", "sonnet", "--output-format", "text"],
    {
      stdin: new Response(prompt),
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`claude -p failed (exit ${exitCode}): ${stderr}`);
  }

  return output.trim();
}

// ---------------------------------------------------------------------------
// Bus Signal Publishing
// ---------------------------------------------------------------------------

async function publishSignal(
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
// Kill tmux pane helper
// ---------------------------------------------------------------------------

function killPane(paneId: string): void {
  try {
    Bun.spawnSync(["tmux", "kill-pane", "-t", paneId], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Pane may already be gone
  }
}

// ---------------------------------------------------------------------------
// Main Supervisor Entry Point
// ---------------------------------------------------------------------------

export async function runMindSupervisor(config: SupervisorConfig): Promise<SupervisorResult> {
  const sm = createSupervisorStateMachine(config);
  const result: SupervisorResult = {
    ok: false,
    iterations: 0,
    approved: false,
    approvedWithWarnings: false,
    findings: [],
    worktree: config.worktreePath,
    branch: "",
    errors: [],
  };

  let currentDronePane: string | undefined;
  let currentWorktree = config.worktreePath;
  let currentBranch = "";

  const standards = loadStandards(config.repoRoot);

  try {
    // ---- Step 1: Publish MIND_STARTED ----
    console.log(`[supervisor] @${config.mindName}: Starting (max ${config.maxIterations} iterations)`);
    await publishSignal(
      config.busUrl, config.channel,
      MindsEventType.MIND_STARTED,
      config.mindName, config.waveId,
    );

    // ---- Main loop ----
    while (!sm.isMaxIterations()) {
      // ---- Step 2: Spawn Drone ----
      sm.transition(SupervisorState.DRONE_RUNNING);
      const iteration = sm.incrementIteration();
      result.iterations = iteration;
      console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- spawning drone`);

      const feedbackFile = iteration > 1 ? `REVIEW-FEEDBACK-${iteration - 1}.md` : undefined;
      const briefContent = buildSupervisorDroneBrief(config, feedbackFile);

      let drone: DroneSpawnResult;
      try {
        drone = await spawnDrone(config, briefContent);
      } catch (err) {
        const msg = `Failed to spawn drone: ${(err as Error).message}`;
        console.error(`[supervisor] @${config.mindName}: ${msg}`);
        result.errors.push(msg);
        sm.transition(SupervisorState.FAILED);
        break;
      }

      currentDronePane = drone.paneId;
      currentWorktree = drone.worktree;
      currentBranch = drone.branch;
      result.dronePaneId = drone.paneId;
      result.worktree = drone.worktree;
      result.branch = drone.branch;

      console.log(`[supervisor] @${config.mindName}: Drone spawned in pane ${drone.paneId}`);

      // ---- Step 3: Wait for Drone completion ----
      const completion = await waitForDroneCompletion(drone.paneId, config.droneTimeoutMs);
      if (!completion.ok) {
        const msg = completion.error ?? "Drone failed";
        console.error(`[supervisor] @${config.mindName}: ${msg}`);
        result.errors.push(msg);
        killPane(drone.paneId);
        sm.transition(SupervisorState.FAILED);
        break;
      }

      console.log(`[supervisor] @${config.mindName}: Drone completed, running checks`);

      // ---- Step 4: Deterministic checks ----
      sm.transition(SupervisorState.CHECKING);
      const checks = runDeterministicChecks(currentWorktree, config.baseBranch, config.mindName);

      // ---- Step 5: Publish REVIEW_STARTED ----
      await publishSignal(
        config.busUrl, config.channel,
        MindsEventType.REVIEW_STARTED,
        config.mindName, config.waveId,
        { iteration },
      );

      // ---- Step 6: LLM Review ----
      sm.transition(SupervisorState.REVIEWING);
      console.log(`[supervisor] @${config.mindName}: Reviewing (iteration ${iteration})`);

      // If tests fail, that's an automatic rejection -- but still get the LLM review
      // for additional findings
      const prompt = buildReviewPrompt({
        diff: checks.diff,
        testOutput: checks.testOutput,
        standards,
        tasks: config.tasks,
        iteration,
      });

      let verdict: ReviewVerdict;
      try {
        const rawResponse = await callLlmReview(prompt);
        verdict = parseReviewVerdict(rawResponse);
      } catch (err) {
        // LLM call failed -- treat as rejection with error finding
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

      result.findings = verdict.findings;

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

      // ---- Step 8: Write feedback and prepare for re-launch ----
      console.log(
        `[supervisor] @${config.mindName}: REJECTED (${verdict.findings.length} findings). Writing feedback.`
      );

      const testFailures = !checks.testsPass ? checks.testOutput : undefined;
      const feedbackContent = buildFeedbackContent(iteration, verdict.findings, testFailures);
      writeFileSync(join(currentWorktree, `REVIEW-FEEDBACK-${iteration}.md`), feedbackContent);

      // Publish REVIEW_FEEDBACK signal
      await publishSignal(
        config.busUrl, config.channel,
        MindsEventType.REVIEW_FEEDBACK,
        config.mindName, config.waveId,
        { iteration, findingsCount: verdict.findings.length },
      );

      // Kill the old drone pane before re-launching
      killPane(drone.paneId);

      // Loop continues: the transition to DRONE_RUNNING happens at the top
      // of the next iteration. Current state is REVIEWING, which is allowed
      // to transition to DRONE_RUNNING.
    }

    // Handle the edge case where we exit the while loop due to isMaxIterations
    // being true at the START of an iteration (iteration count was already at max)
    if (sm.getState() === SupervisorState.INIT) {
      // This shouldn't happen with maxIterations >= 1, but guard anyway
      sm.transition(SupervisorState.DONE);
      result.ok = true;
      result.approved = true;
      result.approvedWithWarnings = true;
    }

    // ---- Publish MIND_COMPLETE ----
    if (result.ok) {
      await publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_COMPLETE,
        config.mindName, config.waveId,
        { iterations: result.iterations, approvedWithWarnings: result.approvedWithWarnings },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_COMPLETE published`);
    }

  } catch (err) {
    const msg = `Supervisor error: ${(err as Error).message}`;
    console.error(`[supervisor] @${config.mindName}: ${msg}`);
    result.errors.push(msg);
    result.ok = false;
  } finally {
    // Cleanup: kill drone pane if still alive
    if (currentDronePane) {
      killPane(currentDronePane);
    }
  }

  return result;
}
