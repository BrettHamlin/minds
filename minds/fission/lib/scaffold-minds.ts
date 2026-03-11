/**
 * scaffold-minds.ts — Batch scaffolding integration for Fission.
 *
 * Takes a ProposedMindMap and scaffolds all Minds (foundation + domain)
 * using the @instantiate Mind's scaffoldMind() function.
 *
 * Failures are collected, not thrown, so partial scaffolding can proceed.
 */

import type { ProposedMindMap } from "../naming/types.js";
import { scaffoldMind, type ScaffoldOptions } from "../../instantiate/lib/scaffold.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ScaffoldAllResult {
  /** Mind names successfully created. */
  created: string[];
  /** Mind names that failed scaffolding. */
  failed: string[];
  /** Detailed error info per failed Mind. */
  errors: { mind: string; error: string }[];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Scaffold all Minds from a ProposedMindMap.
 *
 * 1. Scaffolds the Foundation Mind first.
 * 2. Then scaffolds each domain Mind sequentially.
 * 3. Collects successes and failures -- never throws.
 */
export async function scaffoldAllMinds(
  map: ProposedMindMap,
  opts: ScaffoldOptions = {},
): Promise<ScaffoldAllResult> {
  const created: string[] = [];
  const failed: string[] = [];
  const errors: { mind: string; error: string }[] = [];

  // Scaffold Foundation Mind
  try {
    await scaffoldMind("foundation", map.foundation.domain, {
      ...opts,
      ownsFiles: map.foundation.owns_files,
    });
    created.push("foundation");
  } catch (err) {
    failed.push("foundation");
    errors.push({
      mind: "foundation",
      error: (err as Error).message,
    });
  }

  // Scaffold each domain Mind
  for (const mind of map.minds) {
    try {
      await scaffoldMind(mind.name, mind.domain, {
        ...opts,
        ownsFiles: mind.owns_files,
      });
      created.push(mind.name);
    } catch (err) {
      failed.push(mind.name);
      errors.push({
        mind: mind.name,
        error: (err as Error).message,
      });
    }
  }

  return { created, failed, errors };
}
