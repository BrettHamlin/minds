/**
 * Autonomy rate — rolling rate calculation across pipeline runs.
 *
 * Three windows for the collab metrics dashboard:
 *   last10  — most recent 10 classified runs (near-term trend)
 *   30days  — classified runs started within the last 30 days
 *   alltime — all classified runs ever
 *
 * Only counts runs that have been classified (autonomous IS NOT NULL).
 * Formula: autonomous_runs / total_classified_runs in window.
 *
 * Category: Dashboard query library. Called by classify-run.ts CLI
 * and the collab metrics dashboard (BRE-281).
 */

import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

export type AutonomyWindow = "last10" | "30days" | "alltime";

export interface AutonomyRateResult {
  window: AutonomyWindow;
  /** Autonomy rate as a decimal (0.0–1.0). Null when no classified runs exist. */
  rate: number | null;
  autonomous: number;
  total: number;
}

// ============================================================================
// Core: rate calculation
// ============================================================================

/**
 * Calculate the autonomy rate for a given time window.
 *
 * Returns rate=null when no classified runs exist in the window.
 */
export function getAutonomyRate(
  db: Database,
  window: AutonomyWindow
): AutonomyRateResult {
  let rows: Array<{ autonomous: number }>;

  if (window === "last10") {
    rows = db
      .query(
        `SELECT autonomous FROM runs
         WHERE autonomous IS NOT NULL
         ORDER BY started_at DESC
         LIMIT 10`
      )
      .all() as Array<{ autonomous: number }>;
  } else if (window === "30days") {
    rows = db
      .query(
        `SELECT autonomous FROM runs
         WHERE autonomous IS NOT NULL
           AND started_at >= datetime('now', '-30 days')`
      )
      .all() as Array<{ autonomous: number }>;
  } else {
    rows = db
      .query(`SELECT autonomous FROM runs WHERE autonomous IS NOT NULL`)
      .all() as Array<{ autonomous: number }>;
  }

  const total = rows.length;
  const autonomous = rows.filter((r) => r.autonomous === 1).length;
  const rate = total > 0 ? autonomous / total : null;

  return { window, rate, autonomous, total };
}

/**
 * Calculate all three autonomy rate windows in one call.
 * Used by the classify-run.ts CLI for stdout reporting.
 */
export function getAllAutonomyRates(db: Database): AutonomyRateResult[] {
  return [
    getAutonomyRate(db, "last10"),
    getAutonomyRate(db, "30days"),
    getAutonomyRate(db, "alltime"),
  ];
}
