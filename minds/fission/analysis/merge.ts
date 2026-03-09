/**
 * merge.ts — Post-Leiden small-cluster merge step.
 *
 * After Leiden clustering, large graphs often produce hundreds of
 * micro-clusters (2-4 files). This module merges clusters below a
 * size threshold into their most-coupled neighbor, reducing
 * fragmentation while preserving domain boundaries.
 *
 * Algorithm:
 * 1. Find all clusters below minClusterSize
 * 2. For each small cluster, compute coupling (edge weight) to every neighbor cluster
 * 3. Merge into the most-coupled neighbor
 * 4. Repeat until no clusters are below threshold
 * 5. Renumber cluster IDs to be contiguous (0, 1, 2, ...)
 * 6. Recompute metrics (internalEdges, externalEdges, cohesion)
 */
import type { DependencyGraph } from "../lib/types.js";
import type { ClusterAssignment } from "./leiden.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface MergeOptions {
  /** Minimum files per cluster. Clusters below this get merged. Default: 10 */
  minClusterSize?: number;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Merge clusters with fewer than `minClusterSize` files into their
 * most-coupled neighbor. Repeats until no clusters are below the
 * threshold (or no valid merge target exists).
 */
export function mergeSmallClusters(
  graph: DependencyGraph,
  clusters: ClusterAssignment[],
  options?: MergeOptions,
): ClusterAssignment[] {
  const minSize = options?.minClusterSize ?? 10;

  if (clusters.length <= 1) return clusters;

  // Build file -> clusterId map (mutable)
  const fileToCluster = new Map<string, number>();
  for (const c of clusters) {
    for (const f of c.files) {
      fileToCluster.set(f, c.clusterId);
    }
  }

  // Track which cluster IDs are still active and their file lists
  const clusterFiles = new Map<number, Set<string>>();
  for (const c of clusters) {
    clusterFiles.set(c.clusterId, new Set(c.files));
  }

  // Iteratively merge until no small clusters remain (or none can be merged)
  let changed = true;
  while (changed) {
    changed = false;

    // Find the smallest cluster below threshold
    let smallestId: number | null = null;
    let smallestSize = Infinity;

    for (const [id, files] of clusterFiles) {
      if (files.size < minSize && files.size < smallestSize) {
        smallestSize = files.size;
        smallestId = id;
      }
    }

    if (smallestId === null) break;

    // Compute coupling from this small cluster to each neighbor cluster
    const coupling = computeNeighborCoupling(
      graph,
      smallestId,
      clusterFiles.get(smallestId)!,
      fileToCluster,
    );

    if (coupling.size === 0) {
      // No neighbors — skip this cluster, mark it as not mergeable
      // by temporarily removing and re-adding it at size=Infinity
      // Actually, just break the inner loop and try the next smallest
      // We need a different approach: collect all unmergeable and skip them
      break; // Fall through to retry logic below
    }

    // Find the most-coupled neighbor
    let bestNeighbor = -1;
    let bestWeight = -1;
    for (const [neighborId, weight] of coupling) {
      if (weight > bestWeight) {
        bestWeight = weight;
        bestNeighbor = neighborId;
      }
    }

    if (bestNeighbor === -1) break;

    // Merge: move all files from smallestId into bestNeighbor
    const smallFiles = clusterFiles.get(smallestId)!;
    const targetFiles = clusterFiles.get(bestNeighbor)!;

    for (const f of smallFiles) {
      targetFiles.add(f);
      fileToCluster.set(f, bestNeighbor);
    }

    clusterFiles.delete(smallestId);
    changed = true;
  }

  // Handle case where the smallest cluster has no neighbors but others might
  // Re-run with unmergeable clusters excluded
  if (!changed && clusterFiles.size > 1) {
    // Check if there are other small clusters that CAN be merged
    const unmergeable = new Set<number>();
    let retry = true;

    while (retry) {
      retry = false;

      for (const [id, files] of clusterFiles) {
        if (files.size >= minSize || unmergeable.has(id)) continue;

        const coupling = computeNeighborCoupling(
          graph,
          id,
          files,
          fileToCluster,
        );

        if (coupling.size === 0) {
          unmergeable.add(id);
          continue;
        }

        let bestNeighbor = -1;
        let bestWeight = -1;
        for (const [neighborId, weight] of coupling) {
          if (weight > bestWeight) {
            bestWeight = weight;
            bestNeighbor = neighborId;
          }
        }

        if (bestNeighbor === -1) {
          unmergeable.add(id);
          continue;
        }

        // Merge
        const targetFiles = clusterFiles.get(bestNeighbor)!;
        for (const f of files) {
          targetFiles.add(f);
          fileToCluster.set(f, bestNeighbor);
        }
        clusterFiles.delete(id);
        retry = true;
        break; // Restart the loop since clusterFiles changed
      }
    }
  }

  // Build final result with contiguous IDs and recomputed metrics
  return buildMergedClusters(graph, clusterFiles);
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compute the total edge weight from a cluster to each neighboring cluster.
 * Returns Map<neighborClusterId, totalWeight>.
 */
function computeNeighborCoupling(
  graph: DependencyGraph,
  clusterId: number,
  clusterFileSet: Set<string>,
  fileToCluster: Map<string, number>,
): Map<number, number> {
  const coupling = new Map<number, number>();

  for (const edge of graph.edges) {
    const fromIn = clusterFileSet.has(edge.from);
    const toIn = clusterFileSet.has(edge.to);

    if (fromIn && !toIn) {
      const neighborCluster = fileToCluster.get(edge.to);
      if (neighborCluster !== undefined && neighborCluster !== clusterId) {
        coupling.set(neighborCluster, (coupling.get(neighborCluster) ?? 0) + edge.weight);
      }
    } else if (toIn && !fromIn) {
      const neighborCluster = fileToCluster.get(edge.from);
      if (neighborCluster !== undefined && neighborCluster !== clusterId) {
        coupling.set(neighborCluster, (coupling.get(neighborCluster) ?? 0) + edge.weight);
      }
    }
  }

  return coupling;
}

/**
 * Build final ClusterAssignment array from the merged state.
 * Assigns contiguous IDs and recomputes all metrics.
 */
function buildMergedClusters(
  graph: DependencyGraph,
  clusterFiles: Map<number, Set<string>>,
): ClusterAssignment[] {
  const results: ClusterAssignment[] = [];
  let newId = 0;

  // Build a file->newClusterId map for metric computation
  const fileToNewCluster = new Map<string, number>();
  const clusterEntries: { newId: number; files: string[] }[] = [];

  for (const [, files] of clusterFiles) {
    const fileArr = [...files].sort();
    for (const f of fileArr) {
      fileToNewCluster.set(f, newId);
    }
    clusterEntries.push({ newId, files: fileArr });
    newId++;
  }

  // Compute metrics for each cluster
  for (const entry of clusterEntries) {
    const fileSet = new Set(entry.files);
    let internalEdges = 0;
    let externalEdges = 0;

    for (const edge of graph.edges) {
      const fromIn = fileSet.has(edge.from);
      const toIn = fileSet.has(edge.to);

      if (fromIn && toIn) {
        internalEdges += edge.weight;
      } else if (fromIn || toIn) {
        externalEdges += edge.weight;
      }
    }

    const total = internalEdges + externalEdges;
    results.push({
      clusterId: entry.newId,
      files: entry.files,
      internalEdges,
      externalEdges,
      cohesion: total > 0 ? internalEdges / total : 0,
    });
  }

  return results;
}
