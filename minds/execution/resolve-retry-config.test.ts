// resolve-retry-config.ts — Retry configuration resolver tests
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import {
  countPhaseAttempts,
  resolveMaxRetries,
  resolveRetryConfig,
} from "./resolve-retry-config";
import { spawnCli } from "./test-helpers";

const CLI_PATH = join(import.meta.dir, "resolve-retry-config.ts");

// ============================================================================
// Unit tests: countPhaseAttempts
// ============================================================================

describe("countPhaseAttempts", () => {
  test("returns 0 when history is empty", () => {
    expect(countPhaseAttempts([], "blindqa")).toBe(0);
  });

  test("counts entries for the given phase", () => {
    const history = [
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
      { phase: "implement", signal: "IMPLEMENT_COMPLETE" },
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
    ];
    expect(countPhaseAttempts(history, "blindqa")).toBe(2);
  });

  test("ignores entries for other phases", () => {
    const history = [
      { phase: "implement", signal: "IMPLEMENT_COMPLETE" },
      { phase: "plan", signal: "PLAN_COMPLETE" },
    ];
    expect(countPhaseAttempts(history, "blindqa")).toBe(0);
  });

  test("counts all signal types (pass and fail)", () => {
    const history = [
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
      { phase: "blindqa", signal: "BLINDQA_COMPLETE" },
    ];
    expect(countPhaseAttempts(history, "blindqa")).toBe(2);
  });
});

// ============================================================================
// Unit tests: resolveMaxRetries
// ============================================================================

describe("resolveMaxRetries", () => {
  test("returns per-phase max_retries when set", () => {
    const pipeline = {
      phases: { blindqa: { command: "/collab.blindqa", max_retries: 5 } },
    };
    expect(resolveMaxRetries(pipeline, "blindqa")).toBe(5);
  });

  test("falls back to global max_retries when per-phase not set", () => {
    const pipeline = {
      max_retries: 4,
      phases: { blindqa: { command: "/collab.blindqa" } },
    };
    expect(resolveMaxRetries(pipeline, "blindqa")).toBe(4);
  });

  test("falls back to default (3) when neither is set", () => {
    const pipeline = {
      phases: { blindqa: { command: "/collab.blindqa" } },
    };
    expect(resolveMaxRetries(pipeline, "blindqa")).toBe(3);
  });

  test("returns default (3) for unknown phase", () => {
    expect(resolveMaxRetries({ phases: {} }, "nonexistent")).toBe(3);
  });

  test("per-phase takes precedence over global", () => {
    const pipeline = {
      max_retries: 2,
      phases: { blindqa: { command: "/collab.blindqa", max_retries: 7 } },
    };
    expect(resolveMaxRetries(pipeline, "blindqa")).toBe(7);
  });
});

// ============================================================================
// Unit tests: resolveRetryConfig
// ============================================================================

describe("resolveRetryConfig — pure function", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `retry-config-unit-${process.pid}`);
    mkdirSync(join(tmpDir, ".minds/config"), { recursive: true });
    mkdirSync(join(tmpDir, ".minds/state/pipeline-registry"), { recursive: true });

    execSync("git init", { cwd: tmpDir });
    execSync("git checkout -b test-branch", { cwd: tmpDir });

    writeFileSync(
      join(tmpDir, ".minds/config/pipeline.json"),
      JSON.stringify({
        version: "3.1",
        phases: {
          blindqa: { command: "/collab.blindqa", max_retries: 3 },
          done: { terminal: true },
        },
      })
    );
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  function writeRegistry(ticketId: string, history: Array<{ phase: string; signal: string }>) {
    writeFileSync(
      join(tmpDir, ".minds/state/pipeline-registry", `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, current_step: "blindqa", phase_history: history })
    );
  }

  test("currentAttempt=1 on first run (no history)", () => {
    writeRegistry("BRE-R1", []);
    const config = resolveRetryConfig("BRE-R1", "blindqa", tmpDir);
    expect(config.currentAttempt).toBe(1);
    expect(config.maxAttempts).toBe(3);
    expect(config.exhausted).toBe(false);
  });

  test("currentAttempt=2 after one failure", () => {
    writeRegistry("BRE-R2", [
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
    ]);
    const config = resolveRetryConfig("BRE-R2", "blindqa", tmpDir);
    expect(config.currentAttempt).toBe(2);
    expect(config.exhausted).toBe(false);
  });

  test("currentAttempt=3 after two failures, not yet exhausted", () => {
    writeRegistry("BRE-R3", [
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
    ]);
    const config = resolveRetryConfig("BRE-R3", "blindqa", tmpDir);
    expect(config.currentAttempt).toBe(3);
    expect(config.exhausted).toBe(false);
  });

  test("exhausted=true when currentAttempt exceeds maxAttempts", () => {
    writeRegistry("BRE-R4", [
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
      { phase: "blindqa", signal: "BLINDQA_FAILED" },
    ]);
    const config = resolveRetryConfig("BRE-R4", "blindqa", tmpDir);
    expect(config.currentAttempt).toBe(4);
    expect(config.exhausted).toBe(true);
  });

  test("ignores history entries from other phases", () => {
    writeRegistry("BRE-R5", [
      { phase: "implement", signal: "IMPLEMENT_COMPLETE" },
      { phase: "run_tests", signal: "RUN_TESTS_COMPLETE" },
    ]);
    const config = resolveRetryConfig("BRE-R5", "blindqa", tmpDir);
    expect(config.currentAttempt).toBe(1);
    expect(config.exhausted).toBe(false);
  });
});

// ============================================================================
// CLI integration tests
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `retry-config-cli-${process.pid}`);
  mkdirSync(join(tmpDir, ".minds/config"), { recursive: true });
  mkdirSync(join(tmpDir, ".minds/state/pipeline-registry"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  writeFileSync(
    join(tmpDir, ".minds/config/pipeline.json"),
    JSON.stringify({
      version: "3.1",
      phases: {
        blindqa: { command: "/collab.blindqa", max_retries: 3 },
        done: { terminal: true },
      },
    })
  );

  // Fresh ticket — no failures yet
  writeFileSync(
    join(tmpDir, ".minds/state/pipeline-registry/BRE-FRESH.json"),
    JSON.stringify({ ticket_id: "BRE-FRESH", current_step: "blindqa", phase_history: [] })
  );

  // One failure
  writeFileSync(
    join(tmpDir, ".minds/state/pipeline-registry/BRE-ONE.json"),
    JSON.stringify({
      ticket_id: "BRE-ONE",
      current_step: "blindqa",
      phase_history: [{ phase: "blindqa", signal: "BLINDQA_FAILED", ts: "2026-01-01T00:00:00Z" }],
    })
  );

  // Three failures — exhausted
  writeFileSync(
    join(tmpDir, ".minds/state/pipeline-registry/BRE-MAX.json"),
    JSON.stringify({
      ticket_id: "BRE-MAX",
      current_step: "blindqa",
      phase_history: [
        { phase: "blindqa", signal: "BLINDQA_FAILED", ts: "2026-01-01T00:00:00Z" },
        { phase: "blindqa", signal: "BLINDQA_FAILED", ts: "2026-01-01T00:01:00Z" },
        { phase: "blindqa", signal: "BLINDQA_FAILED", ts: "2026-01-01T00:02:00Z" },
      ],
    })
  );
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {
    /* ignore */
  }
});

function runCli(args: string[], cwd = tmpDir) {
  return spawnCli(CLI_PATH, args, cwd);
}

describe("resolve-retry-config CLI — argument validation", () => {
  test("exits 1 with no args", async () => {
    const { exitCode } = await runCli([]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 with only ticket ID", async () => {
    const { exitCode } = await runCli(["BRE-FRESH"]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when first arg is a flag", async () => {
    const { exitCode } = await runCli(["--flag", "blindqa"]);
    expect(exitCode).toBe(1);
  });

  test("exits 3 when registry not found", async () => {
    const { exitCode } = await runCli(["BRE-MISSING", "blindqa"]);
    expect(exitCode).toBe(3);
  });
});

describe("resolve-retry-config CLI — attempt counting", () => {
  test("currentAttempt=1 for fresh ticket (no phase history)", async () => {
    const { stdout, exitCode } = await runCli(["BRE-FRESH", "blindqa"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.currentAttempt).toBe(1);
    expect(result.maxAttempts).toBe(3);
    expect(result.exhausted).toBe(false);
  });

  test("currentAttempt=2 after one failure", async () => {
    const { stdout, exitCode } = await runCli(["BRE-ONE", "blindqa"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.currentAttempt).toBe(2);
    expect(result.maxAttempts).toBe(3);
    expect(result.exhausted).toBe(false);
  });

  test("exhausted=true after three failures", async () => {
    const { stdout, exitCode } = await runCli(["BRE-MAX", "blindqa"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.currentAttempt).toBe(4);
    expect(result.maxAttempts).toBe(3);
    expect(result.exhausted).toBe(true);
  });
});
