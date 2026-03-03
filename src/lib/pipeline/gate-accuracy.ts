/**
 * Gate accuracy — evaluate how well gate decisions correlate with outcomes.
 *
 * Called by the gate_accuracy_check system node at TERMINAL, after all
 * phase outcomes are known.
 *
 * Logic:
 *   PASS + run succeeded  → accurate = 1  (true positive)
 *   PASS + run failed     → accurate = 0  (false positive)
 *   FAIL + run succeeded  → accurate = 1  (true negative — gate caught real issue, was fixed)
 *   FAIL + run failed     → accurate = null (indeterminate — failure may be unrelated)
 *
 * Category: System node backing library. Called by gate-accuracy-check.ts.
 * Reads from and writes to the SQLite metrics.db gates and runs tables.
 */

import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

export interface GateAccuracyRow {
  id: string;
  gate: string;
  decision: string;
  downstreamOutcome: string | null;
  accurate: number | null;
}

export interface GateAccuracySummary {
  gate: string;
  totalDecisions: number;
  passCount: number;
  failCount: number;
  /** Fraction of PASS decisions that were correct. Null if no PASS decisions recorded. */
  truePositiveRate: number | null;
  /** Fraction of PASS decisions that were incorrect. Null if no PASS decisions recorded. */
  falsePositiveRate: number | null;
}

// ============================================================================
// Core: update gate accuracy at TERMINAL
// ============================================================================

/**
 * Update downstream_outcome and accurate flag for all gates in a run.
 *
 * Reads the run's final outcome from the runs table and evaluates each gate
 * decision against it. Returns the updated rows.
 *
 * Safe to call on runs with no gates (returns empty array).
 */
export function updateGateAccuracy(db: Database, runId: string): GateAccuracyRow[] {
  const run = db
    .query("SELECT outcome FROM runs WHERE id = ?")
    .get(runId) as { outcome: string | null } | null;

  const runOutcome = run?.outcome ?? null;
  const runSucceeded = runOutcome !== null && runOutcome.endsWith("_COMPLETE");

  const gates = db
    .query("SELECT id, gate, decision FROM gates WHERE run_id = ?")
    .all(runId) as Array<{ id: string; gate: string; decision: string }>;

  const results: GateAccuracyRow[] = [];

  for (const gate of gates) {
    let accurate: number | null = null;

    if (gate.decision === "PASS") {
      accurate = runSucceeded ? 1 : 0;
    } else if (gate.decision === "FAIL") {
      // FAIL + run succeeded = true negative (gate correctly caught an issue that was fixed)
      // FAIL + run failed   = indeterminate (null — can't distinguish TN from FN without more data)
      accurate = runSucceeded ? 1 : null;
    }

    db.query("UPDATE gates SET downstream_outcome = ?, accurate = ? WHERE id = ?")
      .run(runOutcome, accurate, gate.id);

    results.push({
      id: gate.id,
      gate: gate.gate,
      decision: gate.decision,
      downstreamOutcome: runOutcome,
      accurate,
    });
  }

  return results;
}

// ============================================================================
// Reporting: per-gate accuracy summary
// ============================================================================

/**
 * Aggregate gate accuracy stats from the SQLite database.
 *
 * When runId is provided, restricts to that run.
 * When omitted, aggregates across all runs (for the --gates dashboard).
 */
export function getGateAccuracyReport(
  db: Database,
  runId?: string
): GateAccuracySummary[] {
  const whereClause = runId ? "WHERE run_id = ?" : "";
  const params: string[] = runId ? [runId] : [];

  const rows = db
    .query(
      `SELECT gate,
              COUNT(*)                                                     AS total,
              SUM(CASE WHEN decision = 'PASS' THEN 1 ELSE 0 END)          AS pass_count,
              SUM(CASE WHEN decision = 'FAIL' THEN 1 ELSE 0 END)          AS fail_count,
              SUM(CASE WHEN decision = 'PASS' AND accurate = 1 THEN 1 ELSE 0 END) AS true_positives,
              SUM(CASE WHEN decision = 'PASS' AND accurate = 0 THEN 1 ELSE 0 END) AS false_positives
         FROM gates
         ${whereClause}
         GROUP BY gate
         ORDER BY gate`
    )
    .all(...params) as Array<{
    gate: string;
    total: number;
    pass_count: number;
    fail_count: number;
    true_positives: number;
    false_positives: number;
  }>;

  return rows.map((row) => {
    const passCount = row.pass_count;
    const tp = row.true_positives;
    const fp = row.false_positives;
    const evaluated = tp + fp; // PASS decisions with a known outcome

    return {
      gate: row.gate,
      totalDecisions: row.total,
      passCount,
      failCount: row.fail_count,
      truePositiveRate: evaluated > 0 ? tp / evaluated : null,
      falsePositiveRate: evaluated > 0 ? fp / evaluated : null,
    };
  });
}
