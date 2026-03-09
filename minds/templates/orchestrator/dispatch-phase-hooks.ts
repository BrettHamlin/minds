#!/usr/bin/env bun

/**
 * dispatch-phase-hooks.ts — Deterministic phase hook resolution
 *
 * Resolves the list of before (pre) or after (post) hook phases for a given
 * pipeline phase from the pipeline config. Replaces inline pipeline.json reads
 * in collab.run.md for hook dispatch logic.
 *
 * Usage:
 *   bun dispatch-phase-hooks.ts <TICKET_ID> <pre|post> [--phase <phase_id>]
 *
 * When --phase is omitted, reads current_step from the registry.
 *
 * Output (JSON to stdout):
 *   { "hooks": ["pre-deploy"], "count": 1, "phase": "implement", "type": "pre", "empty": false }
 *   { "hooks": [], "count": 0, "phase": "implement", "type": "post", "empty": true }
 *
 * Exit codes:
 *   0 = success (even when no hooks — check "empty" field)
 *   1 = usage error or invalid hook type
 *   3 = registry or pipeline config not found
 */

import {
  getRepoRoot,
  readJsonFile,
  loadPipelineForTicket,
  validateTicketIdArg,
} from "../../lib/pipeline/utils";
import { registryPath } from "../../lib/pipeline/paths";

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Resolve the hook phase IDs for a phase from a pipeline config.
 * Returns the ordered list of hook phase IDs (empty when no hooks defined).
 */
export function resolveHooksForPhase(
  pipeline: Record<string, any>,
  phaseId: string,
  hookType: "pre" | "post"
): string[] {
  const phase = pipeline.phases?.[phaseId];
  if (!phase) return [];

  const hookArray: unknown = hookType === "pre" ? phase.before : phase.after;
  if (!Array.isArray(hookArray)) return [];

  return hookArray
    .map((h: unknown) => (h && typeof h === "object" && "phase" in h ? (h as { phase: string }).phase : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "dispatch-phase-hooks.ts");

  if (args.length < 2) {
    console.error(
      "Usage: dispatch-phase-hooks.ts <TICKET_ID> <pre|post> [--phase <phase_id>]"
    );
    process.exit(1);
  }

  const ticketId = args[0];
  const hookTypeArg = args[1];

  if (hookTypeArg !== "pre" && hookTypeArg !== "post") {
    console.error(
      `Error: hook type must be "pre" or "post", got "${hookTypeArg}"`
    );
    process.exit(1);
  }
  const hookType = hookTypeArg as "pre" | "post";

  // Parse optional --phase flag
  let phaseId: string | undefined;
  const phaseIdx = args.indexOf("--phase");
  if (phaseIdx !== -1 && args[phaseIdx + 1]) {
    phaseId = args[phaseIdx + 1];
  }

  const repoRoot = getRepoRoot();

  // If phase not provided, read current_step from registry
  if (!phaseId) {
    const regPath = registryPath(repoRoot, ticketId);
    const registry = readJsonFile(regPath);
    if (!registry) {
      console.error(
        JSON.stringify({ error: `Registry not found for ticket: ${ticketId}` })
      );
      process.exit(3);
    }
    phaseId = registry.current_step as string | undefined;
    if (!phaseId) {
      console.error(
        JSON.stringify({ error: `No current_step in registry for ticket: ${ticketId}` })
      );
      process.exit(3);
    }
  }

  const { pipeline } = loadPipelineForTicket(repoRoot, ticketId);
  const hooks = resolveHooksForPhase(pipeline, phaseId, hookType);

  console.log(
    JSON.stringify({
      hooks,
      count: hooks.length,
      phase: phaseId,
      type: hookType,
      empty: hooks.length === 0,
    })
  );
}

if (import.meta.main) {
  main();
}
