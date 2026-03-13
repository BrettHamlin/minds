/**
 * pipeline-runner.test.ts — Tests for the generic pipeline stage runner.
 *
 * Verifies:
 *   1. runPipeline iterates through stages in order
 *   2. on_fail "reject" stops pipeline on failure
 *   3. on_fail "warn" continues with warning on failure
 *   4. on_fail "skip" silently continues on failure
 *   5. terminal result stops pipeline regardless of on_fail
 *   6. Stage context is passed through correctly
 *   7. Unknown stage type throws error
 *   8. Empty pipeline returns success
 *   9. Findings are accumulated across stages
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runPipeline, type PipelineRunResult } from "../pipeline-runner.ts";
import type { PipelineStage, StageContext, StageResult, StageExecutor } from "../pipeline-types.ts";
import { clearRegistry, registerExecutor } from "../stage-registry.ts";
import type { SupervisorConfig, SupervisorDeps, CheckResults } from "../supervisor-types.ts";
import { makeTestConfig } from "./test-helpers.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal deps that satisfy the type but are never called. */
function stubDeps(): SupervisorDeps {
  return {
    spawnDrone: async () => ({ handle: { id: "%1", backend: "tmux" as const }, worktree: "/w", branch: "b" }),
    relaunchDroneInWorktree: async () => ({ id: "%2", backend: "tmux" as const }),
    waitForDroneCompletion: async () => ({ ok: true }),
    publishSignal: async () => {},
    runDeterministicChecks: () => ({
      diff: "", testOutput: "", testsPass: true, findings: [],
    }),
    callLlmReview: async () => '{"approved":true,"findings":[]}',
    installDroneStopHook: () => {},
    killDrone: async () => {},
    delay: async () => {},
  };
}

function makeCtx(overrides?: Partial<StageContext>): StageContext {
  return {
    supervisorConfig: makeTestConfig(),
    deps: stubDeps(),
    standards: "# Standards\n",
    iteration: 1,
    worktree: "/tmp/test-worktree",
    branch: "test-branch",
    store: {},
    allDroneHandles: [],
    ...overrides,
  };
}

/** Track execution order of stages. */
let executionLog: string[] = [];

function makeTrackingExecutor(name: string, result?: Partial<StageResult>): StageExecutor {
  return async (_stage, _ctx) => {
    executionLog.push(name);
    return { ok: true, ...result };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearRegistry();
  executionLog = [];
});

afterEach(() => {
  clearRegistry();
});

describe("runPipeline", () => {
  // -----------------------------------------------------------------------
  // 1. Iterates through stages in order
  // -----------------------------------------------------------------------
  test("iterates through stages in order", async () => {
    registerExecutor("step-a", makeTrackingExecutor("step-a"));
    registerExecutor("step-b", makeTrackingExecutor("step-b"));
    registerExecutor("step-c", makeTrackingExecutor("step-c"));

    const stages: PipelineStage[] = [
      { type: "step-a", label: "A" },
      { type: "step-b", label: "B" },
      { type: "step-c", label: "C" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(true);
    expect(executionLog).toEqual(["step-a", "step-b", "step-c"]);
    expect(result.stageResults).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 2. on_fail "reject" stops pipeline
  // -----------------------------------------------------------------------
  test("on_fail 'reject' stops pipeline on stage failure", async () => {
    registerExecutor("pass-stage", makeTrackingExecutor("pass-stage"));
    registerExecutor("fail-stage", makeTrackingExecutor("fail-stage", {
      ok: false,
      error: "something broke",
      findings: [{ file: "a.ts", line: 1, severity: "error", message: "bad" }],
    }));
    registerExecutor("after-fail", makeTrackingExecutor("after-fail"));

    const stages: PipelineStage[] = [
      { type: "pass-stage" },
      { type: "fail-stage", on_fail: "reject" },
      { type: "after-fail" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(false);
    expect(executionLog).toEqual(["pass-stage", "fail-stage"]);
    // after-fail should NOT have run
    expect(executionLog).not.toContain("after-fail");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toBe("bad");
  });

  // -----------------------------------------------------------------------
  // 3. Default on_fail is "reject"
  // -----------------------------------------------------------------------
  test("default on_fail is 'reject'", async () => {
    registerExecutor("fail-default", makeTrackingExecutor("fail-default", {
      ok: false,
      error: "default reject",
    }));
    registerExecutor("unreachable", makeTrackingExecutor("unreachable"));

    const stages: PipelineStage[] = [
      { type: "fail-default" }, // no on_fail specified
      { type: "unreachable" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(false);
    expect(executionLog).toEqual(["fail-default"]);
  });

  // -----------------------------------------------------------------------
  // 4. on_fail "warn" continues with warning
  // -----------------------------------------------------------------------
  test("on_fail 'warn' continues after stage failure", async () => {
    registerExecutor("warn-fail", makeTrackingExecutor("warn-fail", {
      ok: false,
      error: "non-critical issue",
      findings: [{ file: "b.ts", line: 5, severity: "warning", message: "minor" }],
    }));
    registerExecutor("continues", makeTrackingExecutor("continues"));

    const stages: PipelineStage[] = [
      { type: "warn-fail", on_fail: "warn" },
      { type: "continues" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(true);
    expect(executionLog).toEqual(["warn-fail", "continues"]);
    // Findings are still accumulated
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toBe("minor");
  });

  // -----------------------------------------------------------------------
  // 5. on_fail "skip" silently continues
  // -----------------------------------------------------------------------
  test("on_fail 'skip' silently continues after stage failure", async () => {
    registerExecutor("skip-fail", makeTrackingExecutor("skip-fail", {
      ok: false,
      error: "skippable issue",
      findings: [{ file: "c.ts", line: 10, severity: "error", message: "skipped" }],
    }));
    registerExecutor("next-stage", makeTrackingExecutor("next-stage"));

    const stages: PipelineStage[] = [
      { type: "skip-fail", on_fail: "skip" },
      { type: "next-stage" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(true);
    expect(executionLog).toEqual(["skip-fail", "next-stage"]);
    // Findings from "skip" are still accumulated (for observability)
    expect(result.findings).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 6. terminal result stops pipeline regardless of on_fail
  // -----------------------------------------------------------------------
  test("terminal result stops pipeline even with on_fail 'warn'", async () => {
    registerExecutor("terminal-stage", makeTrackingExecutor("terminal-stage", {
      ok: false,
      terminal: true,
      error: "fatal error",
    }));
    registerExecutor("never-reached", makeTrackingExecutor("never-reached"));

    const stages: PipelineStage[] = [
      { type: "terminal-stage", on_fail: "warn" },
      { type: "never-reached" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(false);
    expect(executionLog).toEqual(["terminal-stage"]);
  });

  test("terminal result stops pipeline even with on_fail 'skip'", async () => {
    registerExecutor("terminal-skip", makeTrackingExecutor("terminal-skip", {
      ok: false,
      terminal: true,
      error: "crash",
    }));
    registerExecutor("after-terminal", makeTrackingExecutor("after-terminal"));

    const stages: PipelineStage[] = [
      { type: "terminal-skip", on_fail: "skip" },
      { type: "after-terminal" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(false);
    expect(executionLog).toEqual(["terminal-skip"]);
  });

  // -----------------------------------------------------------------------
  // 7. Stage context is passed through correctly
  // -----------------------------------------------------------------------
  test("stage context is passed through and mutated across stages", async () => {
    registerExecutor("writer", async (_stage, ctx) => {
      executionLog.push("writer");
      ctx.store.myKey = "hello";
      return { ok: true };
    });
    registerExecutor("reader", async (_stage, ctx) => {
      executionLog.push("reader");
      ctx.store.readBack = ctx.store.myKey;
      return { ok: true };
    });

    const stages: PipelineStage[] = [
      { type: "writer" },
      { type: "reader" },
    ];
    const ctx = makeCtx();

    await runPipeline(stages, ctx);

    expect(ctx.store.myKey).toBe("hello");
    expect(ctx.store.readBack).toBe("hello");
    expect(executionLog).toEqual(["writer", "reader"]);
  });

  // -----------------------------------------------------------------------
  // 8. Unknown stage type throws error
  // -----------------------------------------------------------------------
  test("unknown stage type throws error", async () => {
    const stages: PipelineStage[] = [
      { type: "nonexistent-stage" },
    ];

    await expect(runPipeline(stages, makeCtx())).rejects.toThrow(
      /No stage executor registered for type "nonexistent-stage"/
    );
  });

  // -----------------------------------------------------------------------
  // 9. Empty pipeline returns success
  // -----------------------------------------------------------------------
  test("empty pipeline returns success", async () => {
    const result = await runPipeline([], makeCtx());

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.stageResults).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 10. Findings are accumulated across stages
  // -----------------------------------------------------------------------
  test("findings are accumulated across all stages", async () => {
    registerExecutor("stage-1", makeTrackingExecutor("stage-1", {
      ok: true,
      findings: [{ file: "a.ts", line: 1, severity: "warning", message: "warn1" }],
    }));
    registerExecutor("stage-2", makeTrackingExecutor("stage-2", {
      ok: true,
      findings: [
        { file: "b.ts", line: 2, severity: "error", message: "err1" },
        { file: "c.ts", line: 3, severity: "warning", message: "warn2" },
      ],
    }));

    const stages: PipelineStage[] = [
      { type: "stage-1" },
      { type: "stage-2" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 11. Approved flag is set from stage results
  // -----------------------------------------------------------------------
  test("approved flag reflects the last review stage", async () => {
    registerExecutor("review-approve", makeTrackingExecutor("review-approve", {
      ok: true,
      approved: true,
    }));

    const stages: PipelineStage[] = [
      { type: "review-approve" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
  });

  test("approved is false when review rejects", async () => {
    registerExecutor("review-reject", makeTrackingExecutor("review-reject", {
      ok: false,
      approved: false,
      findings: [{ file: "x.ts", line: 1, severity: "error", message: "rejected" }],
    }));

    const stages: PipelineStage[] = [
      { type: "review-reject", on_fail: "reject" },
    ];

    const result = await runPipeline(stages, makeCtx());

    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 12. Stage config is forwarded to executor
  // -----------------------------------------------------------------------
  test("stage config is accessible to executor", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    registerExecutor("config-reader", async (stage, _ctx) => {
      executionLog.push("config-reader");
      receivedConfig = stage.config;
      return { ok: true };
    });

    const stages: PipelineStage[] = [
      { type: "config-reader", config: { command: "bun test", timeout: 5000 } },
    ];

    await runPipeline(stages, makeCtx());

    expect(receivedConfig).toEqual({ command: "bun test", timeout: 5000 });
  });
});
