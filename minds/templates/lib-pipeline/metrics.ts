/**
 * Pipeline metrics — SQLite store for phase timing and cost tracking.
 *
 * Database lives at .collab/state/metrics.db
 * Tables: runs, phases, gates, signals, interventions
 *
 * Cost/token columns are nullable — populated by a future ticket once a
 * reliable token-capture method exists.
 *
 * Category: Middleware. Always on. Fires on every phase transition.
 * No user declaration or pipeline config required. Cannot be disabled.
 */

import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Schema
// ============================================================================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id                 TEXT PRIMARY KEY,
  ticket_id          TEXT NOT NULL,
  source_repo        TEXT,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  duration_ms        INTEGER,
  total_cost_usd     REAL,
  total_tokens_in    INTEGER,
  total_tokens_out   INTEGER,
  outcome            TEXT,
  autonomous         INTEGER,
  intervention_count INTEGER DEFAULT 0,
  config_hash        TEXT,
  pr_url             TEXT,
  pr_number          INTEGER,
  pr_branch          TEXT
);

CREATE TABLE IF NOT EXISTS phases (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  phase        TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  duration_ms  INTEGER,
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  cost_usd     REAL,
  outcome      TEXT,
  retry_count  INTEGER DEFAULT 0,
  prompt_hash  TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS gates (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL,
  gate               TEXT NOT NULL,
  decision           TEXT,
  reasoning          TEXT,
  downstream_outcome TEXT,
  accurate           INTEGER,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS signals (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  raw          TEXT NOT NULL,
  parsed_ok    INTEGER NOT NULL,
  error        TEXT,
  signal_type  TEXT,
  phase        TEXT,
  emitted_at   TEXT NOT NULL,
  processed_at TEXT,
  latency_ms   INTEGER,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS interventions (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  phase       TEXT,
  type        TEXT NOT NULL,
  description TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
`;

// ============================================================================
// Migrations
// ============================================================================

const PR_MIGRATIONS = [
  "ALTER TABLE runs ADD COLUMN pr_url TEXT",
  "ALTER TABLE runs ADD COLUMN pr_number INTEGER",
  "ALTER TABLE runs ADD COLUMN pr_branch TEXT",
];

function applyPrMigrations(db: Database): void {
  for (const sql of PR_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists in this DB */
    }
  }
}

// ============================================================================
// Types
// ============================================================================

export interface PhaseRecord {
  ticketId: string;
  phase: string;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  outcome?: string | null;
  retryCount?: number;
}

// ============================================================================
// DB Factory
// ============================================================================

/**
 * Open (or create) the metrics database at the given file path.
 * Creates all 5 tables on first use. Safe to call on every pipeline run.
 */
export function openMetricsDb(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec(SCHEMA_SQL);
  applyPrMigrations(db);
  return db;
}

/**
 * Open an in-memory database for testing.
 * Identical schema to openMetricsDb — does not persist to disk.
 */
export function openInMemoryMetricsDb(): Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA_SQL);
  applyPrMigrations(db);
  return db;
}

// ============================================================================
// Run Management
// ============================================================================

/**
 * Ensure a run row exists for the given ticket.
 * Uses ticket_id as the run id (one active run per ticket at a time).
 * Creates the row if absent; no-ops if it already exists.
 * Returns the run_id.
 */
export function ensureRun(
  db: Database,
  ticketId: string,
  sourceRepo: string | null = null,
  startedAt: string = new Date().toISOString()
): string {
  const runId = ticketId;
  const existing = db.query("SELECT id FROM runs WHERE id = ?").get(runId);
  if (!existing) {
    db
      .query(
        `INSERT INTO runs (id, ticket_id, source_repo, started_at) VALUES (?, ?, ?, ?)`
      )
      .run(runId, ticketId, sourceRepo, startedAt);
  }
  return runId;
}

/**
 * Mark a run as completed with final outcome and computed duration.
 */
export function completeRun(
  db: Database,
  ticketId: string,
  completedAt: string,
  outcome: string
): void {
  const runId = ticketId;
  const row = db
    .query("SELECT started_at FROM runs WHERE id = ?")
    .get(runId) as { started_at: string } | null;

  let durationMs: number | null = null;
  if (row) {
    const start = new Date(row.started_at).getTime();
    const end = new Date(completedAt).getTime();
    if (!isNaN(start) && !isNaN(end)) durationMs = end - start;
  }

  db
    .query(
      `UPDATE runs SET completed_at = ?, duration_ms = ?, outcome = ? WHERE id = ?`
    )
    .run(completedAt, durationMs, outcome, runId);
}

// ============================================================================
// PR Stamping
// ============================================================================

/**
 * Stamp a completed PR's URL, number, and branch onto the runs row.
 * Called by create-draft-pr.ts after successful gh pr create.
 */
export function stampPrOnRun(
  db: Database,
  runId: string,
  prUrl: string,
  prNumber: number,
  prBranch: string
): void {
  db.query(
    "UPDATE runs SET pr_url = ?, pr_number = ?, pr_branch = ? WHERE id = ?"
  ).run(prUrl, prNumber, prBranch, runId);
}

// ============================================================================
// Gate, Signal, Intervention Inserts
// ============================================================================

/**
 * Insert a gate evaluation record. Returns the generated id.
 */
export function insertGate(
  db: Database,
  runId: string,
  gate: string,
  decision: string,
  reasoning?: string | null
): string {
  const id = crypto.randomUUID();
  db
    .query(
      `INSERT INTO gates (id, run_id, gate, decision, reasoning) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, runId, gate, decision, reasoning ?? null);
  return id;
}

/**
 * Insert a signal record. Returns the generated id.
 * emitted_at defaults to now if not provided (column is NOT NULL).
 */
export function insertSignal(
  db: Database,
  runId: string,
  raw: string,
  parsedOk: boolean,
  fields?: {
    error?: string;
    signalType?: string;
    phase?: string;
    emittedAt?: string;
    processedAt?: string;
    latencyMs?: number;
  }
): string {
  const id = crypto.randomUUID();
  db
    .query(
      `INSERT INTO signals (id, run_id, raw, parsed_ok, error, signal_type, phase, emitted_at, processed_at, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      runId,
      raw,
      parsedOk ? 1 : 0,
      fields?.error ?? null,
      fields?.signalType ?? null,
      fields?.phase ?? null,
      fields?.emittedAt ?? new Date().toISOString(),
      fields?.processedAt ?? null,
      fields?.latencyMs ?? null
    );
  return id;
}

/**
 * Insert an intervention record. Returns the generated id.
 */
export function insertIntervention(
  db: Database,
  runId: string,
  phase: string | null,
  type: string,
  description?: string | null
): string {
  const id = crypto.randomUUID();
  db
    .query(
      `INSERT INTO interventions (id, run_id, phase, type, description, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, runId, phase, type, description ?? null, new Date().toISOString());
  return id;
}

// ============================================================================
// Phase Recording
// ============================================================================

/**
 * Record a phase transition event. Creates the parent run row if needed.
 *
 * Phase id = `${ticketId}:${phase}` — stable per phase per run.
 * On retry (duplicate id), increments retry_count and updates timestamps.
 *
 * started_at and completed_at are set to the same value when called from
 * --append-phase-history (completion event only). duration_ms is nullable
 * until explicit start-time tracking is added.
 */
export function recordPhase(db: Database, record: PhaseRecord): void {
  const runId = ensureRun(db, record.ticketId, null, record.startedAt);
  const phaseId = `${record.ticketId}:${record.phase}`;

  const existing = db
    .query("SELECT id FROM phases WHERE id = ?")
    .get(phaseId) as { id: string } | null;

  if (existing) {
    db
      .query(
        `UPDATE phases
         SET started_at = ?, completed_at = ?, duration_ms = ?, outcome = ?,
             retry_count = retry_count + 1
         WHERE id = ?`
      )
      .run(
        record.startedAt,
        record.completedAt ?? null,
        record.durationMs ?? null,
        record.outcome ?? null,
        phaseId
      );
  } else {
    db
      .query(
        `INSERT INTO phases
           (id, run_id, phase, started_at, completed_at, duration_ms, outcome, retry_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        phaseId,
        runId,
        record.phase,
        record.startedAt,
        record.completedAt ?? null,
        record.durationMs ?? null,
        record.outcome ?? null,
        record.retryCount ?? 0
      );
  }
}
