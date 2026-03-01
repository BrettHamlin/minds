#!/usr/bin/env bun

/**
 * coordination-check.ts - Validate coordination.json files for cycles and refs
 *
 * Checks all per-ticket coordination.json files for:
 *   1. All wait_for references exist in the current session ticket list
 *   2. No circular dependencies between tickets (DFS cycle detection)
 *
 * Uses Map/Set for proper graph data structures (not string manipulation).
 *
 * Usage:
 *   bun commands/coordination-check.ts BRE-228 BRE-229 BRE-230
 *
 * Output (stdout):
 *   "Coordination check passed: N tickets, no cycles or unknown references"
 *
 * Exit codes:
 *   0 = valid (no cycles, no unknown references)
 *   1 = validation error (cycle or unknown ticket reference)
 */

import * as fs from "fs";
import * as path from "path";
import {
  getRepoRoot,
  readJsonFile,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Cycle {
  path: string[];
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Build adjacency map from coordination.json files.
 * Returns { adjacency, errors } where errors are validation failures.
 */
export function buildAdjacency(
  ticketIds: string[],
  specsDir: string
): { adjacency: Map<string, string[]>; errors: string[] } {
  const validSet = new Set(ticketIds);
  const adjacency = new Map<string, string[]>();
  const errors: string[] = [];

  for (const ticketId of ticketIds) {
    adjacency.set(ticketId, []);

    const coordPath = path.join(specsDir, ticketId, "coordination.json");
    if (!fs.existsSync(coordPath)) continue;

    const coord = readJsonFile(coordPath);
    if (!coord) {
      errors.push(`Malformed coordination.json for ticket '${ticketId}'`);
      continue;
    }

    // Normalize: wait_for can be array of objects with .id, or .ticket_id
    let waitFor: Array<{ id?: string; ticket_id?: string }> = [];
    const raw = coord.wait_for;
    if (Array.isArray(raw)) {
      waitFor = raw;
    } else if (raw && typeof raw === "object") {
      waitFor = [raw as { id?: string; ticket_id?: string }];
    }

    for (const dep of waitFor) {
      const depId = dep.id ?? dep.ticket_id;
      if (!depId) continue;

      if (!validSet.has(depId)) {
        errors.push(
          `Ticket '${ticketId}' wait_for references unknown ticket '${depId}'. ` +
            `Tickets in current session: ${ticketIds.join(", ")}`
        );
        continue;
      }

      adjacency.get(ticketId)!.push(depId);
    }
  }

  return { adjacency, errors };
}

/**
 * Detect cycles in a directed graph using iterative DFS.
 * Returns array of cycles found (each cycle is the path of nodes).
 */
export function detectCycles(adjacency: Map<string, string[]>): Cycle[] {
  const cycles: Cycle[] = [];
  const fullyExplored = new Set<string>();

  function dfs(node: string, pathStack: string[], inPath: Set<string>): void {
    if (fullyExplored.has(node)) return;

    const deps = adjacency.get(node) ?? [];
    for (const dep of deps) {
      if (inPath.has(dep)) {
        // Found a cycle — record the cycle path from dep to dep
        const cycleStart = pathStack.indexOf(dep);
        cycles.push({ path: [...pathStack.slice(cycleStart), dep] });
        return;
      }

      if (!fullyExplored.has(dep)) {
        pathStack.push(dep);
        inPath.add(dep);
        dfs(dep, pathStack, inPath);
        pathStack.pop();
        inPath.delete(dep);
      }
    }

    fullyExplored.add(node);
  }

  for (const node of adjacency.keys()) {
    if (!fullyExplored.has(node)) {
      dfs(node, [node], new Set([node]));
    }
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // No tickets — nothing to check
    process.exit(0);
  }

  try {
    const ticketIds = args;
    const repoRoot = getRepoRoot();
    const specsDir = path.join(repoRoot, "specs");

    const { adjacency, errors } = buildAdjacency(ticketIds, specsDir);

    if (errors.length > 0) {
      for (const err of errors) {
        console.error(`Error: ${err}`);
      }
      process.exit(1);
    }

    const cycles = detectCycles(adjacency);

    if (cycles.length > 0) {
      for (const cycle of cycles) {
        console.error(`Error: Circular dependency: ${cycle.path.join(" → ")}`);
      }
      process.exit(1);
    }

    console.log(
      `Coordination check passed: ${ticketIds.length} tickets, no cycles or unknown references`
    );
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
