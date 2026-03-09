import { describe, expect, test } from "bun:test";
import {
  computeFanIn,
  computeFanOut,
  computePercentile,
  detectHubs,
} from "../hubs.js";
import type { DependencyGraph } from "../../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quick graph builder: edges as [from, to] pairs, weight defaults to 1. */
function makeGraph(
  edgePairs: [string, string][],
  extraNodes: string[] = [],
): DependencyGraph {
  const nodeSet = new Set<string>(extraNodes);
  const edges = edgePairs.map(([from, to]) => {
    nodeSet.add(from);
    nodeSet.add(to);
    return { from, to, weight: 1 };
  });
  return { nodes: [...nodeSet], edges };
}

// ---------------------------------------------------------------------------
// computeFanIn / computeFanOut
// ---------------------------------------------------------------------------

describe("computeFanIn", () => {
  test("counts incoming edges per node", () => {
    const g = makeGraph([
      ["b", "a"],
      ["c", "a"],
      ["d", "a"],
      ["c", "b"],
    ]);
    const fanIn = computeFanIn(g);
    expect(fanIn.get("a")).toBe(3);
    expect(fanIn.get("b")).toBe(1);
    expect(fanIn.get("c")).toBe(0);
    expect(fanIn.get("d")).toBe(0);
  });
});

describe("computeFanOut", () => {
  test("counts outgoing edges per node", () => {
    const g = makeGraph([
      ["b", "a"],
      ["c", "a"],
      ["d", "a"],
      ["c", "b"],
    ]);
    const fanOut = computeFanOut(g);
    expect(fanOut.get("b")).toBe(1);
    expect(fanOut.get("c")).toBe(2);
    expect(fanOut.get("d")).toBe(1);
    expect(fanOut.get("a")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computePercentile
// ---------------------------------------------------------------------------

describe("computePercentile", () => {
  test("returns correct 95th percentile", () => {
    // Values 1..100 → p95 should be 95
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(computePercentile(values, 95)).toBe(95);
  });

  test("returns max for 100th percentile", () => {
    expect(computePercentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  test("returns min for 0th percentile", () => {
    expect(computePercentile([10, 20, 30], 0)).toBe(10);
  });

  test("handles single-element array", () => {
    expect(computePercentile([42], 50)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// detectHubs
// ---------------------------------------------------------------------------

describe("detectHubs", () => {
  test("basic hub detection — node imported by many files is a hub", () => {
    // Node "hub" is imported by 20 files. Nodes b-e imported by 2-3.
    const edges: [string, string][] = [];
    for (let i = 0; i < 20; i++) {
      edges.push([`importer_${i}`, "hub"]);
    }
    // Low fan-in nodes
    edges.push(["x1", "b"], ["x2", "b"]);
    edges.push(["x3", "c"], ["x4", "c"], ["x5", "c"]);
    edges.push(["x6", "d"], ["x7", "d"]);
    edges.push(["x8", "e"], ["x9", "e"], ["x10", "e"]);

    const g = makeGraph(edges);
    const result = detectHubs(g);

    expect(result.foundation.files).toContain("hub");
    expect(result.foundation.files).not.toContain("b");
    expect(result.foundation.files).not.toContain("c");
  });

  test("percentile threshold — top 5% in 100-node graph", () => {
    // Create 100 target nodes with increasing fan-in (1..100)
    const edges: [string, string][] = [];
    for (let target = 1; target <= 100; target++) {
      for (let j = 0; j < target; j++) {
        edges.push([`src_${target}_${j}`, `target_${target}`]);
      }
    }
    const g = makeGraph(edges);
    const result = detectHubs(g, { percentileThreshold: 95, minFanIn: 999 });

    // Top 5% of 100 nodes = nodes with fan-in >= p95 value (95)
    // That should be target_95 through target_100 (6 nodes)
    expect(result.foundation.files.length).toBeGreaterThanOrEqual(5);
    expect(result.foundation.files).toContain("target_100");
    expect(result.foundation.files).toContain("target_96");
    // Low fan-in nodes should not be in foundation
    expect(result.foundation.files).not.toContain("target_1");
    expect(result.foundation.files).not.toContain("target_50");
  });

  test("graph cleanup — no edges reference hub nodes after removal", () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 20; i++) {
      edges.push([`src_${i}`, "hub"]);
    }
    // hub also has outgoing edge
    edges.push(["hub", "downstream"]);
    // non-hub edges
    edges.push(["a", "b"], ["b", "c"]);

    const g = makeGraph(edges);
    const result = detectHubs(g, { minFanIn: 10 });

    expect(result.foundation.files).toContain("hub");

    // Verify no remaining edge references "hub"
    for (const edge of result.remaining.edges) {
      expect(edge.from).not.toBe("hub");
      expect(edge.to).not.toBe("hub");
    }

    // Non-hub edges preserved
    expect(result.remaining.edges).toContainEqual({ from: "a", to: "b", weight: 1 });
    expect(result.remaining.edges).toContainEqual({ from: "b", to: "c", weight: 1 });
  });

  test("edge case — all equal fan-in produces no hubs", () => {
    // 10 nodes, each imported exactly once
    const edges: [string, string][] = [];
    for (let i = 0; i < 10; i++) {
      edges.push([`src_${i}`, `target_${i}`]);
    }
    const g = makeGraph(edges);
    // With a high minFanIn, equal fan-in of 1 won't hit threshold
    const result = detectHubs(g, { minFanIn: 20 });

    expect(result.foundation.files).toHaveLength(0);
    expect(result.remaining.nodes.length).toBe(g.nodes.length);
  });

  test("edge case — single hub imported by everything", () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 30; i++) {
      edges.push([`leaf_${i}`, "core"]);
    }
    const g = makeGraph(edges);
    const result = detectHubs(g, { minFanIn: 5 });

    expect(result.foundation.files).toEqual(["core"]);
    // After removing core, leaves have no edges left
    expect(result.remaining.edges).toHaveLength(0);
  });

  test("minFanIn floor — detects hub in small graph via absolute threshold", () => {
    // Small graph: p95 would be low, but minFanIn catches it
    const edges: [string, string][] = [];
    // 25 importers of "utils"
    for (let i = 0; i < 25; i++) {
      edges.push([`mod_${i}`, "utils"]);
    }
    // 2 importers of "helper"
    edges.push(["x1", "helper"], ["x2", "helper"]);

    const g = makeGraph(edges);
    // minFanIn=20 should catch "utils" even if percentile alone wouldn't
    const result = detectHubs(g, { percentileThreshold: 99, minFanIn: 20 });

    expect(result.foundation.files).toContain("utils");
    expect(result.foundation.files).not.toContain("helper");
  });

  test("metrics accuracy — fan-in and fan-out values are correct", () => {
    const edges: [string, string][] = [];
    // "hub" gets 15 incoming, 3 outgoing
    for (let i = 0; i < 15; i++) {
      edges.push([`src_${i}`, "hub"]);
    }
    edges.push(["hub", "out1"], ["hub", "out2"], ["hub", "out3"]);

    const g = makeGraph(edges);
    const result = detectHubs(g, { minFanIn: 10 });

    expect(result.foundation.files).toContain("hub");
    const hubMetric = result.foundation.metrics.find((m) => m.file === "hub");
    expect(hubMetric).toBeDefined();
    expect(hubMetric!.fanIn).toBe(15);
    expect(hubMetric!.fanOut).toBe(3);
  });
});
