// record-gate.ts — Record gate evaluation decisions in metrics.db
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  openMetricsDb,
  openInMemoryMetricsDb,
  ensureRun,
  insertGate,
} from "./metrics";
import { spawnCli } from "@minds/execution/test-helpers"; // CROSS-MIND

const CLI_PATH = join(import.meta.dir, "record-gate.ts");

// ============================================================================
// Unit tests: insertGate library function
// ============================================================================

describe("insertGate — library", () => {
  test("records gate row with correct columns", () => {
    const db = openInMemoryMetricsDb();
    ensureRun(db, "RG-UNIT-1");

    const id = insertGate(db, "RG-UNIT-1", "plan_review", "PASS", "Looks good");

    const row = db
      .query("SELECT * FROM gates WHERE id = ?")
      .get(id) as {
      run_id: string;
      gate: string;
      decision: string;
      reasoning: string;
    };

    expect(row.run_id).toBe("RG-UNIT-1");
    expect(row.gate).toBe("plan_review");
    expect(row.decision).toBe("PASS");
    expect(row.reasoning).toBe("Looks good");
    db.close();
  });

  test("records FAIL decision with null reasoning", () => {
    const db = openInMemoryMetricsDb();
    ensureRun(db, "RG-UNIT-2");

    const id = insertGate(db, "RG-UNIT-2", "blindqa_review", "FAIL", null);

    const row = db
      .query("SELECT decision, reasoning FROM gates WHERE id = ?")
      .get(id) as { decision: string; reasoning: string | null };

    expect(row.decision).toBe("FAIL");
    expect(row.reasoning).toBeNull();
    db.close();
  });

  test("returns a non-empty UUID string", () => {
    const db = openInMemoryMetricsDb();
    ensureRun(db, "RG-UNIT-3");

    const id = insertGate(db, "RG-UNIT-3", "analyze_review", "PASS");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    db.close();
  });
});

// ============================================================================
// CLI integration tests via Bun.spawn
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `record-gate-test-${process.pid}`);
  mkdirSync(join(tmpDir, ".collab/state"), { recursive: true });
  mkdirSync(join(tmpDir, ".collab/config"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  // Seed a run so insertGate has a valid run_id FK
  const db = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));
  ensureRun(db, "RG-CLI-1");
  ensureRun(db, "RG-CLI-2");
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

describe("record-gate CLI", () => {
  test("exits 1 when TICKET_ID missing", async () => {
    const { stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr);
    expect(parsed.error).toContain("Usage");
  });

  test("exits 1 when GATE_NAME missing", async () => {
    const { stderr, exitCode } = await runCli(["RG-CLI-1"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr).error).toContain("Usage");
  });

  test("exits 1 when DECISION missing", async () => {
    const { stderr, exitCode } = await runCli(["RG-CLI-1", "plan_review"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr).error).toContain("Usage");
  });

  test("exit 0 with 3 args: TICKET_ID GATE_NAME DECISION", async () => {
    const { stdout, exitCode } = await runCli(["RG-CLI-1", "plan_review", "PASS"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.ticketId).toBe("RG-CLI-1");
    expect(result.gate).toBe("plan_review");
    expect(result.decision).toBe("PASS");
    expect(typeof result.id).toBe("string");
  });

  test("exit 0 with optional REASONING arg", async () => {
    const { stdout, exitCode } = await runCli([
      "RG-CLI-1",
      "blindqa_review",
      "FAIL",
      "AC3 failed: missing validation",
    ]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.decision).toBe("FAIL");
  });

  test("gate row persists in DB after CLI runs", async () => {
    const { exitCode } = await runCli(["RG-CLI-2", "analyze_review", "PASS", "All good"]);
    expect(exitCode).toBe(0);

    const db = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));
    const row = db
      .query("SELECT gate, decision, reasoning FROM gates WHERE run_id = 'RG-CLI-2'")
      .get() as { gate: string; decision: string; reasoning: string } | null;
    db.close();

    expect(row).toBeDefined();
    expect(row!.gate).toBe("analyze_review");
    expect(row!.decision).toBe("PASS");
    expect(row!.reasoning).toBe("All good");
  });

  test("exit 3 when @metrics disabled in pipeline.json", async () => {
    const metricsOffDir = join(tmpdir(), `record-gate-metrics-off-${process.pid}`);
    mkdirSync(join(metricsOffDir, ".collab/config"), { recursive: true });
    mkdirSync(join(metricsOffDir, ".collab/state"), { recursive: true });
    execSync("git init", { cwd: metricsOffDir });
    execSync("git checkout -b test-off", { cwd: metricsOffDir });

    writeFileSync(
      join(metricsOffDir, ".collab/config/pipeline.json"),
      JSON.stringify({ metrics: { enabled: false } })
    );

    const { stdout, exitCode } = await runCli(
      ["ANY-TICKET", "any_gate", "PASS"],
      metricsOffDir
    );
    expect(exitCode).toBe(3);
    expect(JSON.parse(stdout).skipped).toBe(true);

    rmSync(metricsOffDir, { recursive: true });
  });
});
