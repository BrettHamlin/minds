import type { DependencyGraph } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface HubMetric {
  file: string;
  fanIn: number;
  fanOut: number;
}

export interface FoundationResult {
  foundation: {
    files: string[];
    metrics: HubMetric[];
  };
  remaining: DependencyGraph;
}

export interface HubDetectionOptions {
  /** Fan-in percentile threshold (0-100). Default: 95 */
  percentileThreshold?: number;
  /** Minimum fan-in to be considered a hub regardless of percentile. Default: 20 */
  minFanIn?: number;
}

// ---------------------------------------------------------------------------
// Fan-in / Fan-out computation
// ---------------------------------------------------------------------------

/**
 * Count incoming edges per node (how many files import this node).
 */
export function computeFanIn(graph: DependencyGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    counts.set(node, 0);
  }
  for (const edge of graph.edges) {
    counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  }
  return counts;
}

/**
 * Count outgoing edges per node (how many files this node imports).
 */
export function computeFanOut(graph: DependencyGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    counts.set(node, 0);
  }
  for (const edge of graph.edges) {
    counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Percentile
// ---------------------------------------------------------------------------

/**
 * Compute the Nth percentile from an array of numbers using nearest-rank.
 * @param values - Non-empty array of numbers (will be sorted internally)
 * @param percentile - 0-100
 */
export function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (percentile <= 0) return sorted[0];
  if (percentile >= 100) return sorted[sorted.length - 1];

  // Nearest-rank method: index = ceil(P/100 * N) - 1
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// ---------------------------------------------------------------------------
// Hub Detection
// ---------------------------------------------------------------------------

/**
 * Detect hub files (high fan-in cross-cutting concerns) and extract them
 * into a Foundation Mind group. Returns the foundation files plus the
 * remaining graph with hubs removed.
 */
export function detectHubs(
  graph: DependencyGraph,
  options: HubDetectionOptions = {},
): FoundationResult {
  const { percentileThreshold = 95, minFanIn = 20 } = options;

  const fanInMap = computeFanIn(graph);
  const fanOutMap = computeFanOut(graph);

  // Compute percentile only over nodes with fan-in > 0 (nodes that are
  // actually imported). Including pure source nodes (fan-in=0) would skew
  // the percentile and make the threshold meaninglessly low.
  const fanInValues = [...fanInMap.values()].filter((v) => v > 0);
  const threshold =
    fanInValues.length > 0
      ? computePercentile(fanInValues, percentileThreshold)
      : 0;

  // A node is a hub if EITHER condition is met:
  //   - fanIn strictly exceeds the percentile threshold (statistical outlier)
  //   - fanIn >= minFanIn absolute floor (catches hubs in small graphs)
  const hubSet = new Set<string>();
  const metrics: HubMetric[] = [];

  for (const [file, fanIn] of fanInMap) {
    if (fanIn > 0 && (fanIn >= minFanIn || fanIn > threshold)) {
      hubSet.add(file);
      metrics.push({
        file,
        fanIn,
        fanOut: fanOutMap.get(file) ?? 0,
      });
    }
  }

  // Sort metrics by fan-in descending for readability
  metrics.sort((a, b) => b.fanIn - a.fanIn);

  // Build remaining graph: remove hub nodes and their edges
  const remainingEdges = graph.edges.filter(
    (e) => !hubSet.has(e.from) && !hubSet.has(e.to),
  );

  // Determine which non-hub nodes still participate in edges
  const connectedNodes = new Set<string>();
  for (const edge of remainingEdges) {
    connectedNodes.add(edge.from);
    connectedNodes.add(edge.to);
  }

  // Keep only connected non-hub nodes
  const remainingNodes = graph.nodes.filter(
    (n) => !hubSet.has(n) && connectedNodes.has(n),
  );

  return {
    foundation: {
      files: [...hubSet],
      metrics,
    },
    remaining: {
      nodes: remainingNodes,
      edges: remainingEdges,
    },
  };
}
