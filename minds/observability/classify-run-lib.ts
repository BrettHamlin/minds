/**
 * Classify run as autonomous or not.
 *
 * Called by the classify_run system node at TERMINAL, after all phase
 * outcomes are known. Reads the interventions table for this run and
 * stamps autonomous + intervention_count on the runs row.
 *
 * Logic:
 *   0 interventions → autonomous = true  (fully autonomous run)
 *   1+ interventions → autonomous = false (required human involvement)
 *
 * Category: System node backing library. Called by classify-run.ts CLI.
 * Reads from and writes to the SQLite metrics.db interventions and runs tables.
 */

import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

export interface ClassifyRunResult {
  runId: string;
  autonomous: boolean;
  interventionCount: number;
  durationMs: number | null;
}

// ============================================================================
// Core: classify a run at TERMINAL
// ============================================================================

/**
 * Classify a run as autonomous or not based on its intervention count.
 *
 * Reads all intervention rows for the run, stamps autonomous (1/0) and
 * intervention_count on the runs table row. Returns the classification.
 *
 * Safe to call on runs with no interventions (returns autonomous=true).
 * Idempotent: re-classifying a run overwrites the previous verdict.
 */
export function classifyRun(db: Database, runId: string): ClassifyRunResult {
  const interventionRow = db
    .query("SELECT COUNT(*) as count FROM interventions WHERE run_id = ?")
    .get(runId) as { count: number } | null;

  const interventionCount = interventionRow?.count ?? 0;
  const autonomous = interventionCount === 0;

  db
    .query("UPDATE runs SET autonomous = ?, intervention_count = ? WHERE id = ?")
    .run(autonomous ? 1 : 0, interventionCount, runId);

  const runRow = db
    .query("SELECT duration_ms, started_at, completed_at FROM runs WHERE id = ?")
    .get(runId) as { duration_ms: number | null; started_at: string | null; completed_at: string | null } | null;

  let durationMs = runRow?.duration_ms ?? null;

  // Compute duration from timestamps when duration_ms is NULL
  if (durationMs === null && runRow?.started_at) {
    const start = new Date(runRow.started_at).getTime();
    const end = runRow.completed_at
      ? new Date(runRow.completed_at).getTime()
      : Date.now();
    if (!isNaN(start) && !isNaN(end)) {
      durationMs = end - start;
      db.query("UPDATE runs SET duration_ms = ? WHERE id = ?").run(durationMs, runId);
    }
  }

  return { runId, autonomous, interventionCount, durationMs };
}
