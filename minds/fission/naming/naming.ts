/**
 * naming.ts — LLM naming and validation layer for Fission (Stage 4).
 *
 * Takes pipeline results (clusters, foundation, coupling) and produces
 * a ProposedMindMap with names derived from directory structure,
 * ownership globs, keyword extraction, and recommendations.
 *
 * Two modes:
 * - offline (deterministic): names derived from directory structure. Always works.
 * - LLM mode: calls inference for richer naming and recommendations.
 *   TODO: integrate with inference tooling when available.
 */

import { dirname, basename, extname } from "path";
import type { ClusterAssignment } from "../analysis/leiden";
import type { DependencyGraph } from "../lib/types";
import type { ProposedMind, ProposedMindMap, Recommendation } from "./types";
import { buildNamingPrompt, buildRecommendationPrompt } from "./prompts";
import type { ClusterForNaming } from "./prompts";

/* ------------------------------------------------------------------ */
/*  Input shape (matches what the pipeline produces)                   */
/* ------------------------------------------------------------------ */

export interface NamingInput {
  foundation: {
    files: string[];
    metrics: { file: string; fanIn: number; fanOut: number }[];
  };
  remaining: DependencyGraph;
  clusters: ClusterAssignment[];
  modularity: number;
  graph: DependencyGraph;
}

export interface NamingOptions {
  /** Use offline (deterministic) naming only. Default: false. */
  offline?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

export async function nameAndValidate(
  input: NamingInput,
  options?: NamingOptions,
): Promise<ProposedMindMap> {
  const { clusters, foundation, graph } = input;

  // Generate raw names for each cluster
  const rawNames = clusters.map((c) => deriveClusterName(c.files));

  // Deduplicate names
  const names = deduplicateNames(rawNames);

  // Build cluster ID -> name map
  const idToName = new Map<number, string>();
  for (let i = 0; i < clusters.length; i++) {
    idToName.set(clusters[i].clusterId, names[i]);
  }

  // Build ProposedMinds
  const minds: ProposedMind[] = clusters.map((c, i) => {
    const name = names[i];
    const files = c.files.sort();
    const ownsFiles = generateOwnsPatterns(files);
    const keywords = extractKeywords(files);
    const domain = generateDomain(name, files);

    // Compute exposes/consumes from edges
    const exposes: string[] = [];
    const consumes: string[] = [];
    const fileSet = new Set(files);

    for (const edge of graph.edges) {
      if (fileSet.has(edge.to) && !fileSet.has(edge.from)) {
        // Incoming from outside: this cluster exposes something
        const stem = basename(edge.to, extname(edge.to));
        if (!exposes.includes(stem)) exposes.push(stem);
      }
      if (fileSet.has(edge.from) && !fileSet.has(edge.to)) {
        // Outgoing to outside: this cluster consumes something
        const stem = basename(edge.to, extname(edge.to));
        if (!consumes.includes(stem)) consumes.push(stem);
      }
    }

    return {
      name,
      domain,
      keywords,
      files,
      owns_files: ownsFiles,
      exposes: exposes.sort(),
      consumes: consumes.sort(),
      fileCount: files.length,
      cohesion: c.cohesion,
    };
  });

  // Foundation Mind
  const foundationMind = {
    name: "foundation" as const,
    domain: generateFoundationDomain(foundation.files),
    files: foundation.files,
    exposes: foundation.files.map((f) => basename(f, extname(f))),
  };

  // Coupling matrix with Mind names instead of cluster IDs
  const couplingMatrix = computeNamedCoupling(graph, clusters, idToName);

  // Recommendations
  const recommendations = generateRecommendations(minds);

  return {
    foundation: foundationMind,
    minds,
    recommendations,
    couplingMatrix,
  };
}

/* ------------------------------------------------------------------ */
/*  Name derivation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Derive a Mind name from the files in a cluster.
 * Uses the deepest common directory segment.
 */
function deriveClusterName(files: string[]): string {
  if (files.length === 0) return "unnamed";

  // Get directory paths for all files
  const dirs = files.map((f) => dirname(f));

  // Find the longest common directory prefix
  const commonDir = findCommonPrefix(dirs);

  if (commonDir && commonDir !== ".") {
    // Use the deepest directory segment
    const segments = commonDir.split("/").filter((s) => s.length > 0);
    if (segments.length > 0) {
      const name = segments[segments.length - 1];
      return sanitizeName(name);
    }
  }

  // Fallback: try to find the most common directory among files
  const generic = new Set(["src", "lib", "pkg", "internal", "app", "modules", "."]);
  const dirCounts = new Map<string, number>();
  for (const dir of dirs) {
    const segments = dir.split("/").filter((s) => s.length > 0);
    for (const seg of segments) {
      if (!generic.has(seg)) {
        dirCounts.set(seg, (dirCounts.get(seg) ?? 0) + 1);
      }
    }
  }

  if (dirCounts.size > 0) {
    const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [seg] of sorted) {
      return sanitizeName(seg);
    }
  }

  // Last resort: derive from file stems
  const stems = files.map((f) => basename(f, extname(f))).filter((s) => s !== "index");
  if (stems.length > 0) {
    return sanitizeName(stems[0]);
  }

  return "module";
}

function findCommonPrefix(dirs: string[]): string {
  if (dirs.length === 0) return "";
  if (dirs.length === 1) return dirs[0];

  const split = dirs.map((d) => d.split("/"));
  const minLen = Math.min(...split.map((s) => s.length));

  const common: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const seg = split[0][i];
    if (split.every((s) => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }

  return common.join("/");
}

function sanitizeName(raw: string): string {
  // Convert camelCase/PascalCase to lowercase with hyphens
  let name = raw
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Enforce length constraints (2-20 chars)
  if (name.length < 2) name = name + "-mind";
  if (name.length > 20) name = name.slice(0, 20).replace(/-$/, "");

  return name;
}

/* ------------------------------------------------------------------ */
/*  Deduplication                                                      */
/* ------------------------------------------------------------------ */

function deduplicateNames(names: string[]): string[] {
  const result: string[] = [];
  const seen = new Map<string, number>();

  for (const name of names) {
    const count = seen.get(name) ?? 0;
    if (count === 0) {
      result.push(name);
    } else {
      result.push(`${name}-${count + 1}`);
    }
    seen.set(name, count + 1);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Ownership patterns                                                 */
/* ------------------------------------------------------------------ */

function generateOwnsPatterns(files: string[]): string[] {
  // Group files by directory
  const dirFiles = new Map<string, string[]>();
  for (const f of files) {
    const dir = dirname(f);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir)!.push(f);
  }

  const patterns: string[] = [];
  for (const [dir, dirFileList] of dirFiles) {
    if (dir === ".") {
      // Root-level files: list individually
      for (const f of dirFileList) {
        patterns.push(f);
      }
    } else {
      // If all files in the directory are in this cluster, use a glob
      patterns.push(`${dir}/**`);
    }
  }

  return patterns.sort();
}

/* ------------------------------------------------------------------ */
/*  Keyword extraction                                                 */
/* ------------------------------------------------------------------ */

function extractKeywords(files: string[]): string[] {
  const keywords = new Set<string>();

  for (const f of files) {
    // Add directory names
    const dir = dirname(f);
    const segments = dir.split("/").filter((s) => s.length > 0);
    for (const seg of segments) {
      const generic = new Set(["src", "lib", "pkg", "internal", "app", "modules", "."]);
      if (!generic.has(seg)) {
        keywords.add(seg.toLowerCase());
      }
    }

    // Add file stems
    const stem = basename(f, extname(f));
    if (stem !== "index" && stem !== "mod") {
      keywords.add(stem.toLowerCase());
    }
  }

  // Limit to 8 keywords
  return [...keywords].sort().slice(0, 8);
}

/* ------------------------------------------------------------------ */
/*  Domain generation                                                  */
/* ------------------------------------------------------------------ */

function generateDomain(name: string, files: string[]): string {
  const dirs = new Set(files.map((f) => dirname(f)));
  const fileCount = files.length;
  return `Manages the ${name} domain with ${fileCount} files across ${dirs.size} director${dirs.size === 1 ? "y" : "ies"}.`;
}

function generateFoundationDomain(files: string[]): string {
  if (files.length === 0) return "Shared foundation layer.";
  const stems = files.map((f) => basename(f, extname(f)));
  return `Shared foundation layer providing ${stems.join(", ")} to all Minds.`;
}

/* ------------------------------------------------------------------ */
/*  Named coupling matrix                                              */
/* ------------------------------------------------------------------ */

function computeNamedCoupling(
  graph: DependencyGraph,
  clusters: ClusterAssignment[],
  idToName: Map<number, string>,
): { from: string; to: string; edges: number }[] {
  // Build file -> cluster name map
  const fileToName = new Map<string, string>();
  for (const c of clusters) {
    const name = idToName.get(c.clusterId)!;
    for (const f of c.files) {
      fileToName.set(f, name);
    }
  }

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const counts = new Map<string, { from: string; to: string; edges: number }>();

  for (const e of graph.edges) {
    const na = fileToName.get(e.from);
    const nb = fileToName.get(e.to);
    if (!na || !nb || na === nb) continue;

    const key = pairKey(na, nb);
    if (!counts.has(key)) {
      const [lo, hi] = na < nb ? [na, nb] : [nb, na];
      counts.set(key, { from: lo, to: hi, edges: 0 });
    }
    counts.get(key)!.edges += e.weight;
  }

  return [...counts.values()].sort((a, b) => b.edges - a.edges);
}

/* ------------------------------------------------------------------ */
/*  Recommendations                                                    */
/* ------------------------------------------------------------------ */

function generateRecommendations(minds: ProposedMind[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const mind of minds) {
    // Recommend split for large clusters
    if (mind.fileCount > 500) {
      recommendations.push({
        type: "split",
        target: mind.name,
        reason: `Cluster "${mind.name}" has ${mind.fileCount} files, which is too large for a single Mind.`,
        suggestion: `Re-run Leiden with higher resolution to split "${mind.name}" into smaller domains.`,
      });
    }

    // Recommend merge for tiny clusters
    if (mind.fileCount < 5) {
      recommendations.push({
        type: "merge",
        target: mind.name,
        reason: `Cluster "${mind.name}" has only ${mind.fileCount} file${mind.fileCount === 1 ? "" : "s"}, which may be too small for its own Mind.`,
        suggestion: `Consider merging "${mind.name}" into a related Mind.`,
      });
    }
  }

  return recommendations;
}

/* ------------------------------------------------------------------ */
/*  Prompt preparation (for future LLM mode)                           */
/* ------------------------------------------------------------------ */

/**
 * Prepare cluster data for the naming prompt.
 * Summarizes files by directory and picks representative filenames.
 *
 * Exported for use by the pipeline when LLM mode is enabled.
 */
export function prepareClusterData(
  clusters: ClusterAssignment[],
): ClusterForNaming[] {
  return clusters.map((c) => {
    const dirDist: Record<string, number> = {};
    const filenames: string[] = [];

    for (const f of c.files) {
      const dir = dirname(f);
      dirDist[dir === "." ? "(root)" : dir] = (dirDist[dir === "." ? "(root)" : dir] ?? 0) + 1;
      filenames.push(basename(f));
    }

    return {
      clusterId: c.clusterId,
      filenames,
      directories: dirDist,
      fileCount: c.files.length,
      cohesion: c.cohesion,
      externalEdges: c.externalEdges,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  LLM naming (future)                                                */
/* ------------------------------------------------------------------ */

// TODO: Implement LLM-based naming when inference tooling is available.
//
// The LLM path should:
// 1. Call prepareClusterData() to summarize clusters.
// 2. Call buildNamingPrompt() to create the naming prompt.
// 3. Send prompt to inference (e.g., `Bun.spawn(["bun", "Tools/Inference.ts", "fast"])`).
// 4. Parse JSON response and map to ProposedMind[].
// 5. Call buildRecommendationPrompt() for LLM-powered recommendations.
// 6. Merge LLM recommendations with deterministic ones (split/merge).
//
// The offline path remains the fallback when no LLM is available.
