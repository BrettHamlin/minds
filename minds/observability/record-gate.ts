#!/usr/bin/env bun

/**
 * record-gate.ts — Record a gate evaluation decision in metrics.db
 *
 * Called by the orchestrator after every gate evaluation (step d).
 * Non-fatal: if this fails, gate routing continues normally.
 *
 * Usage:
 *   bun record-gate.ts <TICKET_ID> <GATE_NAME> <DECISION> [REASONING]
 *
 * Exit codes:
 *   0 = success (gate row inserted, JSON summary on stdout)
 *   1 = usage error (missing required args)
 *   2 = runtime error (DB failure)
 *   3 = skipped (@metrics disabled)
 */

// TODO(WD): getRepoRoot should be requested via parent escalation once Pipeline Core is a Mind.
import { getRepoRoot } from "../pipeline_core/repo"; // CROSS-MIND
import { exitIfMetricsDisabled } from "./metrics-guard";
import { openMetricsDb, insertGate } from "./metrics";

function main(): void {
  const args = process.argv.slice(2);
  const [ticketId, gateName, decision, reasoning] = args;

  if (!ticketId || !gateName || !decision) {
    console.error(
      JSON.stringify({
        error: "Usage: record-gate.ts <TICKET_ID> <GATE_NAME> <DECISION> [REASONING]",
      })
    );
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  exitIfMetricsDisabled(repoRoot);

  try {
    const dbPath = `${repoRoot}/.collab/state/metrics.db`;
    const db = openMetricsDb(dbPath);

    const id = insertGate(db, ticketId, gateName, decision, reasoning ?? null);

    db.close();

    console.log(JSON.stringify({ ticketId, gate: gateName, decision, id }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
