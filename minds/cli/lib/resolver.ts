/**
 * Collab CLI — pipeline dependency resolution
 * Topological sort with circular dependency detection.
 * All logic is pure (no I/O) — fetching is handled by registry.ts.
 */

import { satisfies } from "./semver.js";
import { makeError } from "../types/index.js";
import type {
  PipelineManifest,
  PipelineDependency,
  ResolveResult,
  CollabError,
} from "../types/index.js";

/**
 * Resolve all transitive dependencies of the named pipelines.
 * Returns topologically sorted installation order (deps first) and the full resolved graph.
 *
 * @param rootNames  Names of the pipelines/packs to install
 * @param manifests  Map of name → manifest for all known packages (pre-fetched)
 * @param installed  Set of already-installed pipeline names to skip
 */
export function resolve(
  rootNames: string[],
  manifests: Map<string, PipelineManifest>,
  installed: Set<string> = new Set()
): ResolveResult {
  const resolved = new Map<string, PipelineManifest>();
  const visiting = new Set<string>(); // cycle detection

  for (const name of rootNames) {
    visit(name, null, manifests, resolved, visiting, installed, []);
  }

  const order = topologicalSort(resolved);
  return { order, resolved };
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * DFS visit for one node.
 * @param chain  Breadcrumb chain for error reporting
 */
function visit(
  name: string,
  requiredRange: string | null,
  manifests: Map<string, PipelineManifest>,
  resolved: Map<string, PipelineManifest>,
  visiting: Set<string>,
  installed: Set<string>,
  chain: string[]
): void {
  // Already resolved — check version compatibility
  if (resolved.has(name)) {
    if (requiredRange !== null) {
      const existing = resolved.get(name)!;
      if (!satisfies(existing.version, requiredRange)) {
        throw makeError(
          "MISSING_DEPENDENCY",
          `Version conflict for "${name}": resolved "${existing.version}" does not satisfy required "${requiredRange}"`,
          { name, resolvedVersion: existing.version, requiredRange, chain }
        );
      }
    }
    return;
  }

  // Circular dependency detection
  if (visiting.has(name)) {
    const cycle = [...chain, name].join(" → ");
    throw makeError(
      "CIRCULAR_DEPENDENCY",
      `Circular dependency detected: ${cycle}`,
      { cycle, name, chain }
    );
  }

  // Manifest must exist
  const manifest = manifests.get(name);
  if (!manifest) {
    throw makeError(
      "MISSING_DEPENDENCY",
      `Pipeline "${name}" not found in registry`,
      { name, chain, required: requiredRange }
    );
  }

  // Version check
  if (requiredRange !== null && !satisfies(manifest.version, requiredRange)) {
    throw makeError(
      "MISSING_DEPENDENCY",
      `"${name}@${manifest.version}" does not satisfy required range "${requiredRange}"`,
      { name, version: manifest.version, requiredRange, chain }
    );
  }

  visiting.add(name);
  const nextChain = [...chain, name];

  // Recurse into dependencies
  for (const dep of manifest.dependencies ?? []) {
    visit(dep.name, dep.version, manifests, resolved, visiting, installed, nextChain);
  }

  visiting.delete(name);
  resolved.set(name, manifest);
}

/**
 * Topological sort of the resolved map.
 * Produces an order where every dependency appears before the packages that need it.
 */
function topologicalSort(resolved: Map<string, PipelineManifest>): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function dfs(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const manifest = resolved.get(name);
    if (!manifest) return;

    for (const dep of manifest.dependencies ?? []) {
      dfs(dep.name);
    }

    order.push(name);
  }

  for (const name of resolved.keys()) {
    dfs(name);
  }

  return order;
}

/**
 * Filter out already-installed pipelines from an installation order.
 * Returns only the pipelines that need to be installed.
 */
export function filterInstalled(
  order: string[],
  installed: Set<string>
): string[] {
  return order.filter((name) => !installed.has(name));
}

/**
 * Collect all unique CLI dependencies across a set of manifests.
 * Deduplicates by CLI name, keeps the most restrictive version range.
 * (In practice: just list all and let cli-resolver handle dedup.)
 */
export function collectCliDeps(
  resolved: Map<string, PipelineManifest>
): Array<{ name: string; version: string; required: boolean; installHint?: string }> {
  const seen = new Map<string, { name: string; version: string; required: boolean; installHint?: string }>();

  for (const manifest of resolved.values()) {
    for (const cli of manifest.cliDependencies ?? []) {
      if (!seen.has(cli.name)) {
        seen.set(cli.name, {
          name: cli.name,
          version: cli.version,
          required: cli.required,
          installHint: cli.installHint,
        });
      }
      // If any pipeline marks it required, it is required
      const existing = seen.get(cli.name)!;
      if (cli.required && !existing.required) {
        seen.set(cli.name, { ...existing, required: true });
      }
    }
  }

  return Array.from(seen.values());
}
