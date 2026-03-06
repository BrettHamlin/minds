#!/usr/bin/env bun

/**
 * create-draft-pr.ts — System node: create GitHub draft PR before TERMINAL
 *
 * Fires before the terminal phase. Creates a GitHub draft PR for the current
 * feature branch and stamps pr_url, pr_number, pr_branch on the runs row in
 * metrics.db.
 *
 * Skipped automatically when pipeline.metrics.enabled === false (@metrics(false)).
 * Works with any pipeline shape — no hardcoded phase or gate names.
 *
 * Usage:
 *   bun create-draft-pr.ts <TICKET_ID>
 *
 * Exit codes:
 *   0 = success (PR created, JSON summary on stdout)
 *   1 = usage error (missing TICKET_ID)
 *   2 = runtime error (gh command failed, DB failure, git error)
 *   3 = skipped (@metrics disabled)
 */

import { execSync } from "child_process";
// TODO(WD): getRepoRoot/validateTicketIdArg should be requested via parent escalation once Pipeline Core is a Mind.
import { getRepoRoot, validateTicketIdArg } from "../../src/lib/pipeline/utils";
import { exitIfMetricsDisabled } from "./metrics-guard";
import {
  openMetricsDb,
  ensureRun,
  stampPrOnRun,
} from "./metrics";
import { createDraftPr } from "./draft-pr-lib";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "create-draft-pr.ts");
  const ticketId = args[0];

  if (!ticketId) {
    console.error(
      JSON.stringify({ error: "Usage: create-draft-pr.ts <TICKET_ID>" })
    );
    process.exit(1);
  }

  const repoRoot = getRepoRoot();

  exitIfMetricsDisabled(repoRoot);

  try {
    // Get current branch from git
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();

    // Create draft PR via gh
    const result = createDraftPr(ticketId, branch, { cwd: repoRoot });

    // Stamp DB
    const db = openMetricsDb(`${repoRoot}/.collab/state/metrics.db`);
    ensureRun(db, ticketId);
    stampPrOnRun(db, ticketId, result.prUrl, result.prNumber, result.prBranch);
    db.close();

    console.log(
      JSON.stringify({
        ticketId,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        prBranch: result.prBranch,
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
