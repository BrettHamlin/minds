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
 *   8. If rejected: write REVIEW-FEEDBACK-{n}.md, re-launch drone IN SAME WORKTREE, go to step 3
 *   9. Max iterations then approve with warnings
 *
 * The LLM is only invoked for the one thing that requires judgment: code review.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "fs";
import { join, resolve, dirname } from "path";
import { publishMindsEvent } from "../transport/publish-event.ts";
import { MindsEventType } from "../transport/minds-events.ts";
import { resolveMindsDir } from "../shared/paths.js";
import { killPane } from "./tmux-utils.ts";
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
  reviewTimeoutMs?: number;
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
  [SupervisorState.INIT]: [SupervisorState.DRONE_RUNNING, SupervisorState.DONE, SupervisorState.FAILED],
  [SupervisorState.DRONE_RUNNING]: [SupervisorState.CHECKING, SupervisorState.FAILED],
  [SupervisorState.CHECKING]: [SupervisorState.REVIEWING, SupervisorState.FAILED],
  [SupervisorState.REVIEWING]: [SupervisorState.DONE, SupervisorState.DRONE_RUNNING, SupervisorState.FAILED],
  [SupervisorState.DONE]: [],
  [SupervisorState.FAILED]: [],
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
// Drone Spawning (wrapper around drone-pane.ts — first iteration only)
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

  // Read stdout and stderr concurrently to prevent deadlock
  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
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
// Drone Re-launch (reuse existing worktree for retry iterations)
// ---------------------------------------------------------------------------

/**
 * Re-launch a drone in an existing worktree. This preserves the drone's
 * previous commits and the feedback file we just wrote.
 *
 * Steps:
 *   1. Kill the old drone pane
 *   2. Create a new tmux pane
 *   3. Write the updated DRONE-BRIEF.md to the existing worktree
 *   4. Launch Claude Code in the new pane pointed at the same worktree
 */
function relaunchDroneInWorktree(opts: {
  oldPaneId: string;
  callerPane: string;
  worktreePath: string;
  briefContent: string;
  busUrl: string;
  mindName: string;
}): string {
  const { oldPaneId, callerPane, worktreePath, briefContent, busUrl, mindName } = opts;

  // Kill the old drone pane
  killPane(oldPaneId);

  // Write updated DRONE-BRIEF.md to the SAME worktree
  writeFileSync(join(worktreePath, "DRONE-BRIEF.md"), briefContent);

  // Create a new tmux pane
  const splitResult = Bun.spawnSync(
    ["tmux", "split-window", "-h", "-p", "50", "-t", callerPane, "-P", "-F", "#{pane_id}"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (splitResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(splitResult.stderr);
    throw new Error(`Failed to split tmux pane for drone relaunch: ${stderr}`);
  }
  const newPaneId = new TextDecoder().decode(splitResult.stdout).trim();

  // Launch Claude Code in the new pane, pointing at the existing worktree
  const prompt = `Read DRONE-BRIEF.md and REVIEW-FEEDBACK-*.md files. Fix all issues from the review feedback, then complete any remaining tasks. When done, commit and exit cleanly.`;
  const escapedPrompt = JSON.stringify(prompt);
  let launchCmd = `cd ${worktreePath} && claude --dangerously-skip-permissions --model sonnet ${escapedPrompt}`;
  if (busUrl) {
    launchCmd = `BUS_URL=${busUrl} ${launchCmd}`;
  }
  Bun.spawnSync(
    ["tmux", "send-keys", "-t", newPaneId, launchCmd, "Enter"],
    { stdout: "ignore", stderr: "ignore" },
  );

  return newPaneId;
}

// ---------------------------------------------------------------------------
// Drone Completion Detection (sentinel file via Stop hook)
// ---------------------------------------------------------------------------

const SENTINEL_FILENAME = ".drone-complete";
const DEFAULT_DRONE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Install a Claude Code Stop hook in the worktree's `.claude/` directory.
 * When Claude Code exits, the hook writes a sentinel file to the worktree root.
 * This is event-driven (no process-tree polling).
 */
export function installDroneStopHook(worktreePath: string): void {
  const claudeDir = join(worktreePath, ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const sentinelPath = join(worktreePath, SENTINEL_FILENAME);

  // Write a local settings.json with a Stop hook that creates the sentinel file
  const settings = {
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command" as const,
              command: `touch ${JSON.stringify(sentinelPath)}`,
            },
          ],
        },
      ],
    },
  };

  const settingsPath = join(claudeDir, "settings.json");

  // Merge with existing settings if present
  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Ignore corrupt settings
    }
  }

  const merged = {
    ...existing,
    hooks: {
      ...(existing.hooks as Record<string, unknown> ?? {}),
      ...settings.hooks,
    },
  };

  writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
}

/**
 * Wait for drone completion by watching for a sentinel file.
 *
 * The sentinel file is created by a Claude Code Stop hook installed in
 * the worktree's `.claude/settings.json`. This is event-driven via
 * `fs.watch()` with a poll fallback every 5 seconds.
 *
 * Falls back to pane-existence check if the sentinel never appears
 * (e.g., hook didn't fire due to crash).
 */
async function waitForDroneCompletion(
  paneId: string,
  worktreePath: string,
  timeoutMs: number,
  pollIntervalMs: number = 5000,
): Promise<{ ok: boolean; error?: string }> {
  const sentinelPath = join(worktreePath, SENTINEL_FILENAME);

  // Clean up any stale sentinel from a previous run
  if (existsSync(sentinelPath)) {
    try { Bun.spawnSync(["rm", "-f", sentinelPath]); } catch { /* ignore */ }
  }

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let resolved = false;
    const done = (result: { ok: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      clearInterval(pollTimer);
      try { watcher?.close(); } catch { /* ignore */ }
      resolve(result);
    };

    // Timeout
    const timeoutTimer = setTimeout(() => {
      done({ ok: false, error: `Drone timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    // fs.watch() on the worktree directory for the sentinel file
    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(worktreePath, (eventType, filename) => {
        if (filename === SENTINEL_FILENAME && existsSync(sentinelPath)) {
          done({ ok: true });
        }
      });
    } catch {
      // fs.watch() may fail on some platforms — fall through to poll
    }

    // Poll fallback: check sentinel file + pane existence every interval
    const pollTimer = setInterval(() => {
      // Primary: sentinel file exists
      if (existsSync(sentinelPath)) {
        done({ ok: true });
        return;
      }

      // Fallback: pane no longer exists (crash, manual kill)
      const paneCheck = Bun.spawnSync(
        ["tmux", "list-panes", "-t", paneId, "-F", "#{pane_pid}"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (paneCheck.exitCode !== 0) {
        done({ ok: true });
        return;
      }
    }, pollIntervalMs);

    // Check immediately in case sentinel already exists or pane is already gone
    if (existsSync(sentinelPath)) {
      done({ ok: true });
    }
  });
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
// LLM Review (claude -p) with timeout
// ---------------------------------------------------------------------------

const REVIEW_TIMEOUT_ERROR = "Review timed out";

async function callLlmReview(prompt: string, timeoutMs: number = DEFAULT_REVIEW_TIMEOUT_MS): Promise<string> {
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
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${REVIEW_TIMEOUT_ERROR} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  // Read stdout and stderr concurrently to prevent deadlock
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
  } finally {
    clearTimeout(timeoutTimer);
  }

  if (exitCode !== 0) {
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
// Main Supervisor Entry Point
// ---------------------------------------------------------------------------

export async function runMindSupervisor(config: SupervisorConfig): Promise<SupervisorResult> {
  // Fix #7: Guard against maxIterations < 1
  if (config.maxIterations < 1) {
    throw new Error(`maxIterations must be >= 1, got ${config.maxIterations}`);
  }

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

  // Accumulate all findings across iterations (Fix #9)
  const allFindings: ReviewFinding[] = [];

  // Track ALL spawned pane IDs for cleanup (Fix #10)
  const allSpawnedPanes: string[] = [];

  let currentDronePane: string | undefined;
  let currentWorktree = config.worktreePath;
  let currentBranch = "";

  const reviewTimeoutMs = config.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
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
      // ---- Step 2: Spawn or re-launch Drone ----
      sm.transition(SupervisorState.DRONE_RUNNING);
      const iteration = sm.incrementIteration();
      result.iterations = iteration;

      if (iteration === 1) {
        // First iteration: spawn drone via drone-pane.ts (creates worktree)
        console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- spawning drone`);

        const briefContent = buildSupervisorDroneBrief(config);

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
        allSpawnedPanes.push(drone.paneId);
        currentWorktree = drone.worktree;
        currentBranch = drone.branch;
        result.dronePaneId = drone.paneId;
        result.worktree = drone.worktree;
        result.branch = drone.branch;

        // Install the Stop hook for sentinel-based completion detection
        installDroneStopHook(drone.worktree);

        console.log(`[supervisor] @${config.mindName}: Drone spawned in pane ${drone.paneId}`);
      } else {
        // Subsequent iterations: re-launch drone in the SAME worktree
        // This preserves the drone's previous commits and feedback files
        console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- re-launching drone in existing worktree`);

        const feedbackFile = `REVIEW-FEEDBACK-${iteration - 1}.md`;
        const briefContent = buildSupervisorDroneBrief(config, feedbackFile);

        try {
          const newPaneId = relaunchDroneInWorktree({
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
          installDroneStopHook(currentWorktree);
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
      const completion = await waitForDroneCompletion(currentDronePane!, currentWorktree, config.droneTimeoutMs);
      if (!completion.ok) {
        const msg = completion.error ?? "Drone failed";
        console.error(`[supervisor] @${config.mindName}: ${msg}`);
        result.errors.push(msg);
        killPane(currentDronePane!);
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

      // Read ALL previous feedback files for the reviewer's context (Fix #8)
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
        const rawResponse = await callLlmReview(prompt, reviewTimeoutMs);
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

      // Accumulate findings across all iterations (Fix #10)
      allFindings.push(...verdict.findings);
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
      await publishSignal(
        config.busUrl, config.channel,
        MindsEventType.REVIEW_FEEDBACK,
        config.mindName, config.waveId,
        { iteration, findingsCount: verdict.findings.length },
      );

      // Loop continues: relaunchDroneInWorktree at the top of the next iteration
      // will kill the old pane and create a new one in the same worktree.
    }

    // Handle the edge case where we exit the while loop due to isMaxIterations
    // being true at the START of an iteration (iteration count was already at max)
    if (sm.getState() === SupervisorState.INIT) {
      // This shouldn't happen with maxIterations >= 1 (validated above), but guard anyway
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
    // Cleanup: kill ALL spawned drone panes (Fix #10)
    for (const paneId of allSpawnedPanes) {
      killPane(paneId);
    }

    // Clean up sentinel file if present
    const sentinelPath = join(currentWorktree, SENTINEL_FILENAME);
    if (existsSync(sentinelPath)) {
      try { Bun.spawnSync(["rm", "-f", sentinelPath]); } catch { /* ignore */ }
    }
  }

  return result;
}
