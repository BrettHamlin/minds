#!/usr/bin/env bun

/**
 * complete-run.ts — System node: finalize run record at TERMINAL
 *
 * Fires at pipeline completion. Reads the last phase outcome, then calls
 * completeRun() to stamp completed_at, duration_ms, and outcome on the runs row.
 *
 * Must fire BEFORE gate-accuracy-check.ts, which reads runs.outcome.
 * Must fire AFTER create-draft-pr.ts (.before TERMINAL ordering).
 *
 * Skipped automatically when pipeline.metrics.enabled === false (@metrics(false)).
 *
 * Usage:
 *   bun complete-run.ts <TICKET_ID>
 *
 * Exit codes:
 *   0 = success (run finalized, JSON summary on stdout)
 *   1 = usage error (missing TICKET_ID)
 *   2 = runtime error (DB failure)
 *   3 = skipped (@metrics disabled)
 */

// TODO(WD): getRepoRoot/validateTicketIdArg should be requested via parent escalation once Pipeline Core is a Mind.
import { getRepoRoot } from "../pipeline_core/repo"; // CROSS-MIND
import { validateTicketIdArg } from "../pipeline_core/validation"; // CROSS-MIND
import { exitIfMetricsDisabled } from "./metrics-guard";
import { openMetricsDb, completeRun } from "./metrics";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "complete-run.ts");
  const ticketId = args[0];

  if (!ticketId) {
    console.error(
      JSON.stringify({ error: "Usage: complete-run.ts <TICKET_ID>" })
    );
    process.exit(1);
  }

  const repoRoot = getRepoRoot();

  exitIfMetricsDisabled(repoRoot);

  try {
    const dbPath = `${repoRoot}/.collab/state/metrics.db`;
    const db = openMetricsDb(dbPath);

    // Read last phase outcome to use as run outcome
    const lastPhase = db
      .query(
        `SELECT outcome FROM phases
         WHERE run_id = ?
         ORDER BY completed_at DESC
         LIMIT 1`
      )
      .get(ticketId) as { outcome: string | null } | null;

    const outcome = lastPhase?.outcome ?? null;
    const completedAt = new Date().toISOString();

    completeRun(db, ticketId, completedAt, outcome ?? "unknown");

    // Read back the stamped row for the summary
    const row = db
      .query("SELECT completed_at, duration_ms, outcome FROM runs WHERE id = ?")
      .get(ticketId) as {
      completed_at: string | null;
      duration_ms: number | null;
      outcome: string | null;
    } | null;

    db.close();

    console.log(
      JSON.stringify({
        ticketId,
        completedAt: row?.completed_at ?? completedAt,
        durationMs: row?.duration_ms ?? null,
        outcome: row?.outcome ?? outcome,
      })
    );
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
