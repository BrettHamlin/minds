#!/usr/bin/env bun

/**
 * classify-run.ts — System node: classify run as autonomous or not at TERMINAL
 *
 * Fires after the terminal phase. Reads the interventions table for this run,
 * stamps autonomous (1/0) and intervention_count on the runs row, and reports
 * all three autonomy rate windows (last10, 30d, all-time) on stdout.
 *
 * Skipped automatically when pipeline.metrics.enabled === false (@metrics(false)).
 * Works with any pipeline shape — no hardcoded phase or gate names.
 *
 * Usage:
 *   bun classify-run.ts <TICKET_ID>
 *
 * Exit codes:
 *   0 = success (run classified, JSON summary on stdout)
 *   1 = usage error (missing TICKET_ID)
 *   2 = runtime error (DB failure)
 *   3 = skipped (@metrics disabled)
 */

import { getRepoRoot, exitIfMetricsDisabled, validateTicketIdArg } from "./orchestrator-utils";
import { openMetricsDb } from "../../lib/pipeline/metrics";
import { classifyRun } from "../../lib/pipeline/classify-run";
import { getAllAutonomyRates } from "../../lib/pipeline/autonomy-rate";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "classify-run.ts");
  const ticketId = args[0];

  if (!ticketId) {
    console.error(
      JSON.stringify({ error: "Usage: classify-run.ts <TICKET_ID>" })
    );
    process.exit(1);
  }

  const repoRoot = getRepoRoot();

  exitIfMetricsDisabled(repoRoot);

  try {
    const dbPath = `${repoRoot}/.collab/state/metrics.db`;
    const db = openMetricsDb(dbPath);

    const result = classifyRun(db, ticketId);
    const autonomyRates = getAllAutonomyRates(db);

    db.close();

    console.log(JSON.stringify({ ...result, autonomyRates }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
