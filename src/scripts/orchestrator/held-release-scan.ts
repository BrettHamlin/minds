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
  registryPath,
  validateTicketIdArg,
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
  repoRoot: string
): boolean {
  const depRegistryPath = registryPath(repoRoot, dep.ticket_id);
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
  repoRoot: string
): { satisfied: boolean; blockingDep?: string } {
  for (const dep of waitFor) {
    if (!isDependencySatisfied(dep, repoRoot)) {
      return {
        satisfied: false,
        blockingDep: `${dep.ticket_id}:${dep.phase}`,
      };
    }
  }
  return { satisfied: true };
}

/**
 * Check if a cross-ticket dependency hold is satisfied.
 *
 * For release_when="done" (default): the hold is released when the blocker
 * registry no longer exists (pipeline completed and was cleaned up). External
 * holds (hold_external=true) are never auto-released.
 *
 * For release_when=<phase>: the hold is released when the blocker's
 * phase_history contains that phase with a _COMPLETE signal.
 *
 * @param blockerTicketId   - The ticket ID that is blocking.
 * @param releaseWhen       - Phase that must be reached. "done" = fully complete.
 * @param registryDir       - Path to the pipeline-registry directory.
 * @returns true when the hold should be released.
 */
export function isDependencyHoldSatisfied(
  blockerTicketId: string,
  releaseWhen: string,
  repoRoot: string
): boolean {
  const blockerRegistryPath = registryPath(repoRoot, blockerTicketId);
  const blockerRegistry = readJsonFile(blockerRegistryPath);

  if (releaseWhen === "done") {
    // Blocker has completed when its registry no longer exists (deleted on completion).
    return !blockerRegistry;
  }

  // For a specific phase: check blocker phase_history for a _COMPLETE signal.
  if (!blockerRegistry) return false;
  const history: PhaseHistoryEntry[] = blockerRegistry.phase_history || [];
  return history.some(
    (entry) => entry.phase === releaseWhen && entry.signal.endsWith("_COMPLETE")
  );
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "held-release-scan.ts");
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

    // --- Cross-ticket dependency hold (Linear blockedBy) ---
    const heldBy = registry.held_by as string | undefined;
    if (heldBy) {
      const holdExternal = registry.hold_external === true;
      if (holdExternal) {
        console.log(
          `Still held: ${heldTicket} -- waiting for external blocker ${heldBy} (manual release required)`
        );
        continue;
      }

      const releaseWhen = (registry.hold_release_when as string | undefined) || "done";
      const satisfied = isDependencyHoldSatisfied(heldBy, releaseWhen, repoRoot);

      if (satisfied) {
        execSync(`bun "${scriptDir}/registry-update.ts" "${heldTicket}" status=running`, { stdio: "inherit" });
        execSync(`bun "${scriptDir}/registry-update.ts" "${heldTicket}" --delete-field held_by`, { stdio: "inherit" });
        execSync(`bun "${scriptDir}/registry-update.ts" "${heldTicket}" --delete-field hold_release_when`, { stdio: "inherit" });
        execSync(`bun "${scriptDir}/registry-update.ts" "${heldTicket}" --delete-field hold_reason`, { stdio: "inherit" });
        execSync(`bun "${scriptDir}/registry-update.ts" "${heldTicket}" --delete-field hold_external`, { stdio: "inherit" });
        console.log(`Released ${heldTicket} (dependency hold: ${heldBy} completed)`);
        releasedCount++;
      } else {
        console.log(
          `Still held: ${heldTicket} -- waiting for ${heldBy} to reach ${releaseWhen}`
        );
      }
      continue;
    }

    // --- Intra-ticket coordination hold (coordination.json wait_for) ---

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

    const result = checkHeldTicket(heldTicket, waitFor, repoRoot);

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
