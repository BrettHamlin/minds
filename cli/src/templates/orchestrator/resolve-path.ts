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

import { getRepoRoot } from "./orchestrator-utils";
import { findFeatureDir } from "../../lib/pipeline/utils";
import { registryPath, signalQueuePath, findingsPath, resolutionsPath } from "../../lib/pipeline/paths";

const [, , ticketId, pathType, ...rest] = process.argv;

if (!ticketId || !pathType) {
  console.error(
    "Usage: resolve-path.ts <TICKET_ID> registry|signal-queue|findings|resolutions [phase] [round]",
  );
  process.exit(1);
}

const repoRoot = getRepoRoot();

function resolveFeatureSubpath(
  pathFn: (featureDir: string, phase: string, round: number) => string,
  typeName: string,
): void {
  const phase = rest[0];
  const round = parseInt(rest[1] ?? "1", 10);
  if (!phase) {
    console.error(`Usage: resolve-path.ts <TICKET_ID> ${typeName} <phase> <round>`);
    process.exit(1);
  }
  const featureDir = findFeatureDir(repoRoot, ticketId);
  if (!featureDir) {
    console.error(`[resolve-path] Feature directory not found for ticket: ${ticketId}`);
    process.exit(1);
  }
  console.log(pathFn(featureDir, phase, round));
}

switch (pathType) {
  case "registry":
    console.log(registryPath(repoRoot, ticketId));
    break;

  case "signal-queue":
    console.log(signalQueuePath(repoRoot, ticketId));
    break;

  case "findings":
    resolveFeatureSubpath(findingsPath, "findings");
    break;

  case "resolutions":
    resolveFeatureSubpath(resolutionsPath, "resolutions");
    break;

  default:
    console.error(
      `[resolve-path] Unknown path type: "${pathType}". Valid types: registry, signal-queue, findings, resolutions`,
    );
    process.exit(1);
}
