// BRE-283: gate_accuracy_check — gate decision accuracy evaluation
import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openMetricsDb, openInMemoryMetricsDb, ensureRun, insertGate, recordPhase } from "./metrics";
import { updateGateAccuracy, getGateAccuracyReport } from "./gate-accuracy-lib";
import type { Database } from "bun:sqlite";

// ============================================================================
// Unit tests: updateGateAccuracy (pure SQLite, in-memory)
// ============================================================================

describe("updateGateAccuracy — PASS gates", () => {
  function setup(): { db: Database; runId: string } {
    const db: Database = openInMemoryMetricsDb();
    const runId = "BRE-GA-1";
    ensureRun(db, runId);
    return { db, runId };
  }

  test("PASS gate + run succeeded → accurate = 1", () => {
    const { db, runId } = setup();
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run(runId);
    insertGate(db, runId, "plan_review", "PASS", "Looks good");

    const rows = updateGateAccuracy(db, runId);

    expect(rows).toHaveLength(1);
    expect(rows[0].accurate).toBe(1);
    expect(rows[0].downstreamOutcome).toBe("IMPL_COMPLETE");
    db.close();
  });

  test("PASS gate + run failed → accurate = 0", () => {
    const { db, runId } = setup();
    db.query("UPDATE runs SET outcome = 'IMPL_ERROR' WHERE id = ?").run(runId);
    insertGate(db, runId, "plan_review", "PASS", null);

    const rows = updateGateAccuracy(db, runId);

    expect(rows[0].accurate).toBe(0);
    expect(rows[0].downstreamOutcome).toBe("IMPL_ERROR");
    db.close();
  });

  test("PASS gate + run outcome null → accurate = 0 (null is not _COMPLETE)", () => {
    const { db, runId } = setup();
    // run outcome stays NULL (incomplete run)
    insertGate(db, runId, "plan_review", "PASS", null);

    const rows = updateGateAccuracy(db, runId);

    expect(rows[0].accurate).toBe(0);
    expect(rows[0].downstreamOutcome).toBeNull();
    db.close();
  });
});

describe("updateGateAccuracy — FAIL gates", () => {
  function setup(outcome: string | null): { db: Database; runId: string } {
    const db: Database = openInMemoryMetricsDb();
    const runId = "BRE-GA-2";
    ensureRun(db, runId);
    if (outcome !== null) {
      db.query("UPDATE runs SET outcome = ? WHERE id = ?").run(outcome, runId);
    }
    return { db, runId };
  }

  test("FAIL gate + run succeeded → accurate = 1 (true negative)", () => {
    const { db, runId } = setup("IMPL_COMPLETE");
    insertGate(db, runId, "plan_review", "FAIL", "Issues found");

    const rows = updateGateAccuracy(db, runId);

    expect(rows[0].accurate).toBe(1);
    db.close();
  });

  test("FAIL gate + run failed → accurate = null (indeterminate)", () => {
    const { db, runId } = setup("IMPL_ERROR");
    insertGate(db, runId, "plan_review", "FAIL", "Issues found");

    const rows = updateGateAccuracy(db, runId);

    expect(rows[0].accurate).toBeNull();
    db.close();
  });
});

describe("updateGateAccuracy — multiple gates", () => {
  test("updates all gates for the run independently", () => {
    const db: Database = openInMemoryMetricsDb();
    const runId = "BRE-GA-3";
    ensureRun(db, runId);
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run(runId);

    insertGate(db, runId, "plan_review", "PASS", null);
    insertGate(db, runId, "analyze_review", "FAIL", "Needs work");

    const rows = updateGateAccuracy(db, runId);

    expect(rows).toHaveLength(2);
    const planRow = rows.find((r) => r.gate === "plan_review")!;
    const analyzeRow = rows.find((r) => r.gate === "analyze_review")!;
    expect(planRow.accurate).toBe(1);   // PASS + succeeded
    expect(analyzeRow.accurate).toBe(1); // FAIL + succeeded = true negative
    db.close();
  });

  test("does not touch gates from other runs", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "RUN-A");
    ensureRun(db, "RUN-B");
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run("RUN-A");
    db.query("UPDATE runs SET outcome = 'IMPL_ERROR' WHERE id = ?").run("RUN-B");

    insertGate(db, "RUN-A", "plan_review", "PASS", null);
    insertGate(db, "RUN-B", "plan_review", "PASS", null);

    updateGateAccuracy(db, "RUN-A"); // only updates RUN-A

    const runBGates = db
      .query("SELECT accurate, downstream_outcome FROM gates WHERE run_id = 'RUN-B'")
      .all() as any[];
    expect(runBGates[0].accurate).toBeNull();
    expect(runBGates[0].downstream_outcome).toBeNull();
    db.close();
  });

  test("returns empty array when run has no gates", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "EMPTY-RUN");
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run("EMPTY-RUN");

    const rows = updateGateAccuracy(db, "EMPTY-RUN");
    expect(rows).toHaveLength(0);
    db.close();
  });
});

describe("updateGateAccuracy — downstream_outcome written to DB", () => {
  test("downstream_outcome is persisted in gates table", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "BRE-GA-4");
    db.query("UPDATE runs SET outcome = 'PLAN_COMPLETE' WHERE id = ?").run("BRE-GA-4");
    insertGate(db, "BRE-GA-4", "plan_review", "PASS", null);

    updateGateAccuracy(db, "BRE-GA-4");

    const row = db
      .query("SELECT downstream_outcome, accurate FROM gates WHERE run_id = 'BRE-GA-4'")
      .get() as any;
    expect(row.downstream_outcome).toBe("PLAN_COMPLETE");
    expect(row.accurate).toBe(1);
    db.close();
  });
});

// ============================================================================
// Unit tests: getGateAccuracyReport
// ============================================================================

describe("getGateAccuracyReport", () => {
  function buildDb(): Database {
    const db: Database = openInMemoryMetricsDb();

    ensureRun(db, "R1");
    ensureRun(db, "R2");
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run("R1");
    db.query("UPDATE runs SET outcome = 'IMPL_ERROR' WHERE id = ?").run("R2");

    insertGate(db, "R1", "plan_review", "PASS", null);   // TP
    insertGate(db, "R2", "plan_review", "PASS", null);   // FP
    updateGateAccuracy(db, "R1");
    updateGateAccuracy(db, "R2");

    return db;
  }

  test("aggregates TPR and FPR across runs", () => {
    const db = buildDb();
    const report = getGateAccuracyReport(db);

    expect(report).toHaveLength(1);
    const g = report[0];
    expect(g.gate).toBe("plan_review");
    expect(g.totalDecisions).toBe(2);
    expect(g.passCount).toBe(2);
    expect(g.failCount).toBe(0);
    expect(g.truePositiveRate).toBeCloseTo(0.5); // 1 TP / 2 evaluated
    expect(g.falsePositiveRate).toBeCloseTo(0.5); // 1 FP / 2 evaluated
    db.close();
  });

  test("restricts to a single run when runId provided", () => {
    const db = buildDb();
    const report = getGateAccuracyReport(db, "R1");

    expect(report).toHaveLength(1);
    expect(report[0].truePositiveRate).toBe(1); // 1 TP / 1 evaluated
    expect(report[0].falsePositiveRate).toBe(0);
    db.close();
  });

  test("truePositiveRate is null when no evaluated PASS decisions", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "RX");
    insertGate(db, "RX", "g1", "FAIL", null);
    updateGateAccuracy(db, "RX"); // FAIL + no outcome → null accurate

    const report = getGateAccuracyReport(db, "RX");
    expect(report[0].truePositiveRate).toBeNull();
    expect(report[0].falsePositiveRate).toBeNull();
    db.close();
  });

  test("returns multiple gates sorted by name", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "MULTI");
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run("MULTI");
    insertGate(db, "MULTI", "z_gate", "PASS", null);
    insertGate(db, "MULTI", "a_gate", "PASS", null);
    updateGateAccuracy(db, "MULTI");

    const report = getGateAccuracyReport(db, "MULTI");
    expect(report[0].gate).toBe("a_gate");
    expect(report[1].gate).toBe("z_gate");
    db.close();
  });
});

// ============================================================================
// Integration: gate-accuracy-check.ts CLI via Bun.spawn
// ============================================================================

describe("gate-accuracy-check CLI integration", () => {
  let tmpDir: string;

  const PIPELINE_JSON = {
    version: "3.1",
    metrics: { enabled: true },
    phases: {
      impl: { signals: ["IMPL_COMPLETE"], transitions: { IMPL_COMPLETE: { to: "done" } } },
      done: { terminal: true },
    },
  };

  function setupTmpRepo(ticketId: string, runOutcome: string | null): {
    metricsPath: string;
  } {
    tmpDir = join(
      tmpdir(),
      `ga-chk-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const stateDir = join(tmpDir, ".minds", "state", "pipeline-registry");
    const configDir = join(tmpDir, ".minds", "config");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify(PIPELINE_JSON, null, 2)
    );
    writeFileSync(
      join(stateDir, `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, status: "done" }, null, 2)
    );

    const metricsPath = join(tmpDir, ".minds", "state", "metrics.db");
    const db = openMetricsDb(metricsPath);
    ensureRun(db, ticketId);
    if (runOutcome !== null) {
      db.query("UPDATE runs SET outcome = ? WHERE id = ?").run(runOutcome, ticketId);
    }
    insertGate(db, ticketId, "plan_review", "PASS", "Looks good");
    db.close();

    return { metricsPath };
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("exits 0 and outputs JSON summary", async () => {
    const { metricsPath } = setupTmpRepo("BRE-CLI-1", "IMPL_COMPLETE");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "gate-accuracy-check.ts"), "BRE-CLI-1"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(await new Response(result.stdout).text());
    expect(out.updated).toBe(1);
    expect(out.gates).toHaveLength(1);
    expect(out.gates[0].gate).toBe("plan_review");
    expect(out.gates[0].truePositiveRate).toBe(1);
  });

  test("updates gates table — accurate = 1 for PASS + COMPLETE", async () => {
    const { metricsPath } = setupTmpRepo("BRE-CLI-2", "IMPL_COMPLETE");

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "gate-accuracy-check.ts"), "BRE-CLI-2"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const row = db
      .query("SELECT accurate, downstream_outcome FROM gates WHERE run_id = 'BRE-CLI-2'")
      .get() as any;
    db.close();

    expect(row.accurate).toBe(1);
    expect(row.downstream_outcome).toBe("IMPL_COMPLETE");
  });

  test("exits 1 when no TICKET_ID provided", async () => {
    tmpDir = join(tmpdir(), `ga-noid-${Date.now()}`);
    mkdirSync(join(tmpDir, ".minds", "config"), { recursive: true });
    writeFileSync(join(tmpDir, ".minds", "config", "pipeline.json"), "{}");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "gate-accuracy-check.ts")],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(1);
  });

  test("exits 3 when @metrics(false) in pipeline config", async () => {
    tmpDir = join(tmpdir(), `ga-disabled-${Date.now()}`);
    mkdirSync(join(tmpDir, ".minds", "config"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".minds", "config", "pipeline.json"),
      JSON.stringify({ metrics: { enabled: false } })
    );

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "gate-accuracy-check.ts"), "BRE-CLI-3"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(3);
    const out = JSON.parse(await new Response(result.stdout).text());
    expect(out.skipped).toBe(true);
  });

  test("exits 0 with 0 updated when run has no gates", async () => {
    tmpDir = join(tmpdir(), `ga-nogate-${Date.now()}`);
    mkdirSync(join(tmpDir, ".minds", "state", "pipeline-registry"), { recursive: true });
    mkdirSync(join(tmpDir, ".minds", "config"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".minds", "config", "pipeline.json"),
      JSON.stringify({ metrics: { enabled: true } })
    );

    const metricsPath = join(tmpDir, ".minds", "state", "metrics.db");
    const db = openMetricsDb(metricsPath);
    ensureRun(db, "BRE-NOGATE");
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run("BRE-NOGATE");
    db.close();

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "gate-accuracy-check.ts"), "BRE-NOGATE"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(await new Response(result.stdout).text());
    expect(out.updated).toBe(0);
    expect(out.gates).toHaveLength(0);
  });
});

// ============================================================================
// E2E: full pipeline flow
// ============================================================================

describe("E2E: full pipeline flow", () => {
  let tmpDir: string;

  const PIPELINE_JSON = {
    version: "3.1",
    metrics: { enabled: true },
    phases: {
      impl: { signals: ["IMPL_COMPLETE", "IMPL_ERROR"], transitions: { IMPL_COMPLETE: { to: "done" } } },
      done: { terminal: true, signals: [] },
    },
  };

  const TICKET_ID = "BRE-901";
  const NONCE = "cafe91";

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("signal → gate-accuracy-check: all tables populated correctly", async () => {
    // ── Setup temp repo ──────────────────────────────────────────────────────
    tmpDir = join(tmpdir(), `ga-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const registryDir = join(tmpDir, ".minds", "state", "pipeline-registry");
    const configDir   = join(tmpDir, ".minds", "config");
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify(PIPELINE_JSON, null, 2)
    );
    writeFileSync(
      join(registryDir, `${TICKET_ID}.json`),
      JSON.stringify({ ticket_id: TICKET_ID, nonce: NONCE, current_step: "impl", status: "running" }, null, 2)
    );

    // ── Seed metrics DB ──────────────────────────────────────────────────────
    const metricsPath = join(tmpDir, ".minds", "state", "metrics.db");
    const db = openMetricsDb(metricsPath);
    ensureRun(db, TICKET_ID);
    recordPhase(db, {
      ticketId:    TICKET_ID,
      phase:       "impl",
      startedAt:   new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcome:     "IMPL_COMPLETE",
    });
    insertGate(db, TICKET_ID, "plan_review", "PASS", "Looks good");
    db.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run(TICKET_ID);
    db.close();

    // ── Step 1: send signal through signal-validate.ts ───────────────────────
    const sigProc = await Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../execution/signal-validate.ts"),
        `[SIGNAL:${TICKET_ID}:${NONCE}] IMPL_COMPLETE | Implementation finished`,
      ],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await sigProc.exited;
    expect(sigProc.exitCode).toBe(0);

    // ── Step 2: run gate-accuracy-check.ts ───────────────────────────────────
    const gacProc = await Bun.spawn(
      ["bun", join(import.meta.dir, "gate-accuracy-check.ts"), TICKET_ID],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await gacProc.exited;
    expect(gacProc.exitCode).toBe(0);

    const gacOut = JSON.parse(await new Response(gacProc.stdout).text());
    expect(gacOut.updated).toBe(1);
    expect(gacOut.gates).toHaveLength(1);
    expect(gacOut.gates[0].gate).toBe("plan_review");
    expect(gacOut.gates[0].truePositiveRate).toBe(1);
    expect(gacOut.gates[0].falsePositiveRate).toBe(0);

    // ── Step 3: verify all tables ────────────────────────────────────────────
    const verify = openMetricsDb(metricsPath);

    // runs table: outcome set
    const run = verify.query("SELECT outcome FROM runs WHERE id = ?").get(TICKET_ID) as any;
    expect(run.outcome).toBe("IMPL_COMPLETE");

    // phases table: impl phase recorded
    const phase = verify.query("SELECT phase, outcome FROM phases WHERE run_id = ?").get(TICKET_ID) as any;
    expect(phase.phase).toBe("impl");
    expect(phase.outcome).toBe("IMPL_COMPLETE");

    // signals table: signal logged by signal-validate
    const signal = verify.query("SELECT parsed_ok, signal_type FROM signals WHERE run_id = ?").get(TICKET_ID) as any;
    expect(signal).not.toBeNull();
    expect(signal.parsed_ok).toBe(1);
    expect(signal.signal_type).toBe("IMPL_COMPLETE");

    // gates table: accuracy evaluated by gate-accuracy-check
    const gate = verify.query("SELECT accurate, downstream_outcome FROM gates WHERE run_id = ?").get(TICKET_ID) as any;
    expect(gate.accurate).toBe(1);
    expect(gate.downstream_outcome).toBe("IMPL_COMPLETE");

    verify.close();
  });
});
