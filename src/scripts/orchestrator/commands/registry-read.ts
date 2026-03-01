#!/usr/bin/env bun

/**
 * registry-read.ts - Read ticket registry file
 *
 * Usage:
 *   bun commands/registry-read.ts <TICKET_ID>
 *
 * Output (stdout):
 *   Pretty-printed JSON contents of the registry file
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error (missing argument)
 *   3 = file error (not found, malformed JSON)
 */

import {
  getRepoRoot,
  readJsonFile,
  getRegistryPath,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";

export function readRegistry(ticketId: string, registryDir: string): Record<string, unknown> {
  const registryPath = getRegistryPath(registryDir, ticketId);
  const data = readJsonFile(registryPath);
  if (data === null) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Registry not found: ${registryPath}`);
  }
  return data;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: registry-read.ts <TICKET_ID>");
    process.exit(1);
  }

  try {
    const ticketId = args[0];
    const repoRoot = getRepoRoot();
    const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
    const data = readRegistry(ticketId, registryDir);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
