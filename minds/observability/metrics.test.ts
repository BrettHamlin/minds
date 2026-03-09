import { describe, expect, test, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  openInMemoryMetricsDb,
  ensureRun,
  recordPhase,
  completeRun,
  insertGate,
  insertSignal,
  insertIntervention,
} from "./metrics";

// ============================================================================
// DB Creation & Schema
// ============================================================================

describe("openInMemoryMetricsDb", () => {
  test("creates database with all 5 tables", () => {
    const db = openInMemoryMetricsDb();
    const tables = db
      .query(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all() as { name: string }[];

    const names = tables.map((t) => t.name);
    expect(names).toContain("runs");
    expect(names).toContain("phases");
    expect(names).toContain("gates");
    expect(names).toContain("signals");
    expect(names).toContain("interventions");
    db.close();
  });

  test("runs table has nullable cost and token columns", () => {
    const db = openInMemoryMetricsDb();
    const cols = db
      .query(`PRAGMA table_info(runs)`)
      .all() as { name: string; notnull: number }[];
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName["total_cost_usd"]).toBeDefined();
    expect(byName["total_tokens_in"]).toBeDefined();
    expect(byName["total_tokens_out"]).toBeDefined();
    // All cost/token columns must be nullable (notnull = 0)
    expect(byName["total_cost_usd"].notnull).toBe(0);
    expect(byName["total_tokens_in"].notnull).toBe(0);
    expect(byName["total_tokens_out"].notnull).toBe(0);
    db.close();
  });

  test("phases table has nullable cost and token columns", () => {
    const db = openInMemoryMetricsDb();
    const cols = db
      .query(`PRAGMA table_info(phases)`)
      .all() as { name: string; notnull: number }[];
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName["tokens_in"]).toBeDefined();
    expect(byName["tokens_out"]).toBeDefined();
    expect(byName["cost_usd"]).toBeDefined();
    expect(byName["tokens_in"].notnull).toBe(0);
    expect(byName["tokens_out"].notnull).toBe(0);
    expect(byName["cost_usd"].notnull).toBe(0);
    db.close();
  });

  test("calling twice returns independent in-memory databases", () => {
    const db1 = openInMemoryMetricsDb();
    const db2 = openInMemoryMetricsDb();
    ensureRun(db1, "BRE-100");
    const rows = db2.query("SELECT id FROM runs").all();
    expect(rows).toHaveLength(0);
    db1.close();
    db2.close();
  });
});

// ============================================================================
// ensureRun
// ============================================================================

describe("ensureRun", () => {
  let db: Database;

  beforeEach(() => {
    db = openInMemoryMetricsDb();
  });

  test("creates run row on first call", () => {
    ensureRun(db, "BRE-100");
    const row = db.query("SELECT * FROM runs WHERE id = 'BRE-100'").get() as any;
    expect(row).not.toBeNull();
    expect(row.ticket_id).toBe("BRE-100");
    expect(row.started_at).toBeDefined();
  });

  test("is idempotent — second call does not error or duplicate", () => {
    ensureRun(db, "BRE-100");
    ensureRun(db, "BRE-100"); // should not throw
    const rows = db.query("SELECT id FROM runs WHERE id = 'BRE-100'").all();
    expect(rows).toHaveLength(1);
  });

  test("stores source_repo when provided", () => {
    ensureRun(db, "BRE-100", "/home/user/projects/myrepo");
    const row = db.query("SELECT source_repo FROM runs WHERE id = 'BRE-100'").get() as any;
    expect(row.source_repo).toBe("/home/user/projects/myrepo");
  });

  test("source_repo is null when not provided", () => {
    ensureRun(db, "BRE-100");
    const row = db.query("SELECT source_repo FROM runs WHERE id = 'BRE-100'").get() as any;
    expect(row.source_repo).toBeNull();
  });

  test("stores explicit startedAt timestamp", () => {
    ensureRun(db, "BRE-100", null, "2026-01-01T00:00:00.000Z");
    const row = db.query("SELECT started_at FROM runs WHERE id = 'BRE-100'").get() as any;
    expect(row.started_at).toBe("2026-01-01T00:00:00.000Z");
  });

  test("returns the run_id", () => {
    const runId = ensureRun(db, "BRE-200");
    expect(runId).toBe("BRE-200");
  });

  test("works with any ticket id format", () => {
    ensureRun(db, "PROJ-1");
    ensureRun(db, "FEATURE-9999");
    ensureRun(db, "ticket-abc-123");
    const rows = db.query("SELECT id FROM runs").all() as { id: string }[];
    expect(rows).toHaveLength(3);
  });
});

// ============================================================================
// recordPhase
// ============================================================================

describe("recordPhase", () => {
  let db: Database;

  beforeEach(() => {
    db = openInMemoryMetricsDb();
  });

  test("inserts phase row", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "plan",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const row = db
      .query("SELECT * FROM phases WHERE id = 'BRE-100:plan'")
      .get() as any;
    expect(row).not.toBeNull();
    expect(row.phase).toBe("plan");
    expect(row.run_id).toBe("BRE-100");
    expect(row.started_at).toBe("2026-01-01T00:00:00.000Z");
  });

  test("auto-creates run row if it does not exist", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "clarify",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const run = db.query("SELECT id FROM runs WHERE id = 'BRE-100'").get();
    expect(run).not.toBeNull();
  });

  test("stores completedAt and outcome", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "plan",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      outcome: "PLAN_COMPLETE",
    });
    const row = db
      .query("SELECT completed_at, outcome FROM phases WHERE id = 'BRE-100:plan'")
      .get() as any;
    expect(row.completed_at).toBe("2026-01-01T00:01:00.000Z");
    expect(row.outcome).toBe("PLAN_COMPLETE");
  });

  test("stores durationMs when provided", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "tasks",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 3600000,
    });
    const row = db
      .query("SELECT duration_ms FROM phases WHERE id = 'BRE-100:tasks'")
      .get() as any;
    expect(row.duration_ms).toBe(3600000);
  });

  test("durationMs is null when not provided", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "plan",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const row = db
      .query("SELECT duration_ms FROM phases WHERE id = 'BRE-100:plan'")
      .get() as any;
    expect(row.duration_ms).toBeNull();
  });

  test("initial retry_count is 0", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "implement",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const row = db
      .query("SELECT retry_count FROM phases WHERE id = 'BRE-100:implement'")
      .get() as any;
    expect(row.retry_count).toBe(0);
  });

  test("increments retry_count on duplicate phase", () => {
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "plan",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    recordPhase(db, {
      ticketId: "BRE-100",
      phase: "plan",
      startedAt: "2026-01-01T00:10:00.000Z",
    });
    const row = db
      .query("SELECT retry_count FROM phases WHERE id = 'BRE-100:plan'")
      .get() as any;
    expect(row.retry_count).toBe(1);
  });

  test("second call on same phase does not create duplicate rows", () => {
    recordPhase(db, { ticketId: "BRE-100", phase: "plan", startedAt: "2026-01-01T00:00:00.000Z" });
    recordPhase(db, { ticketId: "BRE-100", phase: "plan", startedAt: "2026-01-01T00:10:00.000Z" });
    const rows = db.query("SELECT id FROM phases WHERE id = 'BRE-100:plan'").all();
    expect(rows).toHaveLength(1);
  });

  test("works with any phase name — no hardcoded phase list", () => {
    const phases = ["alpha", "beta", "gamma", "custom_phase_xyz"];
    for (const phase of phases) {
      recordPhase(db, { ticketId: "BRE-100", phase, startedAt: "2026-01-01T00:00:00.000Z" });
    }
    const rows = db.query("SELECT id FROM phases WHERE run_id = 'BRE-100'").all();
    expect(rows).toHaveLength(phases.length);
  });

  test("SELECT * FROM phases WHERE run_id returns complete breakdown", () => {
    const phaseNames = ["clarify", "plan", "tasks", "implement"];
    for (const phase of phaseNames) {
      recordPhase(db, {
        ticketId: "BRE-100",
        phase,
        startedAt: "2026-01-01T00:00:00.000Z",
        outcome: `${phase.toUpperCase()}_COMPLETE`,
      });
    }
    const rows = db
      .query("SELECT * FROM phases WHERE run_id = 'BRE-100' ORDER BY phase")
      .all() as any[];
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.phase).sort()).toEqual(phaseNames.sort());
  });
});

// ============================================================================
// completeRun
// ============================================================================

describe("completeRun", () => {
  let db: Database;

  beforeEach(() => {
    db = openInMemoryMetricsDb();
  });

  test("sets completed_at and outcome", () => {
    ensureRun(db, "BRE-100", null, "2026-01-01T00:00:00.000Z");
    completeRun(db, "BRE-100", "2026-01-01T01:00:00.000Z", "success");

    const row = db
      .query("SELECT completed_at, outcome FROM runs WHERE id = 'BRE-100'")
      .get() as any;
    expect(row.completed_at).toBe("2026-01-01T01:00:00.000Z");
    expect(row.outcome).toBe("success");
  });

  test("computes duration_ms from started_at to completed_at", () => {
    ensureRun(db, "BRE-100", null, "2026-01-01T00:00:00.000Z");
    completeRun(db, "BRE-100", "2026-01-01T01:00:00.000Z", "success");

    const row = db
      .query("SELECT duration_ms FROM runs WHERE id = 'BRE-100'")
      .get() as any;
    expect(row.duration_ms).toBe(3600000); // 1 hour in ms
  });

  test("no-ops gracefully if run does not exist", () => {
    // Should not throw
    expect(() =>
      completeRun(db, "BRE-NONEXISTENT", "2026-01-01T00:00:00.000Z", "success")
    ).not.toThrow();
  });
});

// ============================================================================
// insertGate
// ============================================================================

describe("insertGate", () => {
  let db: Database;

  beforeEach(() => {
    db = openInMemoryMetricsDb();
    ensureRun(db, "BRE-100");
  });

  test("inserts gate row and returns id", () => {
    const id = insertGate(db, "BRE-100", "plan-review", "pass");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const row = db.query("SELECT * FROM gates WHERE id = ?").get(id) as any;
    expect(row).not.toBeNull();
    expect(row.run_id).toBe("BRE-100");
    expect(row.gate).toBe("plan-review");
    expect(row.decision).toBe("pass");
  });

  test("stores reasoning when provided", () => {
    const id = insertGate(db, "BRE-100", "plan-review", "fail", "AC3 not covered");
    const row = db.query("SELECT reasoning FROM gates WHERE id = ?").get(id) as any;
    expect(row.reasoning).toBe("AC3 not covered");
  });

  test("reasoning is null when not provided", () => {
    const id = insertGate(db, "BRE-100", "plan-review", "pass");
    const row = db.query("SELECT reasoning FROM gates WHERE id = ?").get(id) as any;
    expect(row.reasoning).toBeNull();
  });

  test("each call generates a unique id", () => {
    const id1 = insertGate(db, "BRE-100", "plan-review", "pass");
    const id2 = insertGate(db, "BRE-100", "plan-review", "pass");
    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// insertSignal
// ============================================================================

describe("insertSignal", () => {
  let db: Database;

  beforeEach(() => {
    db = openInMemoryMetricsDb();
    ensureRun(db, "BRE-100");
  });

  test("inserts signal row and returns id", () => {
    const id = insertSignal(db, "BRE-100", "[SIGNAL:PLAN_COMPLETE]", true);
    expect(typeof id).toBe("string");

    const row = db.query("SELECT * FROM signals WHERE id = ?").get(id) as any;
    expect(row).not.toBeNull();
    expect(row.run_id).toBe("BRE-100");
    expect(row.raw).toBe("[SIGNAL:PLAN_COMPLETE]");
    expect(row.parsed_ok).toBe(1);
  });

  test("stores parsedOk=false as 0", () => {
    const id = insertSignal(db, "BRE-100", "garbage", false, { error: "parse error" });
    const row = db.query("SELECT parsed_ok, error FROM signals WHERE id = ?").get(id) as any;
    expect(row.parsed_ok).toBe(0);
    expect(row.error).toBe("parse error");
  });

  test("stores optional fields when provided", () => {
    const id = insertSignal(db, "BRE-100", "[SIGNAL:PLAN_COMPLETE]", true, {
      signalType: "PLAN_COMPLETE",
      phase: "plan",
      emittedAt: "2026-01-01T00:00:00.000Z",
      processedAt: "2026-01-01T00:00:01.000Z",
      latencyMs: 1000,
    });
    const row = db.query("SELECT * FROM signals WHERE id = ?").get(id) as any;
    expect(row.signal_type).toBe("PLAN_COMPLETE");
    expect(row.phase).toBe("plan");
    expect(row.emitted_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.processed_at).toBe("2026-01-01T00:00:01.000Z");
    expect(row.latency_ms).toBe(1000);
  });

  test("emitted_at defaults to now when not provided", () => {
    const before = new Date().toISOString();
    const id = insertSignal(db, "BRE-100", "[SIGNAL:PLAN_COMPLETE]", true);
    const after = new Date().toISOString();
    const row = db.query("SELECT emitted_at FROM signals WHERE id = ?").get(id) as any;
    expect(row.emitted_at >= before).toBe(true);
    expect(row.emitted_at <= after).toBe(true);
  });

  test("each call generates a unique id", () => {
    const id1 = insertSignal(db, "BRE-100", "[SIGNAL:PLAN_COMPLETE]", true);
    const id2 = insertSignal(db, "BRE-100", "[SIGNAL:PLAN_COMPLETE]", true);
    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// insertIntervention
// ============================================================================

describe("insertIntervention", () => {
  let db: Database;

  beforeEach(() => {
    db = openInMemoryMetricsDb();
    ensureRun(db, "BRE-100");
  });

  test("inserts intervention row and returns id", () => {
    const id = insertIntervention(db, "BRE-100", "plan", "human-edit");
    expect(typeof id).toBe("string");

    const row = db.query("SELECT * FROM interventions WHERE id = ?").get(id) as any;
    expect(row).not.toBeNull();
    expect(row.run_id).toBe("BRE-100");
    expect(row.phase).toBe("plan");
    expect(row.type).toBe("human-edit");
    expect(row.occurred_at).toBeDefined();
  });

  test("stores description when provided", () => {
    const id = insertIntervention(db, "BRE-100", "implement", "correction", "Fixed wrong file path");
    const row = db.query("SELECT description FROM interventions WHERE id = ?").get(id) as any;
    expect(row.description).toBe("Fixed wrong file path");
  });

  test("description is null when not provided", () => {
    const id = insertIntervention(db, "BRE-100", "plan", "human-edit");
    const row = db.query("SELECT description FROM interventions WHERE id = ?").get(id) as any;
    expect(row.description).toBeNull();
  });

  test("phase can be null", () => {
    const id = insertIntervention(db, "BRE-100", null, "abort");
    const row = db.query("SELECT phase FROM interventions WHERE id = ?").get(id) as any;
    expect(row.phase).toBeNull();
  });

  test("occurred_at is set automatically", () => {
    const before = new Date().toISOString();
    const id = insertIntervention(db, "BRE-100", "plan", "human-edit");
    const after = new Date().toISOString();
    const row = db.query("SELECT occurred_at FROM interventions WHERE id = ?").get(id) as any;
    expect(row.occurred_at >= before).toBe(true);
    expect(row.occurred_at <= after).toBe(true);
  });

  test("each call generates a unique id", () => {
    const id1 = insertIntervention(db, "BRE-100", "plan", "human-edit");
    const id2 = insertIntervention(db, "BRE-100", "plan", "human-edit");
    expect(id1).not.toBe(id2);
  });
});
