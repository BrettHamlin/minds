/**
 * leiden.test.ts — Tests for the Leiden community detection algorithm.
 *
 * Covers: two obvious clusters, Zachary's karate club, single cluster,
 * disconnected components, resolution parameter, modularity score,
 * determinism, and empty graph.
 */
import { describe, expect, it } from "bun:test";
import { leiden, computeModularity } from "../leiden";
import type { DependencyGraph } from "../../lib/types";
import type { ClusterAssignment, LeidenResult } from "../leiden";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a complete graph (clique) on the given node names. */
function clique(names: string[], weight = 1): DependencyGraph {
  const edges: { from: string; to: string; weight: number }[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      edges.push({ from: names[i], to: names[j], weight });
    }
  }
  return { nodes: [...names], edges };
}

/** Merge two graphs, optionally adding bridge edges between them. */
function mergeGraphs(
  a: DependencyGraph,
  b: DependencyGraph,
  bridges: { from: string; to: string; weight: number }[] = [],
): DependencyGraph {
  return {
    nodes: [...a.nodes, ...b.nodes],
    edges: [...a.edges, ...b.edges, ...bridges],
  };
}

/** Find which cluster a given node belongs to. */
function clusterOf(result: LeidenResult, node: string): number {
  for (const c of result.clusters) {
    if (c.files.includes(node)) return c.clusterId;
  }
  return -1;
}

/** Check that two nodes are in the same cluster. */
function sameCluster(result: LeidenResult, a: string, b: string): boolean {
  return clusterOf(result, a) === clusterOf(result, b);
}

/* ------------------------------------------------------------------ */
/*  Zachary's Karate Club fixture                                      */
/* ------------------------------------------------------------------ */

function karateClubGraph(): DependencyGraph {
  // Zachary's karate club — 34 members, 78 edges.
  // Classic ground truth: split into club of node 0 (Mr. Hi)
  // and club of node 33 (Officer).
  const n = 34;
  const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
  // Edge list from the original 1977 paper (0-indexed).
  const edgePairs: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
    [0, 10], [0, 11], [0, 12], [0, 13], [0, 17], [0, 19], [0, 21], [0, 31],
    [1, 2], [1, 3], [1, 7], [1, 13], [1, 17], [1, 19], [1, 21], [1, 30],
    [2, 3], [2, 7], [2, 8], [2, 9], [2, 13], [2, 27], [2, 28], [2, 32],
    [3, 7], [3, 12], [3, 13],
    [4, 6], [4, 10],
    [5, 6], [5, 10], [5, 16],
    [6, 16],
    [8, 30], [8, 32], [8, 33],
    [9, 33],
    [13, 33],
    [14, 32], [14, 33],
    [15, 32], [15, 33],
    [18, 32], [18, 33],
    [19, 33],
    [20, 32], [20, 33],
    [22, 32], [22, 33],
    [23, 25], [23, 27], [23, 29], [23, 32], [23, 33],
    [24, 25], [24, 27], [24, 31],
    [25, 31],
    [26, 29], [26, 33],
    [27, 33],
    [28, 31], [28, 33],
    [29, 32], [29, 33],
    [30, 32], [30, 33],
    [31, 32], [31, 33],
    [32, 33],
  ];
  const edges = edgePairs.map(([a, b]) => ({
    from: `n${a}`,
    to: `n${b}`,
    weight: 1,
  }));
  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Leiden algorithm", () => {
  it("separates two obvious clusters connected by a thin bridge", () => {
    const groupA = ["a1", "a2", "a3", "a4", "a5"];
    const groupB = ["b1", "b2", "b3", "b4", "b5"];
    const graph = mergeGraphs(clique(groupA), clique(groupB), [
      { from: "a1", to: "b1", weight: 1 },
    ]);

    const result = leiden(graph);

    // Should find at least 2 clusters.
    expect(result.clusters.length).toBeGreaterThanOrEqual(2);

    // All nodes in groupA should be together.
    for (const node of groupA) {
      expect(sameCluster(result, "a1", node)).toBe(true);
    }
    // All nodes in groupB should be together.
    for (const node of groupB) {
      expect(sameCluster(result, "b1", node)).toBe(true);
    }
    // The two groups should be in different clusters.
    expect(sameCluster(result, "a1", "b1")).toBe(false);
  });

  it("clusters Zachary's karate club into 2-5 communities with positive modularity", () => {
    const graph = karateClubGraph();
    const result = leiden(graph);

    // Literature typically finds 2-4 communities. We allow a little slack.
    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    expect(result.clusters.length).toBeLessThanOrEqual(5);

    // Modularity should be comfortably positive.
    expect(result.modularity).toBeGreaterThan(0.3);

    // Every node should be assigned to exactly one cluster.
    const allFiles = result.clusters.flatMap((c) => c.files);
    expect(allFiles.length).toBe(34);
    expect(new Set(allFiles).size).toBe(34);
  });

  it("keeps a fully connected graph as a single cluster", () => {
    const graph = clique(["x1", "x2", "x3", "x4", "x5"]);
    const result = leiden(graph);

    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0].files.length).toBe(5);
  });

  it("separates disconnected components into distinct clusters", () => {
    const graphA = clique(["a1", "a2", "a3"]);
    const graphB = clique(["b1", "b2", "b3"]);
    const graph = mergeGraphs(graphA, graphB);

    const result = leiden(graph);

    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    expect(sameCluster(result, "a1", "b1")).toBe(false);
    expect(sameCluster(result, "a1", "a2")).toBe(true);
    expect(sameCluster(result, "b1", "b2")).toBe(true);
  });

  it("produces more clusters at higher resolution", () => {
    // A graph with 3 loosely-connected cliques.
    const c1 = clique(["c1a", "c1b", "c1c", "c1d"]);
    const c2 = clique(["c2a", "c2b", "c2c", "c2d"]);
    const c3 = clique(["c3a", "c3b", "c3c", "c3d"]);
    const graph = mergeGraphs(
      mergeGraphs(c1, c2, [{ from: "c1a", to: "c2a", weight: 1 }]),
      c3,
      [{ from: "c2a", to: "c3a", weight: 1 }],
    );

    const lowRes = leiden(graph, { resolution: 0.5 });
    const highRes = leiden(graph, { resolution: 2.0 });

    // Higher resolution should produce at least as many clusters.
    expect(highRes.clusters.length).toBeGreaterThanOrEqual(
      lowRes.clusters.length,
    );
  });

  it("computes modularity > 0 for a graph with known structure", () => {
    const groupA = clique(["a1", "a2", "a3", "a4"]);
    const groupB = clique(["b1", "b2", "b3", "b4"]);
    const graph = mergeGraphs(groupA, groupB, [
      { from: "a1", to: "b1", weight: 1 },
    ]);

    const result = leiden(graph);
    expect(result.modularity).toBeGreaterThan(0);

    // Also verify computeModularity independently.
    const q = computeModularity(graph, result.clusters, 1.0);
    expect(q).toBeCloseTo(result.modularity, 4);
  });

  it("produces identical results with the same seed (determinism)", () => {
    const graph = karateClubGraph();
    const r1 = leiden(graph, { seed: 12345 });
    const r2 = leiden(graph, { seed: 12345 });

    expect(r1.clusters.length).toBe(r2.clusters.length);
    expect(r1.modularity).toBeCloseTo(r2.modularity, 10);
    expect(r1.iterations).toBe(r2.iterations);

    // Same cluster assignments.
    for (const c1 of r1.clusters) {
      const c2 = r2.clusters.find((c) => c.clusterId === c1.clusterId);
      expect(c2).toBeDefined();
      expect(c1.files.sort()).toEqual(c2!.files.sort());
    }
  });

  it("handles an empty graph gracefully", () => {
    const graph: DependencyGraph = { nodes: [], edges: [] };
    const result = leiden(graph);

    expect(result.clusters).toEqual([]);
    expect(result.modularity).toBe(0);
    expect(result.iterations).toBe(0);
  });

  it("handles a single-node graph", () => {
    const graph: DependencyGraph = { nodes: ["solo"], edges: [] };
    const result = leiden(graph);

    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0].files).toEqual(["solo"]);
    expect(result.modularity).toBe(0);
  });

  it("populates cohesion and edge counts correctly", () => {
    const groupA = clique(["a1", "a2", "a3"]);
    const groupB = clique(["b1", "b2", "b3"]);
    const graph = mergeGraphs(groupA, groupB, [
      { from: "a1", to: "b1", weight: 1 },
    ]);

    const result = leiden(graph);

    for (const cluster of result.clusters) {
      expect(cluster.internalEdges).toBeGreaterThanOrEqual(0);
      expect(cluster.externalEdges).toBeGreaterThanOrEqual(0);
      const total = cluster.internalEdges + cluster.externalEdges;
      if (total > 0) {
        expect(cluster.cohesion).toBeCloseTo(
          cluster.internalEdges / total,
          5,
        );
      }
    }
  });
});
