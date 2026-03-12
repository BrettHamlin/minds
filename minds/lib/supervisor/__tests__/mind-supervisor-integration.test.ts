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
import { runMindSupervisor } from "../mind-supervisor.ts";
import type {
  SupervisorConfig,
  SupervisorDeps,
  CheckResults,
} from "../supervisor-types.ts";
import { MindsEventType } from "../../../transport/minds-events.ts";
import { makeTestConfig, makeTestTmpDir } from "./test-helpers.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeIntegrationTmpDir(): string {
  const dir = makeTestTmpDir("supervisor-integration");
  // Create the STANDARDS.md the supervisor tries to load
  const mindsDir = join(dir, "minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "STANDARDS.md"), "# Test Standards\n");
  return dir;
}

function makeConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return makeTestConfig({
    repoRoot: tmpDir,
    worktreePath: join(tmpDir, "worktree"),
    mindsSourceDir: join(tmpDir, "minds"),
    featureDir: join(tmpDir, "specs", "BRE-500-feature"),
    ...overrides,
  });
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
    delay: mock(async () => {}), // zero-wait for tests
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = makeIntegrationTmpDir();
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
    expect(result.totalPanesSpawned).toBe(1);
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
    expect(result.totalPanesSpawned).toBe(2);
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

  test("(c2) max iterations with boundary violations: FAILS instead of approving", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const boundaryFailChecks: CheckResults = {
      diff: "diff --git a/file.ts b/file.ts\n+// new code",
      testOutput: "3 pass, 0 fail",
      testsPass: true,
      boundaryPass: false,
      boundaryFindings: [{ file: "src/hono.ts", line: 0, severity: "error" as const, message: "File outside @etag boundary" }],
      findings: [],
    };

    const deps = makeMockDeps({
      callLlmReview: mock(async () => makeApprovalResponse()), // LLM says approve
      runDeterministicChecks: mock(() => boundaryFailChecks), // But boundary fails
      relaunchDroneInWorktree: mock(() => "%14"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.approvedWithWarnings).toBeFalsy();
    expect(result.iterations).toBe(2);

    // Verify MIND_FAILED (not MIND_COMPLETE)
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_FAILED);
    expect(signalTypes).not.toContain(MindsEventType.MIND_COMPLETE);
  });

  test("(c3) max iterations with test failures: FAILS instead of approving", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const deps = makeMockDeps({
      callLlmReview: mock(async () => makeRejectionResponse()),
      runDeterministicChecks: mock(() => makeFailingChecks()), // Tests always fail
      relaunchDroneInWorktree: mock(() => "%14"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
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

  // -----------------------------------------------------------------------
  // (g) Exponential backoff between retry iterations
  // -----------------------------------------------------------------------
  test("(g) backoff: delay is called with exponential backoff between rejected iterations", async () => {
    const config = makeConfig({ maxIterations: 3 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    let reviewCallCount = 0;
    const delayCallsMs: number[] = [];

    const deps = makeMockDeps({
      callLlmReview: mock(async () => {
        reviewCallCount++;
        // Reject first two, approve third
        if (reviewCallCount < 3) return makeRejectionResponse();
        return makeApprovalResponse();
      }),
      relaunchDroneInWorktree: mock(() => `%${20 + reviewCallCount}`),
      delay: mock(async (ms: number) => { delayCallsMs.push(ms); }),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.iterations).toBe(3);

    // Two rejections → two backoff delays
    expect(delayCallsMs).toHaveLength(2);
    // First backoff: 5000 * 3^0 = 5000ms
    expect(delayCallsMs[0]).toBe(5_000);
    // Second backoff: 5000 * 3^1 = 15000ms
    expect(delayCallsMs[1]).toBe(15_000);
  });

  test("(g) backoff: no delay when approved on first try", async () => {
    const config = makeConfig();
    const delayCallsMs: number[] = [];

    const deps = makeMockDeps({
      delay: mock(async (ms: number) => { delayCallsMs.push(ms); }),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.iterations).toBe(1);
    expect(delayCallsMs).toHaveLength(0);
  });

  test("(g) backoff: no delay after max iterations reached (approved with warnings)", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const delayCallsMs: number[] = [];

    const deps = makeMockDeps({
      callLlmReview: mock(async () => makeRejectionResponse()),
      relaunchDroneInWorktree: mock(() => "%15"),
      delay: mock(async (ms: number) => { delayCallsMs.push(ms); }),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approvedWithWarnings).toBe(true);
    expect(result.iterations).toBe(2);
    // Only 1 backoff (after iteration 1 rejection, before iteration 2)
    // No backoff after iteration 2 because max iterations triggers approval
    expect(delayCallsMs).toHaveLength(1);
    expect(delayCallsMs[0]).toBe(5_000);
  });
});
