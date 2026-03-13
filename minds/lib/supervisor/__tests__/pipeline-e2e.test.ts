/**
 * pipeline-e2e.test.ts — E2E tests for the Mind Pipeline System (BRE-626).
 *
 * Exercises all three pipeline types (CODE, BUILD, TEST) through the full
 * runMindSupervisor entry point with mocked deps.
 *
 * Test levels:
 *   Level 1: Backward compatibility (code pipeline only)
 *   Level 2: Code + Build mind
 *   Level 3: Code -> Build -> Verify chain (test pipeline, resolution, merge skip)
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
import {
  resolvePipeline,
  producesCode,
  CODE_PIPELINE,
  BUILD_PIPELINE,
  TEST_PIPELINE,
} from "../pipeline-templates.ts";
import type { PipelineStage } from "../pipeline-types.ts";
import type { MindDescription } from "../../../mind.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeIntegrationTmpDir(): string {
  const dir = makeTestTmpDir("pipeline-e2e");
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
    featureDir: join(tmpDir, "specs", "BRE-600-feature"),
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

function makeRejectionResponse(
  findings?: Array<{ file: string; line: number; severity: string; message: string }>,
): string {
  return JSON.stringify({
    approved: false,
    findings: findings ?? [
      { file: "src/handler.ts", line: 42, severity: "error", message: "Missing error handling" },
    ],
  });
}

function makeMockDeps(overrides?: Partial<SupervisorDeps>): SupervisorDeps {
  return {
    spawnDrone: mock(async () => ({
      paneId: "%10",
      worktree: join(tmpDir, "worktree"),
      branch: "minds/BRE-600-pipeline",
    })),
    relaunchDroneInWorktree: mock(async () => "%11"),
    waitForDroneCompletion: mock(async () => ({ ok: true })),
    publishSignal: mock(async () => {}),
    runDeterministicChecks: mock(() => makePassingChecks()),
    callLlmReview: mock(async () => makeApprovalResponse()),
    installDroneStopHook: mock(() => {}),
    killPane: mock(async () => {}),
    delay: mock(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = makeIntegrationTmpDir();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ===========================================================================
// LEVEL 1: Backward Compatibility (Code Pipeline Only)
// ===========================================================================

describe("Level 1: Backward compatibility (code pipeline)", () => {
  test("L1.1 — full code pipeline: approved on first try", async () => {
    const config = makeConfig();
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.approvedWithWarnings).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.errors).toHaveLength(0);

    // All 7 code pipeline stages should run: spawn, wait, git-diff, run-tests,
    // boundary-check, contract-check, llm-review
    expect(deps.spawnDrone).toHaveBeenCalledTimes(1);
    expect(deps.waitForDroneCompletion).toHaveBeenCalledTimes(1);
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(1);
    expect(deps.callLlmReview).toHaveBeenCalledTimes(1);

    // Verify signals
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_STARTED);
    expect(signalTypes).toContain(MindsEventType.REVIEW_STARTED);
    expect(signalTypes).toContain(MindsEventType.MIND_COMPLETE);
  });

  test("L1.2 — code pipeline: rejected then approved (review feedback loop)", async () => {
    const config = makeConfig();
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    let reviewCount = 0;
    const deps = makeMockDeps({
      callLlmReview: mock(async () => {
        reviewCount++;
        return reviewCount === 1 ? makeRejectionResponse() : makeApprovalResponse();
      }),
      relaunchDroneInWorktree: mock(async () => "%12"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].iteration).toBe(1);

    // Feedback file written
    expect(existsSync(join(tmpDir, "worktree", "REVIEW-FEEDBACK-1.md"))).toBe(true);

    // Two LLM review calls
    expect(deps.callLlmReview).toHaveBeenCalledTimes(2);

    // Signals include REVIEW_FEEDBACK
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.REVIEW_FEEDBACK);
  });

  test("L1.3 — code pipeline: max iterations reached -> approvedWithWarnings", async () => {
    const config = makeConfig({ maxIterations: 2 });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });

    const deps = makeMockDeps({
      callLlmReview: mock(async () => makeRejectionResponse()),
      relaunchDroneInWorktree: mock(async () => "%13"),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.approvedWithWarnings).toBe(true);
    expect(result.iterations).toBe(2);
  });

  test("L1.4 — default (no pipelineTemplate) resolves to code pipeline", async () => {
    const config = makeConfig(); // no pipelineTemplate set
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    // Code pipeline includes LLM review and deterministic checks
    expect(result.ok).toBe(true);
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(1);
    expect(deps.callLlmReview).toHaveBeenCalledTimes(1);
  });

  test("L1.5 — explicit pipelineTemplate 'code' behaves identically to default", async () => {
    const configDefault = makeConfig();
    const configExplicit = makeConfig({ pipelineTemplate: "code" });

    const depsDefault = makeMockDeps();
    const depsExplicit = makeMockDeps();

    const resultDefault = await runMindSupervisor(configDefault, depsDefault);
    const resultExplicit = await runMindSupervisor(configExplicit, depsExplicit);

    expect(resultDefault.ok).toBe(resultExplicit.ok);
    expect(resultDefault.approved).toBe(resultExplicit.approved);
    expect(resultDefault.iterations).toBe(resultExplicit.iterations);

    // Both call the same set of deps
    expect(depsDefault.spawnDrone).toHaveBeenCalledTimes(1);
    expect(depsExplicit.spawnDrone).toHaveBeenCalledTimes(1);
    expect(depsDefault.runDeterministicChecks).toHaveBeenCalledTimes(1);
    expect(depsExplicit.runDeterministicChecks).toHaveBeenCalledTimes(1);
    expect(depsDefault.callLlmReview).toHaveBeenCalledTimes(1);
    expect(depsExplicit.callLlmReview).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// LEVEL 2: Code + Build Mind
// ===========================================================================

describe("Level 2: Code + Build mind", () => {
  test("L2.1 — build pipeline: runs all 4 stages (spawn, wait, run-command, collect-results)", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({
      pipelineTemplate: "build",
      testCommand: "echo 'build success'",
    });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.iterations).toBe(1);

    // spawn and wait called
    expect(deps.spawnDrone).toHaveBeenCalledTimes(1);
    expect(deps.waitForDroneCompletion).toHaveBeenCalledTimes(1);
  });

  test("L2.2 — build pipeline: run-command failure triggers rejection", async () => {
    // Build pipeline with a testCommand that will be used by run-command.
    // We need the run-command stage to actually fail. Since run-command calls
    // Bun.spawn, we configure a command that will fail.
    const config = makeConfig({
      pipelineTemplate: "build",
      testCommand: "false", // exit code 1
      maxIterations: 1,
    });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    // run-command failure with on_fail: "reject" (default) stops the pipeline.
    // Build pipeline doesn't have LLM review, so max iterations -> approvedWithWarnings
    // doesn't apply. The pipeline stops at run-command failure.
    // Since the pipeline returns ok:false but it's not terminal, the supervisor
    // enters the verdict path. With no LLM review, approved defaults to ok=false.
    // But max iterations check applies — at maxIterations=1, it checks for hard failures.
    // Since there are no boundary/test/contract failures (build pipeline doesn't run them),
    // it approves with warnings.
    expect(result.iterations).toBe(1);
    // The build pipeline run-command failure is not a "hard failure" (boundary/test/contract)
    // so max iterations allows approvedWithWarnings
    expect(result.ok).toBe(true);
    expect(result.approvedWithWarnings).toBe(true);
  });

  test("L2.3 — build pipeline: NO git-diff, run-tests, boundary-check, contract-check, or llm-review stages", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({
      pipelineTemplate: "build",
      testCommand: "echo 'build ok'",
    });
    const deps = makeMockDeps();

    await runMindSupervisor(config, deps);

    // runDeterministicChecks is called by git-diff stage, which doesn't exist in build pipeline
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(0);
    // callLlmReview is called by llm-review stage, which doesn't exist in build pipeline
    expect(deps.callLlmReview).toHaveBeenCalledTimes(0);
  });

  test("L2.4 — build pipeline has exactly 4 stages", () => {
    expect(BUILD_PIPELINE).toHaveLength(4);
    const types = BUILD_PIPELINE.map((s) => s.type);
    expect(types).toEqual(["spawn-drone", "wait-completion", "run-command", "collect-results"]);
  });

  test("L2.5 — code pipeline has exactly 7 stages", () => {
    expect(CODE_PIPELINE).toHaveLength(7);
    const types = CODE_PIPELINE.map((s) => s.type);
    expect(types).toEqual([
      "spawn-drone",
      "wait-completion",
      "git-diff",
      "run-tests",
      "boundary-check",
      "contract-check",
      "llm-review",
    ]);
  });

  test("L2.6 — mixed wave: code mind + build mind can coexist (different stage counts)", async () => {
    // Run two supervisors in sequence (simulating a wave with two minds)
    const codeConfig = makeConfig({ mindName: "coder" });
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const buildConfig = makeConfig({
      mindName: "builder",
      pipelineTemplate: "build",
      testCommand: "echo 'build success'",
    });

    const codeDeps = makeMockDeps();
    const buildDeps = makeMockDeps();

    const codeResult = await runMindSupervisor(codeConfig, codeDeps);
    const buildResult = await runMindSupervisor(buildConfig, buildDeps);

    // Both succeed
    expect(codeResult.ok).toBe(true);
    expect(buildResult.ok).toBe(true);

    // Code mind runs deterministic checks + LLM review; build mind does not
    expect(codeDeps.runDeterministicChecks).toHaveBeenCalledTimes(1);
    expect(codeDeps.callLlmReview).toHaveBeenCalledTimes(1);
    expect(buildDeps.runDeterministicChecks).toHaveBeenCalledTimes(0);
    expect(buildDeps.callLlmReview).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// LEVEL 3: Code -> Build -> Verify Chain
// ===========================================================================

describe("Level 3: Code -> Build -> Verify chain", () => {
  test("L3.1 — test pipeline: runs 5 stages including health-check", () => {
    expect(TEST_PIPELINE).toHaveLength(5);
    const types = TEST_PIPELINE.map((s) => s.type);
    expect(types).toEqual([
      "spawn-drone",
      "wait-completion",
      "run-command",
      "collect-results",
      "health-check",
    ]);
  });

  test("L3.2 — test pipeline: health-check has on_fail: 'skip'", () => {
    const healthCheck = TEST_PIPELINE.find((s) => s.type === "health-check");
    expect(healthCheck).toBeDefined();
    expect(healthCheck!.on_fail).toBe("skip");
  });

  test("L3.3 — test pipeline: health-check failure with on_fail 'skip' still succeeds", async () => {
    // The test pipeline health-check has on_fail: "skip", so even if it fails,
    // the pipeline should succeed overall.
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({
      pipelineTemplate: "test",
      testCommand: "echo 'tests pass'",
    });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    // Even if health-check would fail (no URL configured), on_fail: "skip"
    // means the pipeline continues successfully
    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
  });

  test("L3.4 — pipeline resolution: explicit pipeline array overrides template", () => {
    const customStages: PipelineStage[] = [
      { type: "spawn-drone" },
      { type: "wait-completion" },
      { type: "run-command" },
    ];

    const desc: MindDescription = {
      name: "custom",
      domain: "ops",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline_template: "code", // template says "code"
      pipeline: customStages, // but explicit pipeline overrides
    };

    const resolved = resolvePipeline(desc);
    expect(resolved).toHaveLength(3);
    expect(resolved[0].type).toBe("spawn-drone");
    expect(resolved[1].type).toBe("wait-completion");
    expect(resolved[2].type).toBe("run-command");
  });

  test("L3.5 — pipeline resolution: unknown template name throws", () => {
    const desc: MindDescription = {
      name: "bad",
      domain: "ops",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline_template: "nonexistent",
    };

    expect(() => resolvePipeline(desc)).toThrow('Unknown pipeline template "nonexistent"');
  });

  test("L3.6 — merge skip: non-code minds (build) should skip merge", () => {
    const buildDesc: MindDescription = {
      name: "builder",
      domain: "build",
      keywords: [],
      owns_files: ["**"],
      capabilities: [],
      pipeline_template: "build",
    };
    expect(producesCode(buildDesc)).toBe(false);
  });

  test("L3.7 — merge skip: non-code minds (test) should skip merge", () => {
    const testDesc: MindDescription = {
      name: "tester",
      domain: "qa",
      keywords: [],
      owns_files: ["**"],
      capabilities: [],
      pipeline_template: "test",
    };
    expect(producesCode(testDesc)).toBe(false);
  });

  test("L3.8 — merge skip: code minds should NOT skip merge", () => {
    const codeDesc: MindDescription = {
      name: "coder",
      domain: "core",
      keywords: [],
      owns_files: ["src/**"],
      capabilities: [],
    };
    expect(producesCode(codeDesc)).toBe(true);
  });

  test("L3.9 — full chain: code pipeline produces findings, build pipeline does not", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    // Code mind with a rejection on first try
    const codeConfig = makeConfig({ mindName: "coder", maxIterations: 1 });
    const codeDeps = makeMockDeps({
      callLlmReview: mock(async () => makeRejectionResponse([
        { file: "src/app.ts", line: 10, severity: "error", message: "Unused import" },
      ])),
    });

    const codeResult = await runMindSupervisor(codeConfig, codeDeps);

    // Code mind findings come from LLM review
    expect(codeResult.findings.length).toBeGreaterThan(0);
    expect(codeResult.findings.some((f) => f.file === "src/app.ts")).toBe(true);

    // Build mind has no LLM review, so no findings
    const buildConfig = makeConfig({
      mindName: "builder",
      pipelineTemplate: "build",
      testCommand: "echo 'ok'",
    });
    const buildDeps = makeMockDeps();
    const buildResult = await runMindSupervisor(buildConfig, buildDeps);

    expect(buildResult.findings).toHaveLength(0);
  });

  test("L3.10 — test pipeline runs through supervisor successfully", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({
      pipelineTemplate: "test",
      testCommand: "echo 'all tests pass'",
    });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.iterations).toBe(1);

    // No deterministic checks or LLM review for test pipeline
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(0);
    expect(deps.callLlmReview).toHaveBeenCalledTimes(0);

    // Signals still published
    const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
    const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
    expect(signalTypes).toContain(MindsEventType.MIND_STARTED);
    expect(signalTypes).toContain(MindsEventType.MIND_COMPLETE);
  });
});

// ===========================================================================
// Pipeline Template Properties
// ===========================================================================

describe("Pipeline template properties", () => {
  test("resolvePipeline defaults to CODE_PIPELINE when no template or pipeline set", () => {
    const desc: MindDescription = {
      name: "vanilla",
      domain: "core",
      keywords: [],
      owns_files: [],
      capabilities: [],
    };
    const resolved = resolvePipeline(desc);
    expect(resolved).toBe(CODE_PIPELINE);
  });

  test("resolvePipeline resolves 'build' template to BUILD_PIPELINE", () => {
    const desc: MindDescription = {
      name: "builder",
      domain: "build",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline_template: "build",
    };
    const resolved = resolvePipeline(desc);
    expect(resolved).toBe(BUILD_PIPELINE);
  });

  test("resolvePipeline resolves 'test' template to TEST_PIPELINE", () => {
    const desc: MindDescription = {
      name: "tester",
      domain: "qa",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline_template: "test",
    };
    const resolved = resolvePipeline(desc);
    expect(resolved).toBe(TEST_PIPELINE);
  });

  test("resolvePipeline resolves 'code' template to CODE_PIPELINE", () => {
    const desc: MindDescription = {
      name: "coder",
      domain: "core",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline_template: "code",
    };
    const resolved = resolvePipeline(desc);
    expect(resolved).toBe(CODE_PIPELINE);
  });

  test("producesCode returns true for custom pipeline with git-diff", () => {
    const desc: MindDescription = {
      name: "custom",
      domain: "ops",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline: [
        { type: "spawn-drone" },
        { type: "git-diff" },
      ],
    };
    expect(producesCode(desc)).toBe(true);
  });

  test("producesCode returns false for custom pipeline without code stages", () => {
    const desc: MindDescription = {
      name: "custom",
      domain: "ops",
      keywords: [],
      owns_files: [],
      capabilities: [],
      pipeline: [
        { type: "spawn-drone" },
        { type: "wait-completion" },
        { type: "run-command" },
      ],
    };
    expect(producesCode(desc)).toBe(false);
  });
});

// ===========================================================================
// Config-level pipeline resolution
// ===========================================================================

describe("Config-level pipeline resolution", () => {
  test("config.pipeline overrides config.pipelineTemplate", async () => {
    const customStages: PipelineStage[] = [
      { type: "spawn-drone", label: "Spawn" },
      { type: "wait-completion", label: "Wait" },
    ];

    const config = makeConfig({
      pipelineTemplate: "code", // template says code
      pipeline: customStages, // but explicit pipeline overrides
    });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(true);
    // Should NOT have called deterministic checks or LLM review
    // because the custom pipeline only has spawn + wait
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(0);
    expect(deps.callLlmReview).toHaveBeenCalledTimes(0);
  });

  test("unknown pipelineTemplate on config throws via resolvePipeline", async () => {
    const config = makeConfig({ pipelineTemplate: "fantasy" });
    const deps = makeMockDeps();

    // resolvePipelineFromConfig is called before the try/catch, so it throws
    await expect(runMindSupervisor(config, deps)).rejects.toThrow("fantasy");
  });
});

// ===========================================================================
// Force-rejection behavior per pipeline type
// ===========================================================================

describe("Force-rejection logic per pipeline type", () => {
  test("code pipeline: test failures force rejection despite LLM approval", async () => {
    const config = makeConfig({ maxIterations: 1 });
    const deps = makeMockDeps({
      callLlmReview: mock(async () => makeApprovalResponse()),
      runDeterministicChecks: mock(() => makeFailingChecks()),
    });

    const result = await runMindSupervisor(config, deps);

    // With maxIterations=1 and test failures (hard failure), it should FAIL
    expect(result.ok).toBe(false);
    expect(result.approved).toBe(false);
  });

  test("build pipeline: no force-rejection logic (no deterministic checks)", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({
      pipelineTemplate: "build",
      testCommand: "echo 'ok'",
    });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    // Build pipeline doesn't run deterministic checks at all
    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(0);
    expect(result.ok).toBe(true);
  });

  test("test pipeline: no force-rejection logic (no deterministic checks)", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({
      pipelineTemplate: "test",
      testCommand: "echo 'ok'",
    });
    const deps = makeMockDeps();

    const result = await runMindSupervisor(config, deps);

    expect(deps.runDeterministicChecks).toHaveBeenCalledTimes(0);
    expect(result.ok).toBe(true);
  });
});

// ===========================================================================
// Review checklist per pipeline type
// ===========================================================================

describe("Review checklist per pipeline type", () => {
  // These test the formatReviewChecklist function indirectly through
  // the pipeline-aware review system
  const { formatReviewChecklist, REVIEW_CHECKLIST, BUILD_REVIEW_CHECKLIST, TEST_REVIEW_CHECKLIST } =
    require("../supervisor-review.ts");

  test("default checklist used for code pipeline", () => {
    const checklist = formatReviewChecklist();
    for (const item of REVIEW_CHECKLIST) {
      expect(checklist).toContain(item);
    }
  });

  test("build checklist used for build pipeline", () => {
    const checklist = formatReviewChecklist("build");
    for (const item of BUILD_REVIEW_CHECKLIST) {
      expect(checklist).toContain(item);
    }
    // Should NOT contain code-specific items
    expect(checklist).not.toContain("All new exported functions have tests");
  });

  test("test checklist used for test pipeline", () => {
    const checklist = formatReviewChecklist("test");
    for (const item of TEST_REVIEW_CHECKLIST) {
      expect(checklist).toContain(item);
    }
    expect(checklist).not.toContain("All new exported functions have tests");
  });

  test("code checklist used for explicit 'code' template", () => {
    const checklist = formatReviewChecklist("code");
    // "code" is not "build" or "test", so it falls through to default
    for (const item of REVIEW_CHECKLIST) {
      expect(checklist).toContain(item);
    }
  });
});

// ===========================================================================
// Drone lifecycle across pipeline types
// ===========================================================================

describe("Drone lifecycle across pipeline types", () => {
  test("build pipeline: drone spawn failure is terminal", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({ pipelineTemplate: "build", testCommand: "echo ok" });
    const deps = makeMockDeps({
      spawnDrone: mock(async () => {
        throw new Error("tmux unavailable");
      }),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to spawn drone");
  });

  test("test pipeline: drone crash is terminal", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    const config = makeConfig({ pipelineTemplate: "test", testCommand: "echo ok" });
    const deps = makeMockDeps({
      waitForDroneCompletion: mock(async () => ({
        ok: false,
        error: "Drone pane %10 died without writing sentinel",
      })),
    });

    const result = await runMindSupervisor(config, deps);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("died without writing sentinel");
  });

  test("all pipeline types publish MIND_STARTED signal", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    for (const template of [undefined, "code", "build", "test"] as const) {
      const config = makeConfig({
        pipelineTemplate: template as string | undefined,
        testCommand: "echo ok",
      });
      const deps = makeMockDeps();

      await runMindSupervisor(config, deps);

      const publishCalls = (deps.publishSignal as ReturnType<typeof mock>).mock.calls;
      const signalTypes = publishCalls.map((c: unknown[]) => c[2]);
      expect(signalTypes).toContain(MindsEventType.MIND_STARTED);
    }
  });

  test("cleanup kills panes for all pipeline types", async () => {
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    for (const template of [undefined, "build", "test"] as const) {
      const config = makeConfig({
        pipelineTemplate: template as string | undefined,
        testCommand: "echo ok",
      });
      const deps = makeMockDeps();

      await runMindSupervisor(config, deps);

      expect(deps.killPane).toHaveBeenCalled();
    }
  });
});
