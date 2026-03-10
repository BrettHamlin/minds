/**
 * merge.test.ts — Tests for post-Leiden small-cluster merge step.
 *
 * Covers: small cluster merging, neighbor selection by coupling,
 * threshold behavior, contiguous ID renumbering, and metric recomputation.
 */
import { describe, expect, it } from "bun:test";
import { mergeSmallClusters } from "../merge";
import type { DependencyGraph } from "../../lib/types";
import type { ClusterAssignment } from "../leiden";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a simple graph from edge tuples. */
function makeGraph(
  nodes: string[],
  edges: [string, string, number][],
): DependencyGraph {
  return {
    nodes,
    edges: edges.map(([from, to, weight]) => ({ from, to, weight })),
  };
}

/** Build a cluster assignment with auto-computed metrics. */
function makeCluster(
  id: number,
  files: string[],
  graph: DependencyGraph,
): ClusterAssignment {
  const fileSet = new Set(files);
  let internalEdges = 0;
  let externalEdges = 0;

  for (const e of graph.edges) {
    const fromIn = fileSet.has(e.from);
    const toIn = fileSet.has(e.to);
    if (fromIn && toIn) {
      internalEdges += e.weight;
    } else if (fromIn || toIn) {
      externalEdges += e.weight;
    }
  }

  // Internal edges are double-counted by the loop above (from->to and to->from perspective)
  // but since graph.edges only has each edge once, this is correct.
  const total = internalEdges + externalEdges;
  return {
    clusterId: id,
    files: files.sort(),
    internalEdges,
    externalEdges,
    cohesion: total > 0 ? internalEdges / total : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("mergeSmallClusters", () => {
  it("merges a small cluster into its most-coupled neighbor", () => {
    // 3 clusters: A (large), B (large), C (small, 2 files)
    // C has 1 edge to A, 3 edges to B => should merge into B
    const nodes = [
      "a1", "a2", "a3", "a4", "a5",
      "b1", "b2", "b3", "b4", "b5",
      "c1", "c2",
    ];
    const edges: [string, string, number][] = [
      // Internal A edges
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1], ["a1", "a5", 1],
      // Internal B edges
      ["b1", "b2", 1], ["b2", "b3", 1], ["b3", "b4", 1], ["b4", "b5", 1], ["b1", "b5", 1],
      // Internal C edge
      ["c1", "c2", 1],
      // C -> A coupling (1 edge)
      ["c1", "a1", 1],
      // C -> B coupling (3 edges)
      ["c1", "b1", 1], ["c2", "b2", 1], ["c2", "b3", 1],
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["b1", "b2", "b3", "b4", "b5"], graph),
      makeCluster(2, ["c1", "c2"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 5 });

    // C should have been merged into B (most coupled)
    expect(merged.length).toBe(2);

    // Find the cluster containing c1 — it should also contain b1
    const clusterWithC = merged.find((c) => c.files.includes("c1"));
    expect(clusterWithC).toBeDefined();
    expect(clusterWithC!.files).toContain("b1");
    expect(clusterWithC!.files).toContain("c2");
  });

  it("picks the neighbor with the most edges when multiple neighbors exist", () => {
    // Small cluster with ties to two neighbors, one stronger
    const nodes = ["a1", "a2", "a3", "a4", "a5", "b1", "b2", "b3", "b4", "b5", "s1", "s2"];
    const edges: [string, string, number][] = [
      // A internal
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1],
      // B internal
      ["b1", "b2", 1], ["b2", "b3", 1], ["b3", "b4", 1], ["b4", "b5", 1],
      // S internal
      ["s1", "s2", 1],
      // S -> A: 1 edge
      ["s1", "a1", 1],
      // S -> B: 2 edges (stronger coupling)
      ["s1", "b1", 1], ["s2", "b2", 1],
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["b1", "b2", "b3", "b4", "b5"], graph),
      makeCluster(2, ["s1", "s2"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 3 });

    // s1/s2 should merge into B (stronger coupling)
    const clusterWithS = merged.find((c) => c.files.includes("s1"));
    expect(clusterWithS).toBeDefined();
    expect(clusterWithS!.files).toContain("b1");
  });

  it("does not merge clusters already above the threshold", () => {
    const nodes = ["a1", "a2", "a3", "a4", "a5", "b1", "b2", "b3", "b4", "b5"];
    const edges: [string, string, number][] = [
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1],
      ["b1", "b2", 1], ["b2", "b3", 1], ["b3", "b4", 1], ["b4", "b5", 1],
      ["a1", "b1", 1],
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["b1", "b2", "b3", "b4", "b5"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 3 });

    // Both are size 5, above threshold 3 — no merges
    expect(merged.length).toBe(2);
  });

  it("performs no merges when all clusters are above threshold", () => {
    const nodes = [
      "a1", "a2", "a3", "a4", "a5",
      "b1", "b2", "b3", "b4", "b5",
      "c1", "c2", "c3", "c4", "c5",
    ];
    const edges: [string, string, number][] = [
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1],
      ["b1", "b2", 1], ["b2", "b3", 1], ["b3", "b4", 1], ["b4", "b5", 1],
      ["c1", "c2", 1], ["c2", "c3", 1], ["c3", "c4", 1], ["c4", "c5", 1],
      ["a1", "b1", 1], ["b1", "c1", 1],
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["b1", "b2", "b3", "b4", "b5"], graph),
      makeCluster(2, ["c1", "c2", "c3", "c4", "c5"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 5 });

    expect(merged.length).toBe(3);
  });

  it("renumbers cluster IDs to be contiguous after merges", () => {
    // 4 clusters: 0 (large), 1 (large), 2 (small), 3 (large)
    // Cluster 2 merges into 1, leaving gaps. IDs should be renumbered 0,1,2.
    const nodes = [
      "a1", "a2", "a3", "a4", "a5",
      "b1", "b2", "b3", "b4", "b5",
      "s1",
      "d1", "d2", "d3", "d4", "d5",
    ];
    const edges: [string, string, number][] = [
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1],
      ["b1", "b2", 1], ["b2", "b3", 1], ["b3", "b4", 1], ["b4", "b5", 1],
      ["d1", "d2", 1], ["d2", "d3", 1], ["d3", "d4", 1], ["d4", "d5", 1],
      // s1 couples to b1
      ["s1", "b1", 1],
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["b1", "b2", "b3", "b4", "b5"], graph),
      makeCluster(2, ["s1"], graph),
      makeCluster(3, ["d1", "d2", "d3", "d4", "d5"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 3 });

    // Should be 3 clusters with contiguous IDs
    expect(merged.length).toBe(3);
    const ids = merged.map((c) => c.clusterId).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2]);
  });

  it("recomputes metrics correctly after merge", () => {
    // After merging, internalEdges/externalEdges/cohesion must reflect the merged state
    const nodes = [
      "a1", "a2", "a3", "a4", "a5",
      "s1", "s2",
    ];
    const edges: [string, string, number][] = [
      // A internal: 4 edges
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1],
      // S internal: 1 edge
      ["s1", "s2", 1],
      // S -> A coupling: 2 edges
      ["s1", "a1", 1], ["s2", "a2", 1],
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["s1", "s2"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 3 });

    // Everything merges into one cluster
    expect(merged.length).toBe(1);

    const single = merged[0];
    expect(single.files.length).toBe(7);
    // All edges are now internal: 4 (A) + 1 (S) + 2 (cross) = 7
    expect(single.internalEdges).toBe(7);
    expect(single.externalEdges).toBe(0);
    expect(single.cohesion).toBe(1);
  });

  it("uses default minClusterSize of 10 when not specified", () => {
    // 1 cluster of 9 files, 1 cluster of 15 files
    // With default threshold=10, the 9-file cluster should be merged
    const smallFiles = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const largeFiles = Array.from({ length: 15 }, (_, i) => `l${i}`);
    const nodes = [...smallFiles, ...largeFiles];

    const edges: [string, string, number][] = [];
    // Internal edges for small cluster
    for (let i = 0; i < smallFiles.length - 1; i++) {
      edges.push([smallFiles[i], smallFiles[i + 1], 1]);
    }
    // Internal edges for large cluster
    for (let i = 0; i < largeFiles.length - 1; i++) {
      edges.push([largeFiles[i], largeFiles[i + 1], 1]);
    }
    // Bridge
    edges.push(["s0", "l0", 1]);

    const graph = makeGraph(nodes, edges);
    const clusters = [
      makeCluster(0, smallFiles, graph),
      makeCluster(1, largeFiles, graph),
    ];

    // No options => default minClusterSize=10
    const merged = mergeSmallClusters(graph, clusters);

    // 9-file cluster is below 10, should merge into the 15-file cluster
    expect(merged.length).toBe(1);
    expect(merged[0].files.length).toBe(24);
  });

  it("handles a small cluster with no neighbors (isolated) — keeps it as-is", () => {
    // If a small cluster has zero edges to any other cluster, it can't be merged
    const nodes = ["a1", "a2", "a3", "a4", "a5", "s1"];
    const edges: [string, string, number][] = [
      ["a1", "a2", 1], ["a2", "a3", 1], ["a3", "a4", 1], ["a4", "a5", 1],
      // s1 has no edges to anything
    ];
    const graph = makeGraph(nodes, edges);

    const clusters = [
      makeCluster(0, ["a1", "a2", "a3", "a4", "a5"], graph),
      makeCluster(1, ["s1"], graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 3 });

    // s1 cannot be merged anywhere, so it stays
    expect(merged.length).toBe(2);
  });

  it("handles iterative merging — merge creates a new small cluster that then merges", () => {
    // This tests the "repeat until no clusters below threshold" behavior
    // Cluster A: 10 files, Cluster B: 3 files, Cluster C: 2 files
    // C merges into B (3+2=5), but 5 is still < 10 threshold
    // So B(merged) merges into A
    const aFiles = Array.from({ length: 10 }, (_, i) => `a${i}`);
    const bFiles = ["b1", "b2", "b3"];
    const cFiles = ["c1", "c2"];
    const nodes = [...aFiles, ...bFiles, ...cFiles];

    const edges: [string, string, number][] = [];
    // A internal
    for (let i = 0; i < aFiles.length - 1; i++) edges.push([aFiles[i], aFiles[i + 1], 1]);
    // B internal
    edges.push(["b1", "b2", 1], ["b2", "b3", 1]);
    // C internal
    edges.push(["c1", "c2", 1]);
    // C -> B coupling (stronger than C -> A)
    edges.push(["c1", "b1", 1], ["c2", "b2", 1]);
    // B -> A coupling
    edges.push(["b1", "a1", 1]);

    const graph = makeGraph(nodes, edges);
    const clusters = [
      makeCluster(0, aFiles, graph),
      makeCluster(1, bFiles, graph),
      makeCluster(2, cFiles, graph),
    ];

    const merged = mergeSmallClusters(graph, clusters, { minClusterSize: 10 });

    // C merges into B (5 files), then B merges into A (15 files)
    expect(merged.length).toBe(1);
    expect(merged[0].files.length).toBe(15);
  });
});
