#!/usr/bin/env bun

/**
 * registry-read.ts - Read ticket registry file
 *
 * Usage:
 *   bun commands/registry-read.ts <TICKET_ID>
 *   bun commands/registry-read.ts <TICKET_ID> --field <field-name> [--default <value>]
 *
 * Output (stdout):
 *   Full JSON (default), or raw field value when --field is specified
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error (missing argument)
 *   3 = file error (not found, malformed JSON)
 */

import {
  getRepoRoot,
  readJsonFile,
  registryPath,
  validateTicketIdArg,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";

export function readRegistry(ticketId: string, repoRoot: string): Record<string, unknown> {
  const regPath = registryPath(repoRoot, ticketId);
  const data = readJsonFile(regPath);
  if (data === null) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Registry not found: ${regPath}`);
  }
  return data;
}

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "registry-read.ts");
  if (args.length < 1) {
    console.error("Usage: registry-read.ts <TICKET_ID> [--field <name>] [--default <value>]");
    process.exit(1);
  }

  // Parse flags
  const ticketId = args[0];
  let fieldName: string | undefined;
  let defaultValue: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--field" && args[i + 1]) {
      fieldName = args[++i];
    } else if (args[i] === "--default" && args[i + 1] !== undefined) {
      defaultValue = args[++i];
    }
  }

  try {
    const repoRoot = getRepoRoot();
    const data = readRegistry(ticketId, repoRoot);

    if (fieldName !== undefined) {
      const val = data[fieldName];
      if (val === undefined || val === null) {
        console.log(defaultValue ?? "");
      } else {
        console.log(String(val));
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
