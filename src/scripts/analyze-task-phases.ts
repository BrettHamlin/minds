#!/usr/bin/env bun

/**
 * analyze-task-phases.ts — Parse tasks.md and output phase structure as JSON.
 *
 * Ticket ID is REQUIRED — the script uses findFeatureDir to locate the feature
 * directory containing tasks.md.
 *
 * Usage:
 *   bun analyze-task-phases.ts <TICKET_ID>
 *
 * Output JSON to stdout:
 *   {
 *     "totalPhases": 5,
 *     "phases": [
 *       { "number": 1, "title": "Setup", "total": 8, "complete": 3, "incomplete": 5 }
 *     ],
 *     "nextIncompletePhase": 2
 *   }
 *
 * nextIncompletePhase is null when all phases are complete.
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error or feature/tasks not found
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { getRepoRoot, validateTicketIdArg, findFeatureDir } from "../lib/pipeline/utils";
import { parseTaskPhases } from "../lib/pipeline/task-phases";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "analyze-task-phases.ts");

  if (args.length < 1) {
    console.error("Usage: analyze-task-phases.ts <TICKET_ID>");
    process.exit(1);
  }

  const ticketId = args[0];
  const repoRoot = getRepoRoot();

  // Resolve feature directory via the shared utility (4-pass resolution)
  const featureDir = findFeatureDir(repoRoot, ticketId);
  if (!featureDir) {
    console.error(`Error: feature directory not found for ticket ${ticketId}`);
    process.exit(1);
  }

  const tasksPath = join(featureDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    console.error(`Error: tasks.md not found at ${tasksPath}`);
    process.exit(1);
  }

  const content = readFileSync(tasksPath, "utf-8");
  const phases = parseTaskPhases(content);

  // First phase that still has incomplete tasks
  const nextIncompletePhase = phases.find((p) => p.incomplete > 0)?.number ?? null;

  const output = {
    totalPhases: phases.length,
    phases,
    nextIncompletePhase,
  };

  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) {
  main();
}
