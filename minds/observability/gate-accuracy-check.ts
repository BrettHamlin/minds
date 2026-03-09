#!/usr/bin/env bun

/**
 * gate-accuracy-check.ts — System node: evaluate gate accuracy at TERMINAL
 *
 * Fires after the terminal phase. Reads all gate rows for this run from
 * metrics.db, determines whether each gate decision was accurate based on
 * the run's final outcome, and UPDATEs downstream_outcome + accurate flag.
 *
 * Skipped automatically when pipeline.metrics.enabled === false (@metrics(false)).
 * Works with any pipeline shape — no hardcoded gate or phase names.
 *
 * Usage:
 *   bun gate-accuracy-check.ts <TICKET_ID>
 *
 * Exit codes:
 *   0 = success (gates updated, JSON summary on stdout)
 *   1 = usage error (missing TICKET_ID)
 *   2 = runtime error (DB failure)
 *   3 = skipped (@metrics disabled)
 */

// TODO(WD): getRepoRoot/validateTicketIdArg should be requested via parent escalation once Pipeline Core is a Mind.
import { getRepoRoot } from "@minds/pipeline_core/repo"; // CROSS-MIND
import { validateTicketIdArg } from "@minds/pipeline_core/validation"; // CROSS-MIND
import { exitIfMetricsDisabled } from "./metrics-guard";
import { openMetricsDb } from "./metrics";
import { updateGateAccuracy, getGateAccuracyReport } from "./gate-accuracy-lib";
import { metricsDbPath } from "@minds/shared/paths";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "gate-accuracy-check.ts");
  const ticketId = args[0];

  if (!ticketId) {
    console.error(
      JSON.stringify({ error: "Usage: gate-accuracy-check.ts <TICKET_ID>" })
    );
    process.exit(1);
  }

  const repoRoot = getRepoRoot();

  exitIfMetricsDisabled(repoRoot);

  try {
    const db = openMetricsDb(metricsDbPath());

    const updated = updateGateAccuracy(db, ticketId);
    const report = getGateAccuracyReport(db, ticketId);

    db.close();

    console.log(JSON.stringify({ updated: updated.length, gates: report }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
