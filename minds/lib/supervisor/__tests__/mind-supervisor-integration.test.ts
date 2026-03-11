/**
 * mind-supervisor-integration.test.ts — Integration tests for runMindSupervisor
 * main loop using injected dependencies.
 *
 * Exercises the happy-path and error flows that the existing
 * mind-supervisor.test.ts does not cover:
 *   (a) Approve on first try
 *   (b) Reject then approve (review feedback loop)
 *   (c) Max iterations reached -> approved with warnings
 *   (d) Drone spawn failure -> MIND_FAILED
 *   (e) Drone crash mid-flight -> MIND_FAILED
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runMindSupervisor } from "../mind-supervisor.ts";
import type {
  SupervisorConfig,
  SupervisorDeps,
  CheckResults,
} from "../supervisor-types.ts";
import { MindsEventType } from "../../../transport/minds-events.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join(tmpdir(), `supervisor-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  // Create the STANDARDS.md the supervisor tries to load
  const mindsDir = join(dir, "minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "STANDARDS.md"), "# Test Standards\n");
  return dir;
}

function makeConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return {
    mindName: "transport",
    ticketId: "BRE-500",
    waveId: "wave-1",
    tasks: [
      { id: "T001", mind: "transport", description: "Implement SSE endpoint", parallel: false },
    ],
    repoRoot: tmpDir,
    busUrl: "http://localhost:7777",
    busPort: 7777,
    channel: "minds-BRE-500",
    worktreePath: join(tmpDir, "worktree"),
    baseBranch: "dev",
    callerPane: "%0",
    mindsSourceDir: join(tmpDir, "minds"),
    featureDir: join(tmpDir, "specs", "BRE-500-feature"),
    dependencies: [],
    maxIterations: 3,
    droneTimeoutMs: 20 * 60 * 1000,
    ...overrides,
  };
}

function makePassingChecks(): CheckResults {
  return {
    diff: "diff --git a/file.ts b/file.ts\n+// new code",
    testOutput: "3 pass, 0 fail",
    testsPass: true,
    findings: [],
  };
}

function makeFailingChecks(): CheckResults {
  return {
    diff: "diff --git a/file.ts b/file.ts\n+// new code",
    testOutput: "2 pass, 1 fail\nError: expected true to be false",
    testsPass: false,
    findings: [],
  };
}

function makeApprovalResponse(): string {
  return JSON.stringify({ approved: true, findings: [] });
}

function makeRejectionResponse(findings?: Array<{ file: string; line: number; severity: string; message: string }>): string {
  return JSON.stringify({
    approved: false,
    findings: findings ?? [
      { file: "src/handler.ts", line: 42, severity: "error", message: "Missing error handling" },
    ],
  });
}

/** Create a full set of mock deps. Override individual deps as needed. */
function makeMockDeps(overrides?: Partial<SupervisorDeps>): SupervisorDeps {
  return {
    spawnDrone: mock(async () => ({
      paneId: "%10",
      worktree: join(tmpDir, "worktree"),
      branch: "minds/BRE-500-transport",
    })),
    relaunchDroneInWorktree: mock(() => "%11"),
    waitForDroneCompletion: mock(async () => ({ ok: true })),
    publishSignal: mock(async () => {}),
    runDeterministicChecks: mock(() => makePassingChecks()),
    callLlmReview: mock(async () => makeApprovalResponse()),
    installDroneStopHook: mock(() => {}),
    killPane: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("runMindSupervisor integration", () => {
  // -----------------------------------------------------------------------
  // (a) Approve on first try
  // -----------------------------------------------------------------------
  test("(a) approve on first try: drone succeeds, review approves", async () => {
    const config = makeConfig();
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.approvedWithWarnings).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.findings).toHaveLength(0);

    // Verify spawnDrone was called once
    expect(deps.spawnDrone).toHaveBeenCalledTimes(1);
    // Verify relaunchDroneInWorktree was never called (single iteration)
    expect(deps.relaunchDroneInWorktree).toHaveBeenCalledTimes(0);
    // Verify waitForDroneCompletion was called once
    expect(deps.waitForDroneCompletion).toHaveBeenCalledTimes(1);
    // Verify callLlmReview was called once
    expect(deps.callLlmReview).toHaveBeenCalledTimes(1);

    // Verify signals: MIND_STARTED, REVIEW_STARTED, MIND_COMPLETE
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_STARTED);
    expect(signalTypes).toContain(MindsEventType.REVIEW_STARTED);
    expect(signalTypes).toContain(MindsEventType.MIND_COMPLETE);
    expect(signalTypes).not.toContain(MindsEventType.MIND_FAILED);

    // Verify pane tracking
    expect(result.allPaneIds).toContain("%10");
    expect(result.worktree).toBe(join(tmpDir, "worktree"));
    expect(result.branch).toBe("minds/BRE-500-transport");
  });

  // -----------------------------------------------------------------------
  // (b) Reject then approve
  // -----------------------------------------------------------------------
  test("(b) reject then approve: first review rejects, second approves", async () => {
    const config = makeConfig();
    // Create the worktree directory so writeFileSync for feedback works
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    let reviewCallCount = 0;
    const deps = makeMockDeps({
      callLlmReview: mock(async () => {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return makeRejectionResponse();
        }
        return makeApprovalResponse();
      }),
      relaunchDroneInWorktree: mock(() => "%12"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.approvedWithWarnings).toBe(false);
    expect(result.iterations).toBe(2);

    // Verify spawnDrone called for iteration 1, relaunch for iteration 2
    expect(deps.spawnDrone).toHaveBeenCalledTimes(1);
    expect(deps.relaunchDroneInWorktree).toHaveBeenCalledTimes(1);

    // Verify two LLM review calls
    expect(deps.callLlmReview).toHaveBeenCalledTimes(2);

    // Verify findings from first iteration are accumulated
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].iteration).toBe(1);

    // Verify REVIEW_FEEDBACK signal was published
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.REVIEW_FEEDBACK);
    expect(signalTypes).toContain(MindsEventType.MIND_COMPLETE);

    // Verify feedback file was written
    expect(existsSync(join(tmpDir, "worktree", "REVIEW-FEEDBACK-1.md"))).toBe(true);

    // Verify all spawned panes tracked
    expect(result.allPaneIds).toContain("%10");
    expect(result.allPaneIds).toContain("%12");
  });

  // -----------------------------------------------------------------------
  // (c) Max iterations reached -> approved with warnings
  // -----------------------------------------------------------------------
  test("(c) max iterations: always rejects, approved with warnings at limit", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const deps = makeMockDeps({
      // Always reject
      callLlmReview: mock(async () => makeRejectionResponse()),
      relaunchDroneInWorktree: mock(() => "%13"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.approvedWithWarnings).toBe(true);
    expect(result.iterations).toBe(2);

    // Verify both iterations ran
    expect(deps.spawnDrone).toHaveBeenCalledTimes(1);
    expect(deps.relaunchDroneInWorktree).toHaveBeenCalledTimes(1);
    expect(deps.callLlmReview).toHaveBeenCalledTimes(2);

    // Verify MIND_COMPLETE (not MIND_FAILED) since we approve with warnings
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_COMPLETE);
    expect(signalTypes).not.toContain(MindsEventType.MIND_FAILED);

    // Verify findings accumulated from both iterations
    const iter1Findings = result.findings.filter((f) => f.iteration === 1);
    const iter2Findings = result.findings.filter((f) => f.iteration === 2);
    expect(iter1Findings.length).toBeGreaterThan(0);
    expect(iter2Findings.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // (d) Drone spawn failure -> MIND_FAILED
  // -----------------------------------------------------------------------
  test("(d) drone spawn failure: spawnDrone throws -> MIND_FAILED", async () => {
    const config = makeConfig();
    const deps = makeMockDeps({
      spawnDrone: mock(async () => {
        throw new Error("tmux split-window failed: no space");
      }),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to spawn drone");
    expect(result.errors[0]).toContain("no space");

    // Verify no review was attempted
    expect(deps.callLlmReview).toHaveBeenCalledTimes(0);
    expect(deps.waitForDroneCompletion).toHaveBeenCalledTimes(0);

    // Verify MIND_FAILED was published
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_STARTED);
    expect(signalTypes).toContain(MindsEventType.MIND_FAILED);
    expect(signalTypes).not.toContain(MindsEventType.MIND_COMPLETE);

    // Verify no panes were tracked (spawn failed)
    expect(result.allPaneIds).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // (e) Drone crash mid-flight -> MIND_FAILED
  // -----------------------------------------------------------------------
  test("(e) drone crash mid-flight: waitForDroneCompletion returns ok:false -> MIND_FAILED", async () => {
    const config = makeConfig();
    const deps = makeMockDeps({
      waitForDroneCompletion: mock(async () => ({
        ok: false,
        error: "Drone pane %10 died without writing sentinel -- likely crashed",
      })),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("died without writing sentinel");

    // Verify no review was attempted (drone never completed)
    expect(deps.callLlmReview).toHaveBeenCalledTimes(0);

    // Verify killPane was called for the crashed drone
    const killPaneCalls = (deps.killPane as ReturnType<typeof mock>).mock.calls;
    // killPane is called once explicitly for the crashed drone, and once in finally cleanup
    const killedPanes = killPaneCalls.map((c: unknown[]) => c[0]);
    expect(killedPanes).toContain("%10");

    // Verify MIND_FAILED was published
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_FAILED);

    // Verify pane was tracked even though it crashed
    expect(result.allPaneIds).toContain("%10");
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  test("test failure overrides LLM approval", async () => {
    const config = makeConfig();
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    let reviewCallCount = 0;
    const deps = makeMockDeps({
      // LLM always approves, but tests fail on first iteration
      callLlmReview: mock(async () => makeApprovalResponse()),
      runDeterministicChecks: mock(() => {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return makeFailingChecks();
        }
        return makePassingChecks();
      }),
      relaunchDroneInWorktree: mock(() => "%14"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.iterations).toBe(2);
    // First iteration should have forced rejection despite LLM approval
    const testFindings = result.findings.filter((f) => f.file === "(tests)");
    expect(testFindings.length).toBeGreaterThan(0);
  });

  test("LLM review timeout is treated as rejection", async () => {
    const config = makeConfig({ maxIterations: 1 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const deps = makeMockDeps({
      callLlmReview: mock(async () => {
        throw new Error("Review timed out after 5000ms");
      }),
    });

    const result = await runMindSupervisor(config, deps);

    // maxIterations=1 means after the first rejection, it approves with warnings
    expect(result.ok).toBe(true);
    expect(result.approvedWithWarnings).toBe(true);
    expect(result.findings.some((f) => f.message.includes("timed out"))).toBe(true);
  });

  test("installDroneStopHook called for each iteration", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    let reviewCallCount = 0;
    const deps = makeMockDeps({
      callLlmReview: mock(async () => {
        reviewCallCount++;
        if (reviewCallCount === 1) return makeRejectionResponse();
        return makeApprovalResponse();
      }),
      relaunchDroneInWorktree: mock(() => "%15"),
    });

    await runMindSupervisor(config, deps);

    // installDroneStopHook should be called twice: once after spawn, once after relaunch
    expect(deps.installDroneStopHook).toHaveBeenCalledTimes(2);
  });

  test("cleanup kills all spawned panes even after failure", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const deps = makeMockDeps({
      // First iteration: drone succeeds, review rejects
      callLlmReview: mock(async () => makeRejectionResponse()),
      relaunchDroneInWorktree: mock(() => "%16"),
      // Second iteration: drone crashes
      waitForDroneCompletion: mock()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, error: "Drone crashed" }),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    // Both panes (%10 from spawn, %16 from relaunch) should be tracked
    expect(result.allPaneIds).toHaveLength(2);
    // killPane should be called for each tracked pane in cleanup
    const killCalls = (deps.killPane as ReturnType<typeof mock>).mock.calls;
    const killedPanes = killCalls.map((c: unknown[]) => c[0]);
    // One explicit kill for the crashed drone + two in finally cleanup
    expect(killedPanes.filter((p: string) => p === "%10")).toHaveLength(1);
    expect(killedPanes.filter((p: string) => p === "%16")).toHaveLength(2); // explicit + cleanup
  });
});
