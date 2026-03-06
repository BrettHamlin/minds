#!/usr/bin/env bun
/**
 * resolve-path.ts — Deterministic path resolver CLI
 *
 * Resolves pipeline state file paths from a ticket ID so markdown commands
 * never need to construct paths inline.
 *
 * Usage:
 *   bun .collab/scripts/orchestrator/resolve-path.ts <TICKET_ID> registry
 *   bun .collab/scripts/orchestrator/resolve-path.ts <TICKET_ID> signal-queue
 *   bun .collab/scripts/orchestrator/resolve-path.ts <TICKET_ID> findings <phase> <round>
 *   bun .collab/scripts/orchestrator/resolve-path.ts <TICKET_ID> resolutions <phase> <round>
 *
 * Exit codes:
 *   0 = path resolved, printed to stdout
 *   1 = invalid arguments or feature directory not found
 */

import { getRepoRoot, findFeatureDir } from "../../lib/pipeline/utils";
import { registryPath, signalQueuePath, findingsPath, resolutionsPath } from "../../lib/pipeline/paths";

const [, , ticketId, pathType, ...rest] = process.argv;

if (!ticketId || !pathType) {
  console.error(
    "Usage: resolve-path.ts <TICKET_ID> registry|signal-queue|findings|resolutions [phase] [round]",
  );
  process.exit(1);
}

const repoRoot = getRepoRoot();

switch (pathType) {
  case "registry":
    console.log(registryPath(repoRoot, ticketId));
    break;

  case "signal-queue":
    console.log(signalQueuePath(repoRoot, ticketId));
    break;

  case "findings": {
    const phase = rest[0];
    const round = parseInt(rest[1] ?? "1", 10);
    if (!phase) {
      console.error("Usage: resolve-path.ts <TICKET_ID> findings <phase> <round>");
      process.exit(1);
    }
    const featureDir = findFeatureDir(repoRoot, ticketId);
    if (!featureDir) {
      console.error(`[resolve-path] Feature directory not found for ticket: ${ticketId}`);
      process.exit(1);
    }
    console.log(findingsPath(featureDir, phase, round));
    break;
  }

  case "resolutions": {
    const phase = rest[0];
    const round = parseInt(rest[1] ?? "1", 10);
    if (!phase) {
      console.error("Usage: resolve-path.ts <TICKET_ID> resolutions <phase> <round>");
      process.exit(1);
    }
    const featureDir = findFeatureDir(repoRoot, ticketId);
    if (!featureDir) {
      console.error(`[resolve-path] Feature directory not found for ticket: ${ticketId}`);
      process.exit(1);
    }
    console.log(resolutionsPath(featureDir, phase, round));
    break;
  }

  default:
    console.error(
      `[resolve-path] Unknown path type: "${pathType}". Valid types: registry, signal-queue, findings, resolutions`,
    );
    process.exit(1);
}
