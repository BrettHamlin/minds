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

export interface DependencyHold {
  /** The ticket that is blocked and should be held. */
  held_ticket: string;
  /** The ticket that must complete before the held ticket can advance. */
  blocked_by: string;
  /** Phase the blocker must reach before releasing. "done" = fully complete. */
  release_when: string;
  /** Human-readable reason for the hold. */
  reason: string;
  /** True when the blocker is not part of the current pipeline run. */
  external: boolean;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Build adjacency map from coordination.json files.
 * Returns { adjacency, errors } where errors are validation failures.
 *
 * @param specsDir - Single directory or array of directories to search for
 *   specs/{ticketId}/coordination.json. In multi-repo setups, pass one entry
 *   per repo's specs/ directory.
 */
export function buildAdjacency(
  ticketIds: string[],
  specsDir: string | string[]
): { adjacency: Map<string, string[]>; errors: string[] } {
  const specsDirs = Array.isArray(specsDir) ? specsDir : [specsDir];
  const validSet = new Set(ticketIds);
  const adjacency = new Map<string, string[]>();
  const errors: string[] = [];

  for (const ticketId of ticketIds) {
    adjacency.set(ticketId, []);

    // Find coordination.json in any of the specsDirs
    let coordPath: string | null = null;
    for (const dir of specsDirs) {
      const candidate = path.join(dir, ticketId, "coordination.json");
      if (fs.existsSync(candidate)) {
        coordPath = candidate;
        break;
      }
    }
    if (!coordPath) continue;

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

/**
 * Build dependency holds from metadata.json blockedBy fields.
 *
 * Reads each ticket's specs/{ticketId}/metadata.json for a `blockedBy` field
 * (array of ticket IDs) populated by the specify workflow from Linear relations.
 * Returns one DependencyHold per blocked pair.
 *
 * Blockers within the current pipeline run are marked external=false (auto-
 * releasable). Blockers outside the run are marked external=true (manual release).
 *
 * @param ticketIds - All ticket IDs in the current pipeline session.
 * @param specsDir  - specs/ directory path or array of paths (multi-repo).
 */
export function buildDependencyHolds(
  ticketIds: string[],
  specsDir: string | string[]
): DependencyHold[] {
  const specsDirs = Array.isArray(specsDir) ? specsDir : [specsDir];
  const pipelineSet = new Set(ticketIds);
  const holds: DependencyHold[] = [];

  for (const ticketId of ticketIds) {
    let metadata: Record<string, unknown> | null = null;

    for (const dir of specsDirs) {
      const candidate = path.join(dir, ticketId, "metadata.json");
      if (fs.existsSync(candidate)) {
        metadata = readJsonFile(candidate) as Record<string, unknown> | null;
        break;
      }
    }

    if (!metadata) continue;

    const blockedBy = metadata.blockedBy;
    if (!Array.isArray(blockedBy) || blockedBy.length === 0) continue;

    for (const blocker of blockedBy) {
      if (typeof blocker !== "string" || !blocker) continue;
      holds.push({
        held_ticket: ticketId,
        blocked_by: blocker,
        release_when: "done",
        reason: "Linear blockedBy",
        external: !pipelineSet.has(blocker),
      });
    }
  }

  return holds;
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
