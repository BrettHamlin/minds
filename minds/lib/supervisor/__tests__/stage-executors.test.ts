/**
 * stage-executors.test.ts — Tests for the 7 stage executors extracted
 * from mind-supervisor.ts (BRE-619).
 *
 * Each executor is tested in isolation with mock deps, following the same
 * pattern as mind-supervisor-integration.test.ts.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PipelineStage, StageContext } from "../pipeline-types.ts";
import type { SupervisorDeps, CheckResults, ReviewVerdict } from "../supervisor-types.ts";
import { MindsEventType } from "../../../transport/minds-events.ts";
import { makeTestConfig, makeTestTmpDir } from "./test-helpers.ts";

// Import executors
import { executeSpawnDrone } from "../stages/spawn-drone.ts";
import { executeWaitCompletion } from "../stages/wait-completion.ts";
import { executeGitDiff } from "../stages/git-diff.ts";
import { executeRunTests } from "../stages/run-tests.ts";
import { executeBoundaryCheck } from "../stages/boundary-check.ts";
import { executeContractCheck } from "../stages/contract-check.ts";
import { executeLlmReview } from "../stages/llm-review.ts";
import { registerAllStages } from "../stages/index.ts";
import { applyForceRejections } from "../stages/llm-review.ts";

// Also verify the re-export from mind-supervisor still works
import { applyForceRejections as applyForceRejectionsFromSupervisor } from "../mind-supervisor.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeMockDeps(overrides?: Partial<SupervisorDeps>): SupervisorDeps {
  return {
    spawnDrone: mock(async () => ({
      paneId: "%10",
      worktree: join(tmpDir, "worktree"),
      branch: "minds/BRE-500-transport",
    })),
    relaunchDroneInWorktree: mock(async () => "%11"),
    waitForDroneCompletion: mock(async () => ({ ok: true })),
    publishSignal: mock(async () => {}),
    runDeterministicChecks: mock(() => makePassingChecks()),
    callLlmReview: mock(async () => JSON.stringify({ approved: true, findings: [] })),
    installDroneStopHook: mock(() => {}),
    killPane: mock(async () => {}),
    delay: mock(async () => {}),
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

function makeStage(type: string, overrides?: Partial<PipelineStage>): PipelineStage {
  return { type, ...overrides };
}

function makeCtx(overrides?: Partial<StageContext>): StageContext {
  const config = makeTestConfig({
    repoRoot: tmpDir,
    worktreePath: join(tmpDir, "worktree"),
    mindsSourceDir: join(tmpDir, "minds"),
    featureDir: join(tmpDir, "specs", "BRE-500-feature"),
  });
  return {
    supervisorConfig: config,
    deps: makeMockDeps(),
    standards: "# Test Standards",
    iteration: 1,
    worktree: join(tmpDir, "worktree"),
    branch: "",
    store: {},
    allSpawnedPanes: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = makeTestTmpDir("stage-executors");
  mkdirSync(join(tmpDir, "worktree"), { recursive: true });
  const mindsDir = join(tmpDir, "minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "STANDARDS.md"), "# Test Standards\n");
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// spawn-drone
// ---------------------------------------------------------------------------

describe("spawn-drone executor", () => {
  test("first iteration: spawns drone and updates context", async () => {
    const ctx = makeCtx({ iteration: 1 });
    const result = await executeSpawnDrone(makeStage("spawn-drone"), ctx);

    expect(result.ok).toBe(true);
    expect(ctx.dronePane).toBe("%10");
    expect(ctx.worktree).toBe(join(tmpDir, "worktree"));
    expect(ctx.branch).toBe("minds/BRE-500-transport");
    expect(ctx.allSpawnedPanes).toContain("%10");
    expect(ctx.deps.installDroneStopHook).toHaveBeenCalledTimes(1);
  });

  test("subsequent iteration: re-launches drone in existing worktree", async () => {
    const deps = makeMockDeps({
      relaunchDroneInWorktree: mock(async () => "%12"),
    });
    const ctx = makeCtx({
      iteration: 2,
      deps,
      dronePane: "%10",
      worktree: join(tmpDir, "worktree"),
    });

    const result = await executeSpawnDrone(makeStage("spawn-drone"), ctx);

    expect(result.ok).toBe(true);
    expect(ctx.dronePane).toBe("%12");
    expect(ctx.allSpawnedPanes).toContain("%12");
    expect(deps.relaunchDroneInWorktree).toHaveBeenCalledTimes(1);
    expect(deps.installDroneStopHook).toHaveBeenCalledTimes(1);
  });

  test("spawn failure returns terminal error", async () => {
    const deps = makeMockDeps({
      spawnDrone: mock(async () => {
        throw new Error("tmux split failed");
      }),
    });
    const ctx = makeCtx({ iteration: 1, deps });

    const result = await executeSpawnDrone(makeStage("spawn-drone"), ctx);

    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toContain("tmux split failed");
  });

  test("relaunch failure returns terminal error", async () => {
    const deps = makeMockDeps({
      relaunchDroneInWorktree: mock(async () => {
        throw new Error("relaunch failed");
      }),
    });
    const ctx = makeCtx({ iteration: 2, deps, dronePane: "%10" });

    const result = await executeSpawnDrone(makeStage("spawn-drone"), ctx);

    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toContain("relaunch failed");
  });
});

// ---------------------------------------------------------------------------
// wait-completion
// ---------------------------------------------------------------------------

describe("wait-completion executor", () => {
  test("success: drone completes ok", async () => {
    const ctx = makeCtx({ dronePane: "%10" });
    const result = await executeWaitCompletion(makeStage("wait-completion"), ctx);

    expect(result.ok).toBe(true);
    expect(ctx.deps.waitForDroneCompletion).toHaveBeenCalledTimes(1);
  });

  test("failure: drone crashes returns terminal error and kills pane", async () => {
    const deps = makeMockDeps({
      waitForDroneCompletion: mock(async () => ({
        ok: false,
        error: "Drone pane died",
      })),
    });
    const ctx = makeCtx({ dronePane: "%10", deps });

    const result = await executeWaitCompletion(makeStage("wait-completion"), ctx);

    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toContain("Drone pane died");
    expect(deps.killPane).toHaveBeenCalledWith("%10");
  });
});

// ---------------------------------------------------------------------------
// git-diff
// ---------------------------------------------------------------------------

describe("git-diff executor", () => {
  test("runs deterministic checks and stores results in context", async () => {
    const checks = makePassingChecks();
    const deps = makeMockDeps({
      runDeterministicChecks: mock(() => checks),
    });
    const ctx = makeCtx({ deps });

    const result = await executeGitDiff(makeStage("git-diff"), ctx);

    expect(result.ok).toBe(true);
    expect(ctx.checkResults).toBe(checks);
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(1);
  });

  test("publishes REVIEW_STARTED signal", async () => {
    const deps = makeMockDeps();
    const ctx = makeCtx({ deps, iteration: 2 });

    await executeGitDiff(makeStage("git-diff"), ctx);

    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    expect(publishCalls.length).toBeGreaterThan(0);
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.REVIEW_STARTED);
  });

  test("always returns ok:true regardless of check results", async () => {
    const failingChecks: CheckResults = {
      ...makePassingChecks(),
      testsPass: false,
    };
    const deps = makeMockDeps({
      runDeterministicChecks: mock(() => failingChecks),
    });
    const ctx = makeCtx({ deps });

    const result = await executeGitDiff(makeStage("git-diff"), ctx);

    expect(result.ok).toBe(true);
    expect(ctx.checkResults!.testsPass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run-tests
// ---------------------------------------------------------------------------

describe("run-tests executor", () => {
  test("pass: tests pass returns ok", async () => {
    const ctx = makeCtx({
      checkResults: makePassingChecks(),
    });

    const result = await executeRunTests(makeStage("run-tests"), ctx);

    expect(result.ok).toBe(true);
    expect(result.findings).toBeUndefined();
  });

  test("fail: tests fail returns findings", async () => {
    const ctx = makeCtx({
      checkResults: {
        ...makePassingChecks(),
        testsPass: false,
        testOutput: "FAIL: expected 1 to be 2",
      },
    });

    const result = await executeRunTests(makeStage("run-tests"), ctx);

    expect(result.ok).toBe(false);
    expect(result.findings).toBeDefined();
    expect(result.findings!.length).toBe(1);
    expect(result.findings![0].file).toBe("(tests)");
    expect(result.findings![0].severity).toBe("error");
  });

  test("no checkResults: returns error", async () => {
    const ctx = makeCtx();

    const result = await executeRunTests(makeStage("run-tests"), ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// boundary-check
// ---------------------------------------------------------------------------

describe("boundary-check executor", () => {
  test("pass: boundary passes returns ok", async () => {
    const ctx = makeCtx({
      checkResults: {
        ...makePassingChecks(),
        boundaryPass: true,
        boundaryFindings: [],
      },
    });

    const result = await executeBoundaryCheck(makeStage("boundary-check"), ctx);

    expect(result.ok).toBe(true);
  });

  test("fail: boundary violations returns findings", async () => {
    const findings = [
      { file: "src/hono.ts", line: 0, severity: "error" as const, message: "Outside boundary" },
    ];
    const ctx = makeCtx({
      checkResults: {
        ...makePassingChecks(),
        boundaryPass: false,
        boundaryFindings: findings,
      },
    });

    const result = await executeBoundaryCheck(makeStage("boundary-check"), ctx);

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(findings);
  });

  test("skip: boundary check was not run (undefined) returns ok", async () => {
    const ctx = makeCtx({
      checkResults: makePassingChecks(), // no boundaryPass field
    });

    const result = await executeBoundaryCheck(makeStage("boundary-check"), ctx);

    expect(result.ok).toBe(true);
  });

  test("no checkResults: returns error", async () => {
    const ctx = makeCtx();

    const result = await executeBoundaryCheck(makeStage("boundary-check"), ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// contract-check
// ---------------------------------------------------------------------------

describe("contract-check executor", () => {
  test("pass: contracts pass returns ok", async () => {
    const ctx = makeCtx({
      checkResults: {
        ...makePassingChecks(),
        contractsPass: true,
        contractFindings: [],
      },
    });

    const result = await executeContractCheck(makeStage("contract-check"), ctx);

    expect(result.ok).toBe(true);
  });

  test("fail: contract violations returns findings", async () => {
    const findings = [
      { file: "src/types.ts", line: 0, severity: "error" as const, message: "Missing export" },
    ];
    const ctx = makeCtx({
      checkResults: {
        ...makePassingChecks(),
        contractsPass: false,
        contractFindings: findings,
      },
    });

    const result = await executeContractCheck(makeStage("contract-check"), ctx);

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(findings);
  });

  test("skip: contract check was not run (undefined) returns ok", async () => {
    const ctx = makeCtx({
      checkResults: makePassingChecks(),
    });

    const result = await executeContractCheck(makeStage("contract-check"), ctx);

    expect(result.ok).toBe(true);
  });

  test("propagates deferred cross-repo annotations to store", async () => {
    const annotations = [
      { taskId: "T001", interface: "FooBar", filePath: "src/types.ts", direction: "produces" as const, repo: "backend" },
    ];
    const ctx = makeCtx({
      checkResults: {
        ...makePassingChecks(),
        contractsPass: true,
        contractFindings: [],
        deferredCrossRepoAnnotations: annotations,
      },
    });

    await executeContractCheck(makeStage("contract-check"), ctx);

    expect(ctx.store.deferredCrossRepoAnnotations).toEqual(annotations);
  });

  test("no checkResults: returns error", async () => {
    const ctx = makeCtx();

    const result = await executeContractCheck(makeStage("contract-check"), ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// llm-review
// ---------------------------------------------------------------------------

describe("llm-review executor", () => {
  test("approved verdict returns ok with approved flag", async () => {
    const deps = makeMockDeps({
      callLlmReview: mock(async () =>
        JSON.stringify({ approved: true, findings: [] })
      ),
    });
    const ctx = makeCtx({
      deps,
      checkResults: makePassingChecks(),
    });

    const result = await executeLlmReview(makeStage("llm-review"), ctx);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(ctx.verdict).toBeDefined();
    expect(ctx.verdict!.approved).toBe(true);
  });

  test("rejected verdict returns not-ok with findings", async () => {
    const deps = makeMockDeps({
      callLlmReview: mock(async () =>
        JSON.stringify({
          approved: false,
          findings: [
            { file: "src/handler.ts", line: 42, severity: "error", message: "Missing error handling" },
          ],
        })
      ),
    });
    const ctx = makeCtx({
      deps,
      checkResults: makePassingChecks(),
    });

    const result = await executeLlmReview(makeStage("llm-review"), ctx);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.findings!.length).toBe(1);
  });

  test("force-rejection: LLM approves but tests fail", async () => {
    const deps = makeMockDeps({
      callLlmReview: mock(async () =>
        JSON.stringify({ approved: true, findings: [] })
      ),
    });
    const ctx = makeCtx({
      deps,
      checkResults: {
        ...makePassingChecks(),
        testsPass: false,
      },
    });

    const result = await executeLlmReview(makeStage("llm-review"), ctx);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.findings!.some((f) => f.file === "(tests)")).toBe(true);
  });

  test("force-rejection: LLM approves but boundary fails", async () => {
    const deps = makeMockDeps({
      callLlmReview: mock(async () =>
        JSON.stringify({ approved: true, findings: [] })
      ),
    });
    const ctx = makeCtx({
      deps,
      checkResults: {
        ...makePassingChecks(),
        boundaryPass: false,
        boundaryFindings: [
          { file: "src/hono.ts", line: 0, severity: "error" as const, message: "Outside boundary" },
        ],
      },
    });

    const result = await executeLlmReview(makeStage("llm-review"), ctx);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
  });

  test("LLM call failure is treated as rejection", async () => {
    const deps = makeMockDeps({
      callLlmReview: mock(async () => {
        throw new Error("LLM timeout");
      }),
    });
    const ctx = makeCtx({
      deps,
      checkResults: makePassingChecks(),
    });

    const result = await executeLlmReview(makeStage("llm-review"), ctx);

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.findings!.some((f) => f.message.includes("LLM timeout"))).toBe(true);
  });

  test("reads previous feedback files on iteration > 1", async () => {
    writeFileSync(
      join(tmpDir, "worktree", "REVIEW-FEEDBACK-1.md"),
      "# Feedback Round 1\nFix the thing.",
    );

    const deps = makeMockDeps({
      callLlmReview: mock(async () =>
        JSON.stringify({ approved: true, findings: [] })
      ),
    });
    const ctx = makeCtx({
      deps,
      iteration: 2,
      checkResults: makePassingChecks(),
    });

    const result = await executeLlmReview(makeStage("llm-review"), ctx);

    expect(result.ok).toBe(true);
    // Verify the previous feedback was set on context
    expect(ctx.previousFeedback).toContain("Fix the thing");
  });
});

// ---------------------------------------------------------------------------
// applyForceRejections (shared helper)
// ---------------------------------------------------------------------------

describe("applyForceRejections", () => {
  test("overrides LLM approval when tests fail", () => {
    const verdict: ReviewVerdict = { approved: true, findings: [] };
    const checks: CheckResults = {
      ...makePassingChecks(),
      testsPass: false,
    };
    applyForceRejections(verdict, checks);
    expect(verdict.approved).toBe(false);
    expect(verdict.findings.some((f) => f.file === "(tests)")).toBe(true);
  });

  test("overrides LLM approval when boundary fails", () => {
    const verdict: ReviewVerdict = { approved: true, findings: [] };
    const checks: CheckResults = {
      ...makePassingChecks(),
      boundaryPass: false,
      boundaryFindings: [
        { file: "src/hono.ts", line: 0, severity: "error", message: "Outside boundary" },
      ],
    };
    applyForceRejections(verdict, checks);
    expect(verdict.approved).toBe(false);
  });

  test("overrides LLM approval when contracts fail", () => {
    const verdict: ReviewVerdict = { approved: true, findings: [] };
    const checks: CheckResults = {
      ...makePassingChecks(),
      contractsPass: false,
      contractFindings: [
        { file: "src/types.ts", line: 0, severity: "error", message: "Missing export" },
      ],
    };
    applyForceRejections(verdict, checks);
    expect(verdict.approved).toBe(false);
  });

  test("strips false LLM boundary findings when boundary passes", () => {
    const verdict: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "src/hono.ts", line: 0, severity: "error", message: "File outside boundary" },
      ],
    };
    const checks: CheckResults = {
      ...makePassingChecks(),
      boundaryPass: true,
    };
    applyForceRejections(verdict, checks);
    // Should re-approve since only boundary findings were present
    expect(verdict.approved).toBe(true);
    expect(verdict.findings).toHaveLength(0);
  });

  test("re-exported from mind-supervisor still works", () => {
    // Ensure backward compatibility
    expect(typeof applyForceRejectionsFromSupervisor).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// registerAllStages
// ---------------------------------------------------------------------------

describe("registerAllStages", () => {
  test("registers all 7 code pipeline executors", async () => {
    const { clearRegistry, hasExecutor, getExecutor } = await import("../stage-registry.ts");
    clearRegistry();
    registerAllStages();

    const codeTypes = [
      "spawn-drone",
      "wait-completion",
      "git-diff",
      "run-tests",
      "boundary-check",
      "contract-check",
      "llm-review",
    ];
    for (const type of codeTypes) {
      expect(hasExecutor(type)).toBe(true);
    }

    // Verify these are real executors, not stubs (stubs throw "not yet implemented")
    const executor = getExecutor("run-tests");
    // Calling with checkResults that pass should NOT throw "not yet implemented"
    const ctx = makeCtx({ checkResults: makePassingChecks() });
    const result = await executor(makeStage("run-tests"), ctx);
    expect(result.ok).toBe(true);
  });
});
