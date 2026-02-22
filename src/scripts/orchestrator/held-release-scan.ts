#!/usr/bin/env bun

/**
 * held-release-scan.ts - Scan registries and release held agents
 *
 * After a phase completes, scan all pipeline registry files for agents
 * with status=held. For each held agent, check if all wait_for dependencies
 * in coordination.json are now satisfied (dependency phase appears in
 * phase_history with a _COMPLETE signal). Release satisfied agents.
 *
 * This is a generic interpreter: coordination rules live in coordination.json,
 * not in this script. Adding or changing dependencies requires no script changes.
 *
 * Usage:
 *   bun held-release-scan.ts [COMPLETED_TICKET_ID]
 *
 *   COMPLETED_TICKET_ID is optional -- provided for logging context only.
 *
 * Output (stdout):
 *   "Released <ticket_id> (was held waiting for <dep>)"
 *   "Still held: <ticket_id> -- waiting for <dep_id>:<dep_phase>"
 *   "No held agents found."
 *
 * Exit codes:
 *   0 = scan completed (whether or not any agents were released)
 *   1 = usage error
 *   3 = file error (registry dir missing)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  getRepoRoot,
  readJsonFile,
  getRegistryPath,
} from "./orchestrator-utils";

// ============================================================================
// Types
// ============================================================================

export interface Dependency {
  ticket_id: string;
  phase: string;
}

interface PhaseHistoryEntry {
  phase: string;
  signal: string;
  ts: string;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Check if a dependency is satisfied by looking at the dependency ticket's
 * phase_history for a _COMPLETE signal matching the required phase.
 */
export function isDependencySatisfied(
  dep: Dependency,
  registryDir: string
): boolean {
  const depRegistryPath = getRegistryPath(registryDir, dep.ticket_id);
  const depRegistry = readJsonFile(depRegistryPath);

  if (!depRegistry) return false;

  const history: PhaseHistoryEntry[] = depRegistry.phase_history || [];
  return history.some(
    (entry) =>
      entry.phase === dep.phase && entry.signal.endsWith("_COMPLETE")
  );
}

/**
 * Check if all dependencies for a held ticket are satisfied.
 * Returns satisfied=true if all deps are met, or the first blocking dep.
 */
export function checkHeldTicket(
  heldTicketId: string,
  waitFor: Dependency[],
  registryDir: string
): { satisfied: boolean; blockingDep?: string } {
  for (const dep of waitFor) {
    if (!isDependencySatisfied(dep, registryDir)) {
      return {
        satisfied: false,
        blockingDep: `${dep.ticket_id}:${dep.phase}`,
      };
    }
  }
  return { satisfied: true };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const completedTicket = args[0] || "";

  const repoRoot = getRepoRoot();
  const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);

  // Validate registry dir exists
  if (!fs.existsSync(registryDir)) {
    console.error(`Error: Registry directory not found: ${registryDir}`);
    process.exit(3);
  }

  // Scan all registry files
  let heldCount = 0;
  let releasedCount = 0;

  const files = fs.readdirSync(registryDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(registryDir, file);
    const registry = readJsonFile(filePath);
    if (!registry) continue;

    if (registry.status !== "held") continue;

    heldCount++;
    const heldTicket = registry.ticket_id;
    const heldAt = registry.held_at || "";

    // Read coordination.json for this ticket
    const coordPath = path.join(repoRoot, "specs", heldTicket, "coordination.json");
    const coord = readJsonFile(coordPath);

    if (!coord) {
      console.error(
        `Warning: ${heldTicket} is held but has no coordination.json -- releasing`
      );
      execSync(
        `bun "${scriptDir}/registry-update.ts" "${heldTicket}" status=running`,
        { stdio: "inherit" }
      );
      releasedCount++;
      continue;
    }

    const waitFor: Dependency[] = coord.wait_for || [];

    if (waitFor.length === 0) {
      console.error(
        `Warning: ${heldTicket} is held but wait_for is empty -- releasing`
      );
      execSync(
        `bun "${scriptDir}/registry-update.ts" "${heldTicket}" status=running`,
        { stdio: "inherit" }
      );
      releasedCount++;
      continue;
    }

    const result = checkHeldTicket(heldTicket, waitFor, registryDir);

    if (result.satisfied) {
      execSync(
        `bun "${scriptDir}/registry-update.ts" "${heldTicket}" status=running`,
        { stdio: "inherit" }
      );
      console.log(`Released ${heldTicket} (was held at ${heldAt})`);
      releasedCount++;
    } else {
      console.log(
        `Still held: ${heldTicket} -- waiting for ${result.blockingDep}`
      );
    }
  }

  if (heldCount === 0) {
    console.log("No held agents found.");
  }
}

if (import.meta.main) {
  main();
}
