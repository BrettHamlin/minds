#!/usr/bin/env bun

/**
 * check-dependency-hold.ts — Deterministic dependency hold check
 *
 * Checks whether a ticket is held by a cross-ticket dependency. Encapsulates
 * all registry reads that collab.run.md's f.0 section previously performed
 * inline as "AI LOGIC".
 *
 * Usage:
 *   bun check-dependency-hold.ts <TICKET_ID>
 *
 * Output (JSON to stdout):
 *
 *   Not held:
 *   { "held": false }
 *
 *   Held by external blocker (manual release required):
 *   { "held": true, "waiting_for": "BRE-419", "external": true, "reason": "Linear blockedBy" }
 *
 *   Held by internal blocker (still running):
 *   { "held": true, "waiting_for": "BRE-419", "external": false, "reason": "..." }
 *
 *   Was held but blocker has completed (registry deleted on completion):
 *   { "held": false, "released": true, "was_waiting_for": "BRE-419" }
 *     Caller should clear held_by/hold_* fields from registry and proceed.
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   3 = registry not found for the given ticket
 */

// TODO(WD): These should be requested via parent escalation once Pipeline Core is a Mind.
import {
  getRepoRoot,
  readJsonFile,
  validateTicketIdArg,
} from "../../src/lib/pipeline/utils";
import { registryPath } from "../../src/lib/pipeline/paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoldResult {
  held: boolean;
  waiting_for?: string;
  reason?: string;
  external?: boolean;
  released?: boolean;
  was_waiting_for?: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Check if a ticket is currently held by a dependency.
 *
 * Reads the registry for held_by / hold_external / hold_reason fields set
 * by orchestrator-init.ts at pipeline initialization time. If an internal
 * blocker is found, reads the blocker's registry to check whether it has
 * completed (registry deleted = completed).
 */
export function checkDependencyHold(
  ticketId: string,
  repoRoot: string
): HoldResult {
  const regPath = registryPath(repoRoot, ticketId);
  const registry = readJsonFile(regPath);

  if (!registry) {
    throw new Error(`Registry not found for ticket: ${ticketId}`);
  }

  const heldBy = registry.held_by as string | undefined;

  if (!heldBy) {
    return { held: false };
  }

  const external = !!(registry.hold_external as boolean | undefined);
  const reason = (registry.hold_reason as string | undefined) ?? "dependency hold";

  if (external) {
    return {
      held: true,
      waiting_for: heldBy,
      external: true,
      reason,
    };
  }

  // Internal hold: check if the blocker has completed.
  // Completed pipelines delete their registry file (see Pipeline Complete step 5 in collab.run.md).
  const blockerRegPath = registryPath(repoRoot, heldBy);
  const blockerRegistry = readJsonFile(blockerRegPath);

  if (!blockerRegistry) {
    // Blocker registry not found — blocker has completed.
    // Caller should clear hold fields and proceed.
    return {
      held: false,
      released: true,
      was_waiting_for: heldBy,
    };
  }

  // Blocker still has a registry — still running.
  return {
    held: true,
    waiting_for: heldBy,
    external: false,
    reason,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "check-dependency-hold.ts");

  if (args.length < 1) {
    console.error("Usage: check-dependency-hold.ts <TICKET_ID>");
    process.exit(1);
  }

  const ticketId = args[0];
  const repoRoot = getRepoRoot();

  try {
    const result = checkDependencyHold(ticketId, repoRoot);
    console.log(JSON.stringify(result));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Registry not found")) {
      console.error(JSON.stringify({ error: msg }));
      process.exit(3);
    }
    console.error(JSON.stringify({ error: msg }));
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
