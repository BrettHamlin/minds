// BRE-282: classify_run — autonomy classification and rate calculation
import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  openMetricsDb,
  openInMemoryMetricsDb,
  ensureRun,
  insertIntervention,
  recordPhase,
} from "../../lib/pipeline/metrics";
import { classifyRun } from "../../lib/pipeline/classify-run";
import {
  getAutonomyRate,
  getAllAutonomyRates,
} from "../../lib/pipeline/autonomy-rate";
import type { Database } from "bun:sqlite";

// ============================================================================
// Unit tests: classifyRun
// ============================================================================

describe("classifyRun — no interventions", () => {
  test("0 interventions → autonomous=true, interventionCount=0", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-1");

    const result = classifyRun(db, "CR-1");

    expect(result.autonomous).toBe(true);
    expect(result.interventionCount).toBe(0);
    expect(result.runId).toBe("CR-1");
    db.close();
  });

  test("stamps autonomous=1 and intervention_count=0 on runs row", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-2");

    classifyRun(db, "CR-2");

    const row = db.query("SELECT autonomous, intervention_count FROM runs WHERE id = 'CR-2'").get() as any;
    expect(row.autonomous).toBe(1);
    expect(row.intervention_count).toBe(0);
    db.close();
  });
});

describe("classifyRun — with interventions", () => {
  test("1 intervention → autonomous=false, interventionCount=1", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-3");
    insertIntervention(db, "CR-3", "impl", "manual_signal", "Wrong nonce");

    const result = classifyRun(db, "CR-3");

    expect(result.autonomous).toBe(false);
    expect(result.interventionCount).toBe(1);
    db.close();
  });

  test("multiple interventions → autonomous=false, interventionCount=N", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-4");
    insertIntervention(db, "CR-4", "plan", "manual_signal", "Stale signal");
    insertIntervention(db, "CR-4", "impl", "manual_fix",   "Force status=done");
    insertIntervention(db, "CR-4", null,   "abort",        "Manual kill");

    const result = classifyRun(db, "CR-4");

    expect(result.autonomous).toBe(false);
    expect(result.interventionCount).toBe(3);
    db.close();
  });

  test("stamps autonomous=0 and correct intervention_count on runs row", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-5");
    insertIntervention(db, "CR-5", "impl", "abort", "Manual kill");
    insertIntervention(db, "CR-5", "impl", "manual_signal", "Bad nonce");

    classifyRun(db, "CR-5");

    const row = db.query("SELECT autonomous, intervention_count FROM runs WHERE id = 'CR-5'").get() as any;
    expect(row.autonomous).toBe(0);
    expect(row.intervention_count).toBe(2);
    db.close();
  });

  test("does not touch other runs' interventions", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-A");
    ensureRun(db, "CR-B");
    insertIntervention(db, "CR-B", "impl", "manual_signal", "Stale");

    const result = classifyRun(db, "CR-A");

    expect(result.autonomous).toBe(true);
    expect(result.interventionCount).toBe(0);
    db.close();
  });

  test("is idempotent — re-classifying overwrites previous verdict", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "CR-6");

    const first = classifyRun(db, "CR-6");
    expect(first.autonomous).toBe(true);

    insertIntervention(db, "CR-6", "impl", "abort", "Late kill");
    const second = classifyRun(db, "CR-6");
    expect(second.autonomous).toBe(false);
    expect(second.interventionCount).toBe(1);

    const row = db.query("SELECT autonomous FROM runs WHERE id = 'CR-6'").get() as any;
    expect(row.autonomous).toBe(0);
    db.close();
  });
});

// ============================================================================
// Unit tests: getAutonomyRate
// ============================================================================

describe("getAutonomyRate — alltime window", () => {
  function buildDb(spec: Array<{ autonomous: boolean }>): Database {
    const db: Database = openInMemoryMetricsDb();
    spec.forEach(({ autonomous }, i) => {
      const id = `RT-${i}`;
      ensureRun(db, id);
      db.query("UPDATE runs SET autonomous = ? WHERE id = ?").run(autonomous ? 1 : 0, id);
    });
    return db;
  }

  test("4 runs, 3 autonomous → rate=0.75", () => {
    const db = buildDb([
      { autonomous: true },
      { autonomous: true },
      { autonomous: true },
      { autonomous: false },
    ]);
    const r = getAutonomyRate(db, "alltime");
    expect(r.total).toBe(4);
    expect(r.autonomous).toBe(3);
    expect(r.rate).toBeCloseTo(0.75);
    db.close();
  });

  test("all autonomous → rate=1.0", () => {
    const db = buildDb([
      { autonomous: true },
      { autonomous: true },
    ]);
    const r = getAutonomyRate(db, "alltime");
    expect(r.rate).toBe(1.0);
    db.close();
  });

  test("none autonomous → rate=0.0", () => {
    const db = buildDb([
      { autonomous: false },
      { autonomous: false },
    ]);
    const r = getAutonomyRate(db, "alltime");
    expect(r.rate).toBe(0.0);
    db.close();
  });

  test("no classified runs → rate=null, total=0", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "UNCLASSIFIED");
    // autonomous remains NULL
    const r = getAutonomyRate(db, "alltime");
    expect(r.rate).toBeNull();
    expect(r.total).toBe(0);
    db.close();
  });

  test("empty DB → rate=null", () => {
    const db: Database = openInMemoryMetricsDb();
    const r = getAutonomyRate(db, "alltime");
    expect(r.rate).toBeNull();
    expect(r.total).toBe(0);
    db.close();
  });
});

describe("getAutonomyRate — last10 window", () => {
  test("12 classified runs → only 10 most recent counted", () => {
    const db: Database = openInMemoryMetricsDb();
    // Insert 12 runs: oldest 2 are non-autonomous; newest 10 are all autonomous
    const base = new Date("2025-01-01T00:00:00Z");
    for (let i = 0; i < 12; i++) {
      const id = `L10-${i.toString().padStart(2, "0")}`;
      const startedAt = new Date(base.getTime() + i * 60_000).toISOString();
      db.query("INSERT INTO runs (id, ticket_id, started_at) VALUES (?, ?, ?)").run(id, id, startedAt);
      // Oldest 2 (i=0,1) are non-autonomous; rest are autonomous
      db.query("UPDATE runs SET autonomous = ? WHERE id = ?").run(i < 2 ? 0 : 1, id);
    }
    const r = getAutonomyRate(db, "last10");
    // Last 10 runs = i=2..11, all autonomous → rate=1.0
    expect(r.total).toBe(10);
    expect(r.autonomous).toBe(10);
    expect(r.rate).toBe(1.0);
    db.close();
  });

  test("fewer than 10 runs → counts all", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "LT10-A");
    ensureRun(db, "LT10-B");
    db.query("UPDATE runs SET autonomous = 1 WHERE id = 'LT10-A'").run();
    db.query("UPDATE runs SET autonomous = 0 WHERE id = 'LT10-B'").run();
    const r = getAutonomyRate(db, "last10");
    expect(r.total).toBe(2);
    expect(r.rate).toBeCloseTo(0.5);
    db.close();
  });
});

describe("getAutonomyRate — 30days window", () => {
  test("runs older than 30 days excluded", () => {
    const db: Database = openInMemoryMetricsDb();
    // Recent run — autonomous
    db.query("INSERT INTO runs (id, ticket_id, started_at) VALUES (?, ?, datetime('now', '-5 days'))").run("30D-RECENT", "30D-RECENT");
    db.query("UPDATE runs SET autonomous = 1 WHERE id = '30D-RECENT'").run();
    // Old run — non-autonomous (outside 30d window)
    db.query("INSERT INTO runs (id, ticket_id, started_at) VALUES (?, ?, datetime('now', '-60 days'))").run("30D-OLD", "30D-OLD");
    db.query("UPDATE runs SET autonomous = 0 WHERE id = '30D-OLD'").run();

    const r = getAutonomyRate(db, "30days");
    expect(r.total).toBe(1);
    expect(r.autonomous).toBe(1);
    expect(r.rate).toBe(1.0);
    db.close();
  });
});

describe("getAllAutonomyRates", () => {
  test("returns all 3 windows", () => {
    const db: Database = openInMemoryMetricsDb();
    ensureRun(db, "GAR-1");
    db.query("UPDATE runs SET autonomous = 1 WHERE id = 'GAR-1'").run();

    const rates = getAllAutonomyRates(db);
    expect(rates).toHaveLength(3);
    expect(rates.map((r) => r.window)).toEqual(["last10", "30days", "alltime"]);
    db.close();
  });
});

// ============================================================================
// Integration: classify-run.ts CLI via Bun.spawn
// ============================================================================

describe("classify-run CLI integration", () => {
  let tmpDir: string;

  const PIPELINE_JSON = {
    version: "3.1",
    metrics: { enabled: true },
    phases: {
      impl: { signals: ["IMPL_COMPLETE"], transitions: { IMPL_COMPLETE: { to: "done" } } },
      done: { terminal: true },
    },
  };

  function setupTmpRepo(ticketId: string): { metricsPath: string } {
    tmpDir = join(
      tmpdir(),
      `cr-int-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const stateDir  = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir = join(tmpDir, ".collab", "config");
    mkdirSync(stateDir,  { recursive: true });
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify(PIPELINE_JSON, null, 2)
    );
    writeFileSync(
      join(stateDir, `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, status: "done" }, null, 2)
    );

    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");
    const db = openMetricsDb(metricsPath);
    ensureRun(db, ticketId);
    db.close();

    return { metricsPath };
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("exits 0 and outputs JSON summary", async () => {
    setupTmpRepo("BRE-CR-1");

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), "BRE-CR-1"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(out.runId).toBe("BRE-CR-1");
    expect(out.autonomous).toBe(true);
    expect(out.interventionCount).toBe(0);
    expect(out.autonomyRates).toHaveLength(3);
  });

  test("classifies as non-autonomous when interventions exist", async () => {
    const { metricsPath } = setupTmpRepo("BRE-CR-2");

    const db = openMetricsDb(metricsPath);
    insertIntervention(db, "BRE-CR-2", "impl", "abort", "Manual kill");
    db.close();

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), "BRE-CR-2"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(out.autonomous).toBe(false);
    expect(out.interventionCount).toBe(1);
  });

  test("stamps DB correctly after CLI run", async () => {
    const { metricsPath } = setupTmpRepo("BRE-CR-3");
    const db0 = openMetricsDb(metricsPath);
    insertIntervention(db0, "BRE-CR-3", "plan", "manual_fix", "Force done");
    db0.close();

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), "BRE-CR-3"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT autonomous, intervention_count FROM runs WHERE id = 'BRE-CR-3'").get() as any;
    db.close();
    expect(row.autonomous).toBe(0);
    expect(row.intervention_count).toBe(1);
  });

  test("exits 1 when no TICKET_ID provided", async () => {
    tmpDir = join(tmpdir(), `cr-noid-${Date.now()}`);
    mkdirSync(join(tmpDir, ".collab", "config"), { recursive: true });
    writeFileSync(join(tmpDir, ".collab", "config", "pipeline.json"), "{}");

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts")],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
    expect(proc.exitCode).toBe(1);
  });

  test("exits 3 when @metrics(false) in pipeline config", async () => {
    tmpDir = join(tmpdir(), `cr-disabled-${Date.now()}`);
    mkdirSync(join(tmpDir, ".collab", "config"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".collab", "config", "pipeline.json"),
      JSON.stringify({ metrics: { enabled: false } })
    );

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), "BRE-CR-SKIP"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(3);
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(out.skipped).toBe(true);
  });

  test("autonomyRates reflect history across multiple runs", async () => {
    const { metricsPath } = setupTmpRepo("BRE-CR-4");

    // Add a second classified run
    const db = openMetricsDb(metricsPath);
    ensureRun(db, "BRE-CR-4B");
    db.query("UPDATE runs SET autonomous = 1 WHERE id = 'BRE-CR-4B'").run();
    db.close();

    const proc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), "BRE-CR-4"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const out = JSON.parse(await new Response(proc.stdout).text());
    const alltime = out.autonomyRates.find((r: any) => r.window === "alltime");
    // BRE-CR-4B was pre-classified (autonomous=1); BRE-CR-4 just classified (autonomous=1)
    expect(alltime.total).toBe(2);
    expect(alltime.autonomous).toBe(2);
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

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("autonomous run: signal → classify-run → autonomous=true", async () => {
    const TICKET_ID = "BRE-911";
    const NONCE     = "fee1f0";

    tmpDir = join(tmpdir(), `cr-e2e-auto-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir   = join(tmpDir, ".collab", "config");
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(configDir,   { recursive: true });

    writeFileSync(join(configDir, "pipeline.json"), JSON.stringify(PIPELINE_JSON, null, 2));
    writeFileSync(
      join(registryDir, `${TICKET_ID}.json`),
      JSON.stringify({ ticket_id: TICKET_ID, nonce: NONCE, current_step: "impl", status: "running" }, null, 2)
    );

    // Seed: run + phase (no interventions)
    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");
    const db0 = openMetricsDb(metricsPath);
    ensureRun(db0, TICKET_ID);
    recordPhase(db0, {
      ticketId:    TICKET_ID,
      phase:       "impl",
      startedAt:   new Date().toISOString(),
      completedAt: new Date().toISOString(),
      outcome:     "IMPL_COMPLETE",
    });
    db0.query("UPDATE runs SET outcome = 'IMPL_COMPLETE' WHERE id = ?").run(TICKET_ID);
    db0.close();

    // Step 1: valid signal through signal-validate.ts
    const sigProc = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        `[SIGNAL:${TICKET_ID}:${NONCE}] IMPL_COMPLETE | Implementation done`],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await sigProc.exited;
    expect(sigProc.exitCode).toBe(0);

    // Step 2: classify-run.ts
    const crProc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), TICKET_ID],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await crProc.exited;
    expect(crProc.exitCode).toBe(0);

    const crOut = JSON.parse(await new Response(crProc.stdout).text());
    expect(crOut.autonomous).toBe(true);
    expect(crOut.interventionCount).toBe(0);

    // Step 3: verify DB
    const verify = openMetricsDb(metricsPath);

    const run = verify.query("SELECT autonomous, intervention_count FROM runs WHERE id = ?").get(TICKET_ID) as any;
    expect(run.autonomous).toBe(1);
    expect(run.intervention_count).toBe(0);

    const interventions = verify.query("SELECT COUNT(*) as c FROM interventions WHERE run_id = ?").get(TICKET_ID) as any;
    expect(interventions.c).toBe(0);

    const signal = verify.query("SELECT parsed_ok, signal_type FROM signals WHERE run_id = ?").get(TICKET_ID) as any;
    expect(signal.parsed_ok).toBe(1);
    expect(signal.signal_type).toBe("IMPL_COMPLETE");

    verify.close();
  });

  test("non-autonomous run: nonce-mismatch signal → classify-run → autonomous=false", async () => {
    const TICKET_ID = "BRE-912";
    const REAL_NONCE = "abcdef";
    const BAD_NONCE  = "dead00";

    tmpDir = join(tmpdir(), `cr-e2e-nonauto-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir   = join(tmpDir, ".collab", "config");
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(configDir,   { recursive: true });

    writeFileSync(join(configDir, "pipeline.json"), JSON.stringify(PIPELINE_JSON, null, 2));
    writeFileSync(
      join(registryDir, `${TICKET_ID}.json`),
      JSON.stringify({ ticket_id: TICKET_ID, nonce: REAL_NONCE, current_step: "impl", status: "running" }, null, 2)
    );

    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");
    const db0 = openMetricsDb(metricsPath);
    ensureRun(db0, TICKET_ID);
    db0.close();

    // Step 1: signal with WRONG nonce → triggers manual_signal intervention
    const sigProc = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        `[SIGNAL:${TICKET_ID}:${BAD_NONCE}] IMPL_COMPLETE | Stale signal`],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await sigProc.exited;
    expect(sigProc.exitCode).toBe(2); // validation error

    // Step 2: classify-run.ts — sees the intervention → not autonomous
    const crProc = await Bun.spawn(
      ["bun", join(import.meta.dir, "classify-run.ts"), TICKET_ID],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await crProc.exited;
    expect(crProc.exitCode).toBe(0);

    const crOut = JSON.parse(await new Response(crProc.stdout).text());
    expect(crOut.autonomous).toBe(false);
    expect(crOut.interventionCount).toBe(1);

    // Step 3: verify interventions table
    const verify = openMetricsDb(metricsPath);
    const intervention = verify.query("SELECT type, phase FROM interventions WHERE run_id = ?").get(TICKET_ID) as any;
    expect(intervention).not.toBeNull();
    expect(intervention.type).toBe("manual_signal");
    expect(intervention.phase).toBe("impl");
    verify.close();
  });
});
