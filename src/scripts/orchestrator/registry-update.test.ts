import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ALLOWED_FIELDS,
  applyUpdates,
  appendPhaseHistory,
  parseFieldValue,
} from "./registry-update";
import { openMetricsDb } from "../../lib/pipeline/metrics";

// ============================================================================
// parseFieldValue
// ============================================================================

describe("parseFieldValue", () => {
  test("parses valid string field=value", () => {
    const result = parseFieldValue("current_step=plan");
    expect(result).toEqual({ field: "current_step", value: "plan" });
  });

  test("parses numeric value as number", () => {
    const result = parseFieldValue("retry_count=3");
    expect(result).toEqual({ field: "retry_count", value: 3 });
  });

  test("parses zero as number", () => {
    const result = parseFieldValue("error_count=0");
    expect(result).toEqual({ field: "error_count", value: 0 });
  });

  test("returns null for missing equals sign", () => {
    expect(parseFieldValue("current_step")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseFieldValue("")).toBeNull();
  });

  test("returns null for uppercase field name", () => {
    expect(parseFieldValue("FIELD=value")).toBeNull();
  });

  test("returns null for field with hyphens", () => {
    expect(parseFieldValue("my-field=value")).toBeNull();
  });

  test("handles value containing equals sign", () => {
    const result = parseFieldValue("worktree_path=/tmp/foo=bar");
    expect(result).toEqual({ field: "worktree_path", value: "/tmp/foo=bar" });
  });

  test("non-numeric value stays as string", () => {
    const result = parseFieldValue("status=running");
    expect(result).toEqual({ field: "status", value: "running" });
  });
});

// ============================================================================
// applyUpdates
// ============================================================================

describe("applyUpdates", () => {
  test("applies single field update", () => {
    const registry = { ticket_id: "BRE-100", current_step: "clarify" };
    const result = applyUpdates(registry, { current_step: "plan" });

    expect(result.current_step).toBe("plan");
    expect(result.ticket_id).toBe("BRE-100");
    expect(result.updated_at).toBeDefined();
  });

  test("applies multiple field updates", () => {
    const registry = { ticket_id: "BRE-100", status: "running" };
    const result = applyUpdates(registry, {
      status: "held",
      held_at: "clarify",
    });

    expect(result.status).toBe("held");
    expect(result.held_at).toBe("clarify");
  });

  test("preserves numeric values as numbers", () => {
    const registry = { ticket_id: "BRE-100", retry_count: 0 };
    const result = applyUpdates(registry, { retry_count: 3 });

    expect(result.retry_count).toBe(3);
    expect(typeof result.retry_count).toBe("number");
  });

  test("sets updated_at timestamp in ISO format", () => {
    const registry = { ticket_id: "BRE-100" };
    const result = applyUpdates(registry, { status: "running" });

    // Should match ISO 8601 format without milliseconds
    expect(result.updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    );
  });

  test("does not mutate original registry", () => {
    const registry = { ticket_id: "BRE-100", status: "running" };
    const original = { ...registry };
    applyUpdates(registry, { status: "held" });

    expect(registry).toEqual(original);
  });
});

// ============================================================================
// appendPhaseHistory
// ============================================================================

describe("appendPhaseHistory", () => {
  test("appends entry to existing phase_history", () => {
    const registry = {
      ticket_id: "BRE-100",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
      ],
    };
    const entry = {
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00Z",
    };
    const result = appendPhaseHistory(registry, entry);

    expect(result.phase_history).toHaveLength(2);
    expect(result.phase_history[1]).toEqual(entry);
    expect(result.updated_at).toBeDefined();
  });

  test("initializes phase_history array if missing", () => {
    const registry = { ticket_id: "BRE-100" };
    const entry = {
      phase: "clarify",
      signal: "CLARIFY_COMPLETE",
      ts: "2026-01-01T00:00:00Z",
    };
    const result = appendPhaseHistory(registry, entry);

    expect(result.phase_history).toHaveLength(1);
    expect(result.phase_history[0]).toEqual(entry);
  });

  test("does not mutate original registry", () => {
    const originalHistory = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
    ];
    const registry = {
      ticket_id: "BRE-100",
      phase_history: originalHistory,
    };
    appendPhaseHistory(registry, {
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00Z",
    });

    expect(registry.phase_history).toHaveLength(1);
  });

  test("does not mutate original phase_history array", () => {
    const originalHistory = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
    ];
    const registry = { ticket_id: "BRE-100", phase_history: originalHistory };
    appendPhaseHistory(registry, {
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00Z",
    });

    expect(originalHistory).toHaveLength(1);
  });
});

// ============================================================================
// ALLOWED_FIELDS
// ============================================================================

describe("ALLOWED_FIELDS", () => {
  test("contains all expected fields", () => {
    const expected = [
      "current_step", "nonce", "status", "color_index", "group_id",
      "agent_pane_id", "orchestrator_pane_id", "worktree_path",
      "last_signal", "last_signal_at", "error_count", "retry_count",
      "held_at", "waiting_for",
    ];
    for (const field of expected) {
      expect(ALLOWED_FIELDS.has(field)).toBe(true);
    }
  });

  test("contains new registry fields: implement_phase_plan, repo_id, repo_path", () => {
    expect(ALLOWED_FIELDS.has("implement_phase_plan")).toBe(true);
    expect(ALLOWED_FIELDS.has("repo_id")).toBe(true);
    expect(ALLOWED_FIELDS.has("repo_path")).toBe(true);
  });

  test("rejects unknown fields", () => {
    expect(ALLOWED_FIELDS.has("bogus_field")).toBe(false);
    expect(ALLOWED_FIELDS.has("ticket_id")).toBe(false);
  });
});

// ============================================================================
// Integration: SQLite metrics written alongside JSON registry
// ============================================================================

describe("registry-update integration (SQLite + JSON)", () => {
  let tmpDir: string;

  // Each test gets a fresh temp dir that looks like a repo root
  function setupTmpRepo(ticketId: string): { registryPath: string; metricsPath: string } {
    tmpDir = join(tmpdir(), `reg-upd-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    mkdirSync(registryDir, { recursive: true });

    const registry = {
      ticket_id: ticketId,
      nonce: "abc123",
      current_step: "clarify",
      status: "running",
    };
    const registryPath = join(registryDir, `${ticketId}.json`);
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");

    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");
    return { registryPath, metricsPath };
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("--append-phase-history writes phase row to SQLite", async () => {
    const { registryPath, metricsPath } = setupTmpRepo("BRE-INT-1");

    const entry = JSON.stringify({
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00.000Z",
    });

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-1", "--append-phase-history", entry],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(0);

    // SQLite phase row must exist
    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT * FROM phases WHERE id = 'BRE-INT-1:plan'").get() as any;
    db.close();

    expect(row).not.toBeNull();
    expect(row.phase).toBe("plan");
    expect(row.outcome).toBe("PLAN_COMPLETE");
    expect(row.started_at).toBe("2026-01-01T01:00:00.000Z");
  });

  test("--append-phase-history: JSON registry format unchanged (backward compat)", async () => {
    const { registryPath } = setupTmpRepo("BRE-INT-2");
    const before = JSON.parse(readFileSync(registryPath, "utf-8"));

    const entry = JSON.stringify({
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00.000Z",
    });

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-2", "--append-phase-history", entry],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const after = JSON.parse(readFileSync(registryPath, "utf-8"));

    // All original fields preserved
    expect(after.ticket_id).toBe(before.ticket_id);
    expect(after.nonce).toBe(before.nonce);
    expect(after.current_step).toBe(before.current_step);
    expect(after.status).toBe(before.status);

    // phase_history appended
    expect(Array.isArray(after.phase_history)).toBe(true);
    expect(after.phase_history).toHaveLength(1);
    expect(after.phase_history[0].phase).toBe("plan");
    expect(after.phase_history[0].signal).toBe("PLAN_COMPLETE");

    // updated_at added
    expect(after.updated_at).toBeDefined();
  });

  test("field=value update: run row created in SQLite", async () => {
    const { metricsPath } = setupTmpRepo("BRE-INT-3");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-3", "current_step=plan"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT id, ticket_id FROM runs WHERE id = 'BRE-INT-3'").get() as any;
    db.close();

    expect(row).not.toBeNull();
    expect(row.ticket_id).toBe("BRE-INT-3");
  });

  test("SQLite failure does not affect JSON registry exit code", async () => {
    const { registryPath } = setupTmpRepo("BRE-INT-4");

    // Make the state dir read-only so SQLite cannot create metrics.db
    const stateDir = join(tmpDir, ".collab", "state");
    const { chmodSync } = await import("fs");
    chmodSync(stateDir, 0o555);

    const entry = JSON.stringify({ phase: "plan", signal: "PLAN_COMPLETE", ts: "2026-01-01T00:00:00Z" });

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-4", "--append-phase-history", entry],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    // Restore permissions before cleanup
    chmodSync(stateDir, 0o755);

    // JSON write still succeeded — exit 0
    expect(result.exitCode).toBe(0);

    // JSON still updated correctly
    const after = JSON.parse(readFileSync(registryPath, "utf-8"));
    expect(after.phase_history).toHaveLength(1);
  });

  test("status=done: manual_fix intervention logged to SQLite", async () => {
    const { metricsPath } = setupTmpRepo("BRE-INT-5");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-5", "status=done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const intervention = db
      .query("SELECT type, phase FROM interventions WHERE run_id = 'BRE-INT-5'")
      .get() as any;
    db.close();

    expect(intervention).not.toBeNull();
    expect(intervention.type).toBe("manual_fix");
    expect(intervention.phase).toBe("clarify"); // current_step from registry
  });

  test("status=abandoned: manual_fix intervention logged", async () => {
    const { metricsPath } = setupTmpRepo("BRE-INT-6");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-6", "status=abandoned"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const count = db
      .query("SELECT COUNT(*) as c FROM interventions WHERE run_id = 'BRE-INT-6'")
      .get() as any;
    db.close();

    expect(count.c).toBe(1);
  });

  test("status=running: no intervention logged (non-terminal status)", async () => {
    const { metricsPath } = setupTmpRepo("BRE-INT-7");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-7", "status=running"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const count = db
      .query("SELECT COUNT(*) as c FROM interventions WHERE run_id = 'BRE-INT-7'")
      .get() as any;
    db.close();

    expect(count.c).toBe(0);
  });

  test("status=done when current_step is already terminal phase: no intervention (normal completion)", async () => {
    // Simulate the orchestrator's normal completion path:
    //   pipeline reached 'done' (terminal), now setting status=done for cleanup
    tmpDir = join(tmpdir(), `reg-upd-int-terminal-${Date.now()}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir   = join(tmpDir, ".collab", "config");
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(configDir,   { recursive: true });

    // Pipeline with 'done' as terminal phase
    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify({
        version: "3.1",
        phases: {
          impl: { signals: ["IMPL_COMPLETE"] },
          done: { terminal: true, signals: [] },
        },
      })
    );
    // Registry already at current_step=done (pipeline reached terminal normally)
    writeFileSync(
      join(registryDir, "BRE-INT-8.json"),
      JSON.stringify({ ticket_id: "BRE-INT-8", nonce: "abc123", current_step: "done", status: "running" }, null, 2)
    );

    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-8", "status=done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const count = db
      .query("SELECT COUNT(*) as c FROM interventions WHERE run_id = 'BRE-INT-8'")
      .get() as any;
    db.close();

    // Normal completion — no intervention should be logged
    expect(count.c).toBe(0);
  });

  test("status=done when mid-pipeline with pipeline.json present: intervention logged", async () => {
    // Force-setting status=done while still in impl phase → manual override
    tmpDir = join(tmpdir(), `reg-upd-int-midpipe-${Date.now()}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir   = join(tmpDir, ".collab", "config");
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(configDir,   { recursive: true });

    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify({
        version: "3.1",
        phases: {
          impl: { signals: ["IMPL_COMPLETE"] },
          done: { terminal: true, signals: [] },
        },
      })
    );
    // Registry still in impl — NOT at terminal
    writeFileSync(
      join(registryDir, "BRE-INT-9.json"),
      JSON.stringify({ ticket_id: "BRE-INT-9", nonce: "abc123", current_step: "impl", status: "running" }, null, 2)
    );

    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "registry-update.ts"), "BRE-INT-9", "status=done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;
    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const intervention = db
      .query("SELECT type, phase FROM interventions WHERE run_id = 'BRE-INT-9'")
      .get() as any;
    db.close();

    expect(intervention).not.toBeNull();
    expect(intervention.type).toBe("manual_fix");
    expect(intervention.phase).toBe("impl");
  });
});
