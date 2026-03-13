/**
 * stage-executors-new.test.ts — Tests for the 3 new stage executors (BRE-621):
 *   run-command, health-check, collect-results
 *
 * These stages support BUILD_PIPELINE and TEST_PIPELINE mind types that
 * don't go through the code review flow.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { PipelineStage, StageContext } from "../pipeline-types.ts";
import type { SupervisorDeps, CheckResults } from "../supervisor-types.ts";
import { makeTestConfig, makeTestTmpDir } from "./test-helpers.ts";

// Import executors
import { executeRunCommand } from "../stages/run-command.ts";
import { executeHealthCheck } from "../stages/health-check.ts";
import { executeCollectResults } from "../stages/collect-results.ts";

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
    runDeterministicChecks: mock((): CheckResults => ({
      diff: "",
      testOutput: "",
      testsPass: true,
      findings: [],
    })),
    callLlmReview: mock(async () => JSON.stringify({ approved: true, findings: [] })),
    installDroneStopHook: mock(() => {}),
    killPane: mock(async () => {}),
    delay: mock(async () => {}),
    ...overrides,
  };
}

function makeStage(type: string, config?: Record<string, unknown>): PipelineStage {
  return { type, config };
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
  tmpDir = makeTestTmpDir("stage-executors-new");
  mkdirSync(join(tmpDir, "worktree"), { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// run-command
// ---------------------------------------------------------------------------

describe("run-command executor", () => {
  test("successful command execution (exit 0)", async () => {
    const ctx = makeCtx();
    const stage = makeStage("run-command", { command: "echo hello" });

    const result = await executeRunCommand(stage, ctx);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("failed command (exit non-zero)", async () => {
    const ctx = makeCtx();
    const stage = makeStage("run-command", { command: "false" });

    const result = await executeRunCommand(stage, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("command output captured in store", async () => {
    const ctx = makeCtx();
    const stage = makeStage("run-command", { command: "echo captured-output" });

    await executeRunCommand(stage, ctx);

    expect(ctx.store.commandOutput).toBeDefined();
    expect(String(ctx.store.commandOutput)).toContain("captured-output");
  });

  test("timeout handling", async () => {
    const ctx = makeCtx();
    // Use a very short timeout with a sleep command
    const stage = makeStage("run-command", { command: "sleep 10", timeout: 500 });

    const result = await executeRunCommand(stage, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("missing command config uses testCommand fallback", async () => {
    const config = makeTestConfig({
      repoRoot: tmpDir,
      worktreePath: join(tmpDir, "worktree"),
      testCommand: "echo fallback-test-cmd",
    });
    const ctx = makeCtx({ supervisorConfig: config });
    const stage = makeStage("run-command"); // no config.command

    const result = await executeRunCommand(stage, ctx);

    expect(result.ok).toBe(true);
    expect(String(ctx.store.commandOutput)).toContain("fallback-test-cmd");
  });

  test("missing command and no testCommand returns error", async () => {
    const config = makeTestConfig({
      repoRoot: tmpDir,
      worktreePath: join(tmpDir, "worktree"),
      testCommand: undefined,
    });
    const ctx = makeCtx({ supervisorConfig: config });
    const stage = makeStage("run-command"); // no config.command, no testCommand

    const result = await executeRunCommand(stage, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No command");
  });
});

// ---------------------------------------------------------------------------
// health-check
// ---------------------------------------------------------------------------

describe("health-check executor", () => {
  test("successful health check (200 OK)", async () => {
    // Start a simple server to test against
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      const ctx = makeCtx();
      const stage = makeStage("health-check", {
        url: `http://localhost:${server.port}/health`,
        retries: 1,
        retryDelayMs: 100,
      });

      const result = await executeHealthCheck(stage, ctx);

      expect(result.ok).toBe(true);
      expect(ctx.store.healthCheckResult).toBeDefined();
    } finally {
      server.stop(true);
    }
  });

  test("failed health check after retries", async () => {
    // Start a server that always returns 500
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Error", { status: 500 });
      },
    });

    try {
      const ctx = makeCtx();
      const stage = makeStage("health-check", {
        url: `http://localhost:${server.port}/health`,
        retries: 2,
        retryDelayMs: 50,
      });

      const result = await executeHealthCheck(stage, ctx);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      server.stop(true);
    }
  });

  test("custom expected status code", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Created", { status: 201 });
      },
    });

    try {
      const ctx = makeCtx();
      const stage = makeStage("health-check", {
        url: `http://localhost:${server.port}/health`,
        expectedStatus: 201,
        retries: 1,
        retryDelayMs: 50,
      });

      const result = await executeHealthCheck(stage, ctx);

      expect(result.ok).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("custom retry count and delay", async () => {
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount++;
        // Succeed on third attempt
        if (requestCount >= 3) {
          return new Response("OK", { status: 200 });
        }
        return new Response("Not ready", { status: 503 });
      },
    });

    try {
      const ctx = makeCtx();
      const stage = makeStage("health-check", {
        url: `http://localhost:${server.port}/health`,
        retries: 5,
        retryDelayMs: 50,
      });

      const result = await executeHealthCheck(stage, ctx);

      expect(result.ok).toBe(true);
      expect(requestCount).toBeGreaterThanOrEqual(3);
    } finally {
      server.stop(true);
    }
  });

  test("missing URL config returns error", async () => {
    const ctx = makeCtx();
    const stage = makeStage("health-check"); // no config.url

    const result = await executeHealthCheck(stage, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("url");
  });
});

// ---------------------------------------------------------------------------
// collect-results
// ---------------------------------------------------------------------------

describe("collect-results executor", () => {
  test("reads command output from store", async () => {
    const ctx = makeCtx();
    ctx.store.commandOutput = "Build succeeded: 42 modules compiled";
    const stage = makeStage("collect-results");

    const result = await executeCollectResults(stage, ctx);

    expect(result.ok).toBe(true);
    expect(ctx.store.collectedOutput).toBe("Build succeeded: 42 modules compiled");
  });

  test("reads from outputFile config", async () => {
    const outputPath = join(tmpDir, "worktree", "build-output.txt");
    writeFileSync(outputPath, "Build log: all tests passed\n");

    const ctx = makeCtx();
    const stage = makeStage("collect-results", { outputFile: "build-output.txt" });

    const result = await executeCollectResults(stage, ctx);

    expect(result.ok).toBe(true);
    expect(String(ctx.store.collectedOutput)).toContain("all tests passed");
  });

  test("missing file returns ok with warning", async () => {
    const ctx = makeCtx();
    const stage = makeStage("collect-results", { outputFile: "nonexistent.txt" });

    const result = await executeCollectResults(stage, ctx);

    expect(result.ok).toBe(true);
    // Should have a warning or note about the missing file
    expect(ctx.store.collectedOutput).toBeDefined();
  });

  test("empty output handled gracefully", async () => {
    const ctx = makeCtx();
    ctx.store.commandOutput = "";
    const stage = makeStage("collect-results");

    const result = await executeCollectResults(stage, ctx);

    expect(result.ok).toBe(true);
    expect(ctx.store.collectedOutput).toBe("");
  });

  test("outputFile takes precedence over store commandOutput", async () => {
    const outputPath = join(tmpDir, "worktree", "results.json");
    writeFileSync(outputPath, '{"status":"ok"}');

    const ctx = makeCtx();
    ctx.store.commandOutput = "should be ignored";
    const stage = makeStage("collect-results", { outputFile: "results.json" });

    const result = await executeCollectResults(stage, ctx);

    expect(result.ok).toBe(true);
    expect(String(ctx.store.collectedOutput)).toContain('"status":"ok"');
  });
});
