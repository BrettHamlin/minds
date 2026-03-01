#!/usr/bin/env bun

/**
 * group-manage.ts - Manage coordination groups
 *
 * Create and manage coordination groups that link multiple tickets together
 * for synchronized pipeline operations (e.g., deploy gates).
 *
 * Subcommands:
 *   create <ticket_id> [ticket_id ...] - Create group from ticket IDs
 *   add <group_id> <ticket_id>         - Add ticket to existing group
 *   query <ticket_id>                  - Get group info for a ticket
 *   list <group_id>                    - List tickets in a group
 *
 * Output:
 *   JSON for query/list/create, confirmation for mutations
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error (invalid subcommand, missing args)
 *   2 = validation error (ticket not found in registry)
 *   3 = file error (group file corruption, write failure)
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  getRepoRoot,
  readJsonFile,
  writeJsonAtomic,
  getRegistryPath,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Group {
  group_id: string;
  tickets: string[];
  created_at: string;
  updated_at: string;
}

export interface TicketStatus {
  ticket_id: string;
  current_step: string;
  status: string;
  last_signal: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic group ID from sorted ticket IDs.
 * Uses first 12 chars of SHA-256 of sorted+joined IDs.
 */
export function generateGroupId(ticketIds: string[]): string {
  const sorted = [...ticketIds].sort().join(":");
  return createHash("sha256").update(sorted).digest("hex").substring(0, 12);
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Registry validation
// ---------------------------------------------------------------------------

function validateTicket(ticketId: string, registryDir: string): void {
  const regPath = getRegistryPath(registryDir, ticketId);
  if (!fs.existsSync(regPath)) {
    throw new OrchestratorError("VALIDATION", `No registry for ticket ${ticketId}`);
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export function cmdCreate(
  ticketIds: string[],
  registryDir: string,
  groupsDir: string
): Group {
  if (ticketIds.length < 2) {
    throw new OrchestratorError("USAGE", "create requires at least 2 ticket IDs");
  }

  for (const ticket of ticketIds) {
    validateTicket(ticket, registryDir);
  }

  const groupId = generateGroupId(ticketIds);
  const now = nowIso();
  const group: Group = {
    group_id: groupId,
    tickets: ticketIds,
    created_at: now,
    updated_at: now,
  };

  const groupFile = path.join(groupsDir, `${groupId}.json`);
  writeJsonAtomic(groupFile, group);

  // Update each ticket registry with group_id
  for (const ticket of ticketIds) {
    const regPath = getRegistryPath(registryDir, ticket);
    const reg = readJsonFile(regPath);
    if (!reg) {
      throw new OrchestratorError("FILE_NOT_FOUND", `Registry disappeared for ${ticket}`);
    }
    writeJsonAtomic(regPath, { ...reg, group_id: groupId });
  }

  return group;
}

export function cmdAdd(
  groupId: string,
  ticketId: string,
  registryDir: string,
  groupsDir: string
): Group {
  const groupFile = path.join(groupsDir, `${groupId}.json`);
  const group = readJsonFile(groupFile) as Group | null;
  if (!group) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Group not found: ${groupId}`);
  }

  validateTicket(ticketId, registryDir);

  if (group.tickets.includes(ticketId)) {
    console.error(`Warning: Ticket ${ticketId} already in group ${groupId}`);
    return group;
  }

  const updated: Group = {
    ...group,
    tickets: [...group.tickets, ticketId],
    updated_at: nowIso(),
  };

  writeJsonAtomic(groupFile, updated);

  // Update ticket registry
  const regPath = getRegistryPath(registryDir, ticketId);
  const reg = readJsonFile(regPath);
  if (!reg) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Registry disappeared for ${ticketId}`);
  }
  writeJsonAtomic(regPath, { ...reg, group_id: groupId });

  return updated;
}

export function cmdQuery(
  ticketId: string,
  registryDir: string,
  groupsDir: string
): Record<string, unknown> {
  validateTicket(ticketId, registryDir);

  const regPath = getRegistryPath(registryDir, ticketId);
  const reg = readJsonFile(regPath);
  if (!reg) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Registry not found for ${ticketId}`);
  }

  const groupId = reg.group_id as string | undefined;
  if (!groupId) {
    return {
      ticket_id: ticketId,
      group_id: null,
      message: "Ticket is not in any group",
    };
  }

  const groupFile = path.join(groupsDir, `${groupId}.json`);
  const group = readJsonFile(groupFile);
  if (!group) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Group file missing for group_id ${groupId}`);
  }

  return { ...group, queried_ticket: ticketId };
}

export function cmdList(
  groupId: string,
  registryDir: string,
  groupsDir: string
): Record<string, unknown> {
  const groupFile = path.join(groupsDir, `${groupId}.json`);
  const group = readJsonFile(groupFile) as Group | null;
  if (!group) {
    throw new OrchestratorError("FILE_NOT_FOUND", `Group not found: ${groupId}`);
  }

  const tickets: TicketStatus[] = group.tickets.map((ticketId) => {
    const regPath = getRegistryPath(registryDir, ticketId);
    const reg = readJsonFile(regPath);
    if (!reg) {
      return {
        ticket_id: ticketId,
        current_step: "unknown",
        status: "missing_registry",
        last_signal: null,
      };
    }
    return {
      ticket_id: ticketId,
      current_step: (reg.current_step as string) || "unknown",
      status: (reg.status as string) || "running",
      last_signal: (reg.last_signal as string | null) ?? null,
    };
  });

  return {
    group_id: groupId,
    tickets,
    count: tickets.length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: group-manage.ts <subcommand> [args...]");
    console.error("");
    console.error("Subcommands:");
    console.error("  create <ticket_id> [ticket_id ...]  Create coordination group");
    console.error("  add <group_id> <ticket_id>          Add ticket to group");
    console.error("  query <ticket_id>                   Get group for ticket");
    console.error("  list <group_id>                     List tickets in group");
    process.exit(1);
  }

  const subcommand = args[0];
  const rest = args.slice(1);

  try {
    const repoRoot = getRepoRoot();
    const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
    const groupsDir = `${repoRoot}/.collab/state/pipeline-groups`;

    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(groupsDir, { recursive: true });

    switch (subcommand) {
      case "create": {
        const group = cmdCreate(rest, registryDir, groupsDir);
        console.log(JSON.stringify(group, null, 2));
        break;
      }
      case "add": {
        if (rest.length < 2) {
          throw new OrchestratorError("USAGE", "add requires <group_id> <ticket_id>");
        }
        const group = cmdAdd(rest[0], rest[1], registryDir, groupsDir);
        console.log(`Added ${rest[1]} to group ${rest[0]}`);
        break;
      }
      case "query": {
        if (rest.length < 1) {
          throw new OrchestratorError("USAGE", "query requires <ticket_id>");
        }
        const result = cmdQuery(rest[0], registryDir, groupsDir);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "list": {
        if (rest.length < 1) {
          throw new OrchestratorError("USAGE", "list requires <group_id>");
        }
        const result = cmdList(rest[0], registryDir, groupsDir);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      default:
        throw new OrchestratorError("USAGE", `Unknown subcommand '${subcommand}'`);
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
