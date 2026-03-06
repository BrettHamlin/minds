// BRE-278: complete_run — finalize runs row at pipeline TERMINAL
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  openMetricsDb,
  openInMemoryMetricsDb,
  ensureRun,
  completeRun,
  recordPhase,
} from "./metrics";
import { spawnCli } from "../../src/scripts/orchestrator/test-helpers";

const CLI_PATH = join(import.meta.dir, "complete-run.ts");

// ============================================================================
// Unit tests: completeRun library function
// ============================================================================

describe("completeRun — library", () => {
  test("stamps completed_at, duration_ms, and outcome on run", () => {
    const db = openInMemoryMetricsDb();
    ensureRun(db, "COMP-1", null, "2026-03-01T10:00:00Z");

    completeRun(db, "COMP-1", "2026-03-01T10:05:00Z", "implement_COMPLETE");

    const row = db
      .query("SELECT completed_at, duration_ms, outcome FROM runs WHERE id = 'COMP-1'")
      .get() as { completed_at: string; duration_ms: number; outcome: string };

    expect(row.completed_at).toBe("2026-03-01T10:05:00Z");
    expect(row.duration_ms).toBe(300_000); // 5 minutes
    expect(row.outcome).toBe("implement_COMPLETE");
    db.close();
  });

  test("duration_ms is null when started_at is not parseable", () => {
    const db = openInMemoryMetricsDb();
    ensureRun(db, "COMP-2", null, "not-a-date");

    completeRun(db, "COMP-2", "2026-03-01T10:05:00Z", "done");

    const row = db
      .query("SELECT duration_ms FROM runs WHERE id = 'COMP-2'")
      .get() as { duration_ms: number | null };

    expect(row.duration_ms).toBeNull();
    db.close();
  });

  test("safe to call on non-existent run (no rows affected)", () => {
    const db = openInMemoryMetricsDb();
    // Should not throw
    expect(() =>
      completeRun(db, "COMP-NONEXISTENT", "2026-03-01T10:00:00Z", "done")
    ).not.toThrow();
    db.close();
  });
});

// ============================================================================
// CLI integration tests via Bun.spawn
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `complete-run-test-${process.pid}`);
  mkdirSync(join(tmpDir, ".collab/state"), { recursive: true });
  mkdirSync(join(tmpDir, ".collab/config"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  // Seed: run with two phases so there's a last phase outcome to read
  const db = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));
  ensureRun(db, "COMP-CLI-1", null, "2026-03-01T10:00:00Z");
  recordPhase(db, {
    ticketId: "COMP-CLI-1",
    phase: "specify",
    startedAt: "2026-03-01T10:00:00Z",
    completedAt: "2026-03-01T10:02:00Z",
    durationMs: 120_000,
    outcome: "specify_COMPLETE",
  });
  recordPhase(db, {
    ticketId: "COMP-CLI-1",
    phase: "implement",
    startedAt: "2026-03-01T10:02:00Z",
    completedAt: "2026-03-01T10:10:00Z",
    durationMs: 480_000,
    outcome: "implement_COMPLETE",
  });
  db.close();
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

describe("complete-run CLI", () => {
  test("exits 1 with JSON error when TICKET_ID missing", async () => {
    const { stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr);
    expect(parsed.error).toContain("Usage");
  });

  test("exit 0, stamps runs table from last phase outcome", async () => {
    const { stdout, exitCode } = await runCli(["COMP-CLI-1"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.ticketId).toBe("COMP-CLI-1");
    expect(result.outcome).toBe("implement_COMPLETE");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.completedAt).toBeTruthy();
  });

  test("runs table has completed_at, duration_ms, outcome after CLI runs", async () => {
    // Re-run on a fresh run so we can inspect the DB state
    const db = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));
    ensureRun(db, "COMP-CLI-2", null, "2026-03-01T09:00:00Z");
    recordPhase(db, {
      ticketId: "COMP-CLI-2",
      phase: "blindqa",
      startedAt: "2026-03-01T09:00:00Z",
      completedAt: "2026-03-01T09:30:00Z",
      durationMs: 1_800_000,
      outcome: "blindqa_COMPLETE",
    });
    db.close();

    const { exitCode } = await runCli(["COMP-CLI-2"]);
    expect(exitCode).toBe(0);

    const db2 = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));
    const row = db2
      .query("SELECT completed_at, duration_ms, outcome FROM runs WHERE id = 'COMP-CLI-2'")
      .get() as { completed_at: string; duration_ms: number; outcome: string };
    db2.close();

    expect(row.completed_at).toBeTruthy();
    expect(row.duration_ms).toBeGreaterThan(0);
    expect(row.outcome).toBe("blindqa_COMPLETE");
  });

  test("handles run with no phases gracefully (outcome = 'unknown')", async () => {
    const db = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));
    ensureRun(db, "COMP-CLI-NOPHASE", null, "2026-03-01T08:00:00Z");
    db.close();

    const { stdout, exitCode } = await runCli(["COMP-CLI-NOPHASE"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    // No phases → outcome falls back to "unknown"
    expect(result.outcome).toBe("unknown");
  });

  test("exit 3 when @metrics disabled in pipeline.json", async () => {
    const metricsOffDir = join(tmpdir(), `complete-run-metrics-off-${process.pid}`);
    mkdirSync(join(metricsOffDir, ".collab/config"), { recursive: true });
    mkdirSync(join(metricsOffDir, ".collab/state"), { recursive: true });
    execSync("git init", { cwd: metricsOffDir });
    execSync("git checkout -b test-metrics-off", { cwd: metricsOffDir });

    writeFileSync(
      join(metricsOffDir, ".collab/config/pipeline.json"),
      JSON.stringify({ metrics: { enabled: false } })
    );

    const { stdout, exitCode } = await runCli(["ANY-TICKET"], metricsOffDir);
    expect(exitCode).toBe(3);

    const result = JSON.parse(stdout);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("@metrics");

    rmSync(metricsOffDir, { recursive: true });
  });
});
