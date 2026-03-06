/**
 * Dashboard — read-only query library for the pipeline run dashboard.
 *
 * Provides new query functions for run listing, phase filtering, and quality
 * stats. Reuses existing query functions from gate-accuracy.ts and
 * autonomy-rate.ts — does NOT duplicate queries that already exist there.
 *
 * Category: Dashboard query library. Called by metrics-dashboard.ts CLI.
 * Read-only: never writes to the database.
 */

import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

export interface RunSummary {
  runId: string;
  ticketId: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  outcome: string | null;
  phaseCount: number;
  autonomous: number | null;
  interventionCount: number;
  prUrl: string | null;
  prNumber: number | null;
  prBranch: string | null;
}

export interface PhaseBottleneck {
  phase: string;
  avgDurationMs: number;
  count: number;
}

export interface QualitySummary {
  totalRuns: number;
  runsWithPr: number;
  prs: Array<{
    runId: string;
    ticketId: string;
    prUrl: string;
    prNumber: number;
    prBranch: string | null;
  }>;
}

export interface ListRunsOptions {
  /** Max runs to return. Default: 10. */
  last?: number;
  /** Filter to runs that have at least one phase with this name. */
  phase?: string;
  /** Filter by run outcome category. */
  outcome?: "success" | "failure";
}

// ============================================================================
// Run listing
// ============================================================================

/**
 * Return runs ordered by started_at DESC, with optional filters.
 *
 * Phase count is computed via LEFT JOIN on the phases table.
 * Filters compose: all non-null options are ANDed together.
 */
export function listRuns(db: Database, options: ListRunsOptions = {}): RunSummary[] {
  const limit = options.last ?? 10;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.phase) {
    conditions.push(`r.id IN (SELECT DISTINCT run_id FROM phases WHERE phase = ?)`);
    params.push(options.phase);
  }

  if (options.outcome === "success") {
    conditions.push(`r.outcome LIKE '%_COMPLETE'`);
  } else if (options.outcome === "failure") {
    conditions.push(`r.outcome IS NOT NULL AND r.outcome NOT LIKE '%_COMPLETE'`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .query(
      `SELECT r.id,
              r.ticket_id,
              r.started_at,
              r.completed_at,
              r.duration_ms,
              r.outcome,
              r.autonomous,
              r.intervention_count,
              r.pr_url,
              r.pr_number,
              r.pr_branch,
              COUNT(p.id) AS phase_count
         FROM runs r
         LEFT JOIN phases p ON p.run_id = r.id
         ${where}
         GROUP BY r.id
         ORDER BY r.started_at DESC
         LIMIT ?`
    )
    .all(...params, limit) as Array<{
    id: string;
    ticket_id: string;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    outcome: string | null;
    autonomous: number | null;
    intervention_count: number;
    pr_url: string | null;
    pr_number: number | null;
    pr_branch: string | null;
    phase_count: number;
  }>;

  return rows.map((r) => ({
    runId: r.id,
    ticketId: r.ticket_id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationMs: r.duration_ms,
    outcome: r.outcome,
    phaseCount: r.phase_count,
    autonomous: r.autonomous,
    interventionCount: r.intervention_count ?? 0,
    prUrl: r.pr_url,
    prNumber: r.pr_number,
    prBranch: r.pr_branch,
  }));
}

// ============================================================================
// Bottleneck phases
// ============================================================================

/**
 * Return phases sorted by average duration descending.
 * Only counts phases with a recorded duration_ms.
 */
export function getBottleneckPhases(db: Database, limit = 10): PhaseBottleneck[] {
  const rows = db
    .query(
      `SELECT phase,
              AVG(duration_ms) AS avg_duration_ms,
              COUNT(*)         AS count
         FROM phases
         WHERE duration_ms IS NOT NULL
         GROUP BY phase
         ORDER BY avg_duration_ms DESC
         LIMIT ?`
    )
    .all(limit) as Array<{
    phase: string;
    avg_duration_ms: number;
    count: number;
  }>;

  return rows.map((r) => ({
    phase: r.phase,
    avgDurationMs: r.avg_duration_ms,
    count: r.count,
  }));
}

// ============================================================================
// Quality / PR stats
// ============================================================================

/**
 * Return PR outcomes from the runs table.
 * Includes all runs (totalRuns) and those with a pr_url (runsWithPr).
 */
export function getQualityStats(db: Database): QualitySummary {
  const totalRuns = (
    db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number }
  ).n;

  const rows = db
    .query(
      `SELECT id, ticket_id, pr_url, pr_number, pr_branch
         FROM runs
         WHERE pr_url IS NOT NULL
         ORDER BY started_at DESC`
    )
    .all() as Array<{
    id: string;
    ticket_id: string;
    pr_url: string;
    pr_number: number;
    pr_branch: string | null;
  }>;

  return {
    totalRuns,
    runsWithPr: rows.length,
    prs: rows.map((r) => ({
      runId: r.id,
      ticketId: r.ticket_id,
      prUrl: r.pr_url,
      prNumber: r.pr_number,
      prBranch: r.pr_branch,
    })),
  };
}
