/**
 * scaffold-minds.ts — Batch scaffolding integration for Fission.
 *
 * Takes a ProposedMindMap and scaffolds all Minds (foundation + domain),
 * plus optional build/verify minds when a project type is detected.
 *
 * Failures are collected, not thrown, so partial scaffolding can proceed.
 */

import type { ProposedMindMap } from "../naming/types.js";
import { scaffoldMind, type ScaffoldOptions } from "../../instantiate/lib/scaffold.js";
import type { ProjectType } from "./project-type.js";
import { buildMindMd, verifyMindMd } from "./mind-templates.js";

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

/** Extended options for scaffoldAllMinds — adds projectType on top of ScaffoldOptions. */
export interface ScaffoldAllOptions extends ScaffoldOptions {
  /** Detected project type — controls whether build/verify minds are scaffolded. */
  projectType?: ProjectType;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/** Project types that get a verify mind in addition to a build mind. */
const VERIFY_PROJECT_TYPES = new Set<ProjectType>(["frontend-web", "backend-api"]);

function tryScaffold(
  created: string[],
  failed: string[],
  errors: { mind: string; error: string }[],
  name: string,
  promise: Promise<unknown>,
): Promise<void> {
  return promise
    .then(() => { created.push(name); })
    .catch((err) => {
      failed.push(name);
      errors.push({ mind: name, error: (err as Error).message });
    });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Scaffold all Minds from a ProposedMindMap.
 *
 * 1. Scaffolds the Foundation Mind first.
 * 2. Then scaffolds each domain Mind sequentially.
 * 3. If projectType is known (not "unknown" and not omitted),
 *    scaffolds a build mind after domain minds.
 * 4. If projectType is "frontend-web" or "backend-api",
 *    also scaffolds a verify mind after the build mind.
 * 5. Collects successes and failures -- never throws.
 */
export async function scaffoldAllMinds(
  map: ProposedMindMap,
  opts: ScaffoldAllOptions = {},
): Promise<ScaffoldAllResult> {
  const created: string[] = [];
  const failed: string[] = [];
  const errors: { mind: string; error: string }[] = [];

  // Extract projectType from our extended opts; pass base opts to scaffoldMind
  const { projectType, ...baseOpts } = opts;

  // 1. Scaffold Foundation Mind
  await tryScaffold(created, failed, errors, "foundation",
    scaffoldMind("foundation", map.foundation.domain, {
      ...baseOpts,
      ownsFiles: map.foundation.owns_files,
    }),
  );

  // 2. Scaffold each domain Mind
  for (const mind of map.minds) {
    await tryScaffold(created, failed, errors, mind.name,
      scaffoldMind(mind.name, mind.domain, {
        ...baseOpts,
        ownsFiles: mind.owns_files,
      }),
    );
  }

  // 3. Scaffold build mind (if project type is known)
  if (projectType && projectType !== "unknown") {
    await tryScaffold(created, failed, errors, "build",
      scaffoldMind("build", "Build and deployment", {
        ...baseOpts,
        ownsFiles: ["**"],
        pipelineTemplate: "build",
        source: "fission",
        mindMdContent: buildMindMd(projectType),
      }),
    );
  }

  // 4. Scaffold verify mind (frontend-web and backend-api only)
  if (projectType && VERIFY_PROJECT_TYPES.has(projectType)) {
    await tryScaffold(created, failed, errors, "verify",
      scaffoldMind("verify", "Verification and testing", {
        ...baseOpts,
        ownsFiles: ["**"],
        pipelineTemplate: "test",
        source: "fission",
        mindMdContent: verifyMindMd(projectType),
      }),
    );
  }

  return { created, failed, errors };
}
