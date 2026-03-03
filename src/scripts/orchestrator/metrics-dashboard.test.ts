// BRE-281: metrics-dashboard — pipeline run dashboard CLI
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  openMetricsDb,
  ensureRun,
  recordPhase,
  insertGate,
  insertIntervention,
  stampPrOnRun,
} from "../../lib/pipeline/metrics";
import { updateGateAccuracy } from "../../lib/pipeline/gate-accuracy";
import { spawnCli } from "./test-helpers";
import { classifyRun } from "../../lib/pipeline/classify-run";

const CLI_PATH = join(import.meta.dir, "metrics-dashboard.ts");

// ============================================================================
// Shared test DB setup
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `metrics-dashboard-test-${process.pid}`);
  mkdirSync(join(tmpDir, ".collab/state"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  const db = openMetricsDb(join(tmpDir, ".collab/state/metrics.db"));

  // Run 1: BRE-901 — completed, has plan phase, has PR
  ensureRun(db, "BRE-901");
  recordPhase(db, {
    ticketId: "BRE-901",
    phase: "specify",
    startedAt: "2026-03-01T10:00:00Z",
    completedAt: "2026-03-01T10:05:00Z",
    durationMs: 300_000,
    outcome: "specify_COMPLETE",
  });
  recordPhase(db, {
    ticketId: "BRE-901",
    phase: "plan",
    startedAt: "2026-03-01T10:05:00Z",
    completedAt: "2026-03-01T10:10:00Z",
    durationMs: 300_000,
    outcome: "plan_COMPLETE",
  });
  insertGate(db, "BRE-901", "plan_review", "PASS");
  db.query("UPDATE runs SET outcome = ? WHERE id = ?").run("plan_COMPLETE", "BRE-901");
  updateGateAccuracy(db, "BRE-901");
  classifyRun(db, "BRE-901");
  stampPrOnRun(db, "BRE-901", "https://github.com/test/repo/pull/42", 42, "bre-901-test");

  // Run 2: BRE-902 — failed, specify only, has intervention, no PR
  ensureRun(db, "BRE-902");
  recordPhase(db, {
    ticketId: "BRE-902",
    phase: "specify",
    startedAt: "2026-03-02T10:00:00Z",
    completedAt: "2026-03-02T10:03:00Z",
    durationMs: 180_000,
    outcome: "specify_FAILED",
  });
  db.query("UPDATE runs SET outcome = ? WHERE id = ?").run("specify_FAILED", "BRE-902");
  insertIntervention(db, "BRE-902", "specify", "manual_signal", "Test intervention");
  classifyRun(db, "BRE-902");

  db.close();
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function runCli(args: string[], cwd = tmpDir) {
  return spawnCli(CLI_PATH, args, cwd);
}

// ============================================================================
// Default view
// ============================================================================

describe("metrics-dashboard default view", () => {
  test("shows all runs by default", async () => {
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("BRE-901");
    expect(stdout).toContain("BRE-902");
  });

  test("exit code 0 on success", async () => {
    const { exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
  });

  test("includes bottleneck phases section when phases exist", async () => {
    const { stdout } = await runCli([]);
    expect(stdout).toContain("Bottleneck");
  });
});

// ============================================================================
// --last
// ============================================================================

describe("--last", () => {
  test("--last 1 limits to 1 run (most recent)", async () => {
    const { stdout, exitCode } = await runCli(["--last", "1"]);
    expect(exitCode).toBe(0);
    // BRE-902 started more recently
    expect(stdout).toContain("BRE-902");
    expect(stdout).not.toContain("BRE-901");
  });

  test("--last with non-integer exits 1", async () => {
    const { exitCode, stderr } = await runCli(["--last", "abc"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("positive integer");
  });

  test("--last with 0 exits 1", async () => {
    const { exitCode } = await runCli(["--last", "0"]);
    expect(exitCode).toBe(1);
  });
});

// ============================================================================
// --phase
// ============================================================================

describe("--phase", () => {
  test("--phase plan shows only runs with plan phase", async () => {
    const { stdout, exitCode } = await runCli(["--phase", "plan"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("BRE-901");
    expect(stdout).not.toContain("BRE-902");
  });

  test("--phase nonexistent shows no runs", async () => {
    const { stdout, exitCode } = await runCli(["--phase", "nonexistent"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No runs found");
  });
});

// ============================================================================
// --outcome
// ============================================================================

describe("--outcome", () => {
  test("--outcome success shows only completed runs", async () => {
    const { stdout, exitCode } = await runCli(["--outcome", "success"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("BRE-901");
    expect(stdout).not.toContain("BRE-902");
  });

  test("--outcome failure shows only failed runs", async () => {
    const { stdout, exitCode } = await runCli(["--outcome", "failure"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("BRE-901");
    expect(stdout).toContain("BRE-902");
  });

  test("--outcome invalid exits 1", async () => {
    const { exitCode, stderr } = await runCli(["--outcome", "invalid"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("success");
  });
});

// ============================================================================
// --gates
// ============================================================================

describe("--gates", () => {
  test("shows gate accuracy stats", async () => {
    const { stdout, exitCode } = await runCli(["--gates"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("plan_review");
  });

  test("--gates --json returns structured JSON", async () => {
    const { stdout, exitCode } = await runCli(["--gates", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.gates)).toBe(true);
    expect(data.gates[0]).toHaveProperty("gate");
    expect(data.gates[0]).toHaveProperty("totalDecisions");
  });
});

// ============================================================================
// --autonomy
// ============================================================================

describe("--autonomy", () => {
  test("shows 3-window autonomy rate", async () => {
    const { stdout, exitCode } = await runCli(["--autonomy"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("last10");
    expect(stdout).toContain("30days");
    expect(stdout).toContain("alltime");
  });

  test("--autonomy --json returns 3 rate objects", async () => {
    const { stdout, exitCode } = await runCli(["--autonomy", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.autonomy)).toBe(true);
    expect(data.autonomy).toHaveLength(3);
    expect(data.autonomy[0]).toHaveProperty("window");
    expect(data.autonomy[0]).toHaveProperty("rate");
  });
});

// ============================================================================
// --quality
// ============================================================================

describe("--quality", () => {
  test("shows PR outcomes", async () => {
    const { stdout, exitCode } = await runCli(["--quality"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("BRE-901");
    expect(stdout).toContain("42");
  });

  test("--quality --json returns quality stats", async () => {
    const { stdout, exitCode } = await runCli(["--quality", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(typeof data.quality.totalRuns).toBe("number");
    expect(typeof data.quality.runsWithPr).toBe("number");
    expect(Array.isArray(data.quality.prs)).toBe(true);
    expect(data.quality.prs[0].prNumber).toBe(42);
  });
});

// ============================================================================
// --json (default view)
// ============================================================================

describe("--json default view", () => {
  test("returns JSON with runs and bottlenecks arrays", async () => {
    const { stdout, exitCode } = await runCli(["--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.runs)).toBe(true);
    expect(Array.isArray(data.bottlenecks)).toBe(true);
    expect(data.runs.length).toBeGreaterThan(0);
  });

  test("runs contain expected fields", async () => {
    const { stdout } = await runCli(["--json"]);
    const data = JSON.parse(stdout);
    const run = data.runs.find((r: any) => r.ticketId === "BRE-901");
    expect(run).toBeDefined();
    expect(run.runId).toBe("BRE-901");
    expect(run.phaseCount).toBe(2);
    expect(run.prNumber).toBe(42);
  });
});

// ============================================================================
// Composable filters
// ============================================================================

describe("composable filters", () => {
  test("--phase plan --last 20 --json composes correctly", async () => {
    const { stdout, exitCode } = await runCli(["--phase", "plan", "--last", "20", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data.runs)).toBe(true);
    // Only BRE-901 has a plan phase
    expect(data.runs.every((r: any) => r.ticketId === "BRE-901")).toBe(true);
  });

  test("--outcome success --last 1 --json composes correctly", async () => {
    const { stdout, exitCode } = await runCli(["--outcome", "success", "--last", "1", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.runs.every((r: any) => r.outcome?.endsWith("_COMPLETE"))).toBe(true);
  });
});

// ============================================================================
// Unknown flags
// ============================================================================

describe("arg parsing errors", () => {
  test("unknown option exits 1", async () => {
    const { exitCode, stderr } = await runCli(["--unknown"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown option");
  });
});

// ============================================================================
// Empty DB
// ============================================================================

describe("empty DB", () => {
  let emptyDir: string;

  beforeAll(() => {
    emptyDir = join(tmpdir(), `metrics-dashboard-empty-${process.pid}`);
    mkdirSync(join(emptyDir, ".collab/state"), { recursive: true });
    execSync("git init", { cwd: emptyDir });
    execSync("git checkout -b test-empty", { cwd: emptyDir });
    const db = openMetricsDb(join(emptyDir, ".collab/state/metrics.db"));
    db.close();
  });

  afterAll(() => {
    try {
      rmSync(emptyDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  test("empty DB: prints 'No runs found', exit 0", async () => {
    const { stdout, exitCode } = await runCli([], emptyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No runs found");
  });

  test("--gates empty DB: prints 'No gate data found', exit 0", async () => {
    const { stdout, exitCode } = await runCli(["--gates"], emptyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No gate data found");
  });

  test("--quality empty DB: shows zero counts, exit 0", async () => {
    const { stdout, exitCode } = await runCli(["--quality"], emptyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0");
  });
});
