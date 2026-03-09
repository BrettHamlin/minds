/**
 * metrics.ts — Graph analysis utilities for Fission Mind.
 *
 * Provides modularity scoring, coupling matrices, and cohesion
 * computation for clustered dependency graphs.
 */
import type { DependencyGraph } from "../lib/types";
import type { ClusterAssignment } from "./leiden";
import { computeModularity } from "./leiden";

/**
 * Compute the Newman-Girvan modularity score Q for a given clustering.
 * Delegates to the canonical implementation in leiden.ts.
 */
export function computeModularityScore(
  graph: DependencyGraph,
  clusters: ClusterAssignment[],
  resolution: number = 1.0,
): number {
  return computeModularity(graph, clusters, resolution);
}

/**
 * Compute the coupling matrix: for each pair of clusters that share
 * at least one edge, report the total number of cross-cluster edges.
 */
export function computeCouplingMatrix(
  graph: DependencyGraph,
  clusters: ClusterAssignment[],
): { from: string; to: string; edges: number }[] {
  // Build file -> cluster name map.
  const fileToCluster = new Map<string, string>();
  for (const c of clusters) {
    const label = `cluster-${c.clusterId}`;
    for (const f of c.files) {
      fileToCluster.set(f, label);
    }
  }

  // Count edges between each cluster pair.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const counts = new Map<string, { from: string; to: string; edges: number }>();

  for (const e of graph.edges) {
    const ca = fileToCluster.get(e.from);
    const cb = fileToCluster.get(e.to);
    if (!ca || !cb || ca === cb) continue;

    const key = pairKey(ca, cb);
    if (!counts.has(key)) {
      const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca];
      counts.set(key, { from: lo, to: hi, edges: 0 });
    }
    counts.get(key)!.edges += e.weight;
  }

  return [...counts.values()].sort((a, b) => b.edges - a.edges);
}

/**
 * Compute cohesion for a cluster assignment.
 * cohesion = internalEdges / (internalEdges + externalEdges)
 */
export function computeClusterCohesion(cluster: ClusterAssignment): number {
  const total = cluster.internalEdges + cluster.externalEdges;
  return total > 0 ? cluster.internalEdges / total : 0;
}
