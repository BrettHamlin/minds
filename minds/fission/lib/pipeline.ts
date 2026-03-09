/**
 * pipeline.ts — Fission pipeline orchestrator.
 *
 * Wires together the import extractor, hub detection, and Leiden
 * clustering into a single deterministic pipeline that takes a
 * directory and produces a structured analysis result.
 *
 * No LLM calls. No external dependencies.
 */

import { existsSync } from "fs";
import { join } from "path";
import { TypeScriptExtractor } from "../extractors/typescript.js";
import { detectHubs } from "../analysis/hubs.js";
import { leiden } from "../analysis/leiden.js";
import { mergeSmallClusters } from "../analysis/merge.js";
import { computeCouplingMatrix, computeModularityScore } from "../analysis/metrics.js";
import type { DependencyGraph } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface PipelineOptions {
  /** Language of the target codebase. Default: auto-detect. */
  language?: string;
  /** Fan-in percentile threshold for hub detection. Default: 95 */
  hubThreshold?: number;
  /** Minimum absolute fan-in for hub detection. Default: 20 */
  hubMinFanIn?: number;
  /** Leiden resolution parameter. Higher = more smaller clusters.
   *  When omitted, adaptive resolution scaling is used based on graph size. */
  resolution?: number;
  /** Leiden max iterations. Default: 10 */
  maxIterations?: number;
  /** Minimum files per cluster. Clusters below this get merged into
   *  their most-coupled neighbor. Default: 10 */
  minClusterSize?: number;
}

export interface PipelineResult {
  graph: {
    totalNodes: number;
    totalEdges: number;
    density: number;
  };
  foundation: {
    files: string[];
    metrics: { file: string; fanIn: number; fanOut: number }[];
  };
  clusters: {
    clusterId: number;
    files: string[];
    internalEdges: number;
    externalEdges: number;
    cohesion: number;
  }[];
  modularity: number;
  couplingMatrix: { from: number; to: number; edges: number }[];
  leidenIterations: number;
}

/* ------------------------------------------------------------------ */
/*  Language detection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Detect the primary language of a project by checking for marker files.
 * Checks in priority order; first match wins.
 */
export function detectLanguage(targetDir: string): string {
  const markers: [string, string][] = [
    ["tsconfig.json", "typescript"],
    ["package.json", "typescript"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["Package.swift", "swift"],
    ["pyproject.toml", "python"],
    ["setup.py", "python"],
  ];

  for (const [file, language] of markers) {
    if (existsSync(join(targetDir, file))) {
      return language;
    }
  }

  return "typescript";
}

/* ------------------------------------------------------------------ */
/*  Adaptive resolution                                                */
/* ------------------------------------------------------------------ */

/**
 * Scale Leiden resolution based on graph size. For large graphs,
 * a resolution of 1.0 produces hundreds of micro-clusters. This
 * scales resolution down logarithmically so larger graphs get
 * coarser (fewer, larger) clusters.
 *
 * For 4,750 nodes: 1.0 / log10(4750) ~ 0.272
 * For 100 nodes: 1.0 (no scaling)
 * For 34 nodes: 1.0 (no scaling)
 */
export function adaptiveResolution(
  nodeCount: number,
  baseResolution: number = 1.0,
): number {
  if (nodeCount <= 100) return baseResolution;
  return baseResolution / Math.log10(nodeCount);
}

/**
 * Scale the minimum cluster size based on graph size. For large
 * codebases, a minClusterSize of 10 leaves hundreds of small clusters.
 * This uses sqrt(nodeCount) to scale the threshold proportionally,
 * targeting roughly 15-30 domain clusters for large codebases.
 *
 * For 4,750 nodes: floor(sqrt(4750)) = 68
 * For 500 nodes: floor(sqrt(500)) = 22
 * For 100 nodes: 10 (no scaling)
 *
 * The sqrt scaling means larger codebases have proportionally larger
 * minimum clusters, but not so aggressive that everything collapses.
 */
export function adaptiveMinClusterSize(
  nodeCount: number,
  baseMinSize: number = 10,
): number {
  if (nodeCount <= 100) return baseMinSize;
  return Math.max(baseMinSize, Math.floor(Math.sqrt(nodeCount)));
}

/* ------------------------------------------------------------------ */
/*  Pipeline orchestrator                                              */
/* ------------------------------------------------------------------ */

/**
 * Run the full Fission analysis pipeline on a target directory.
 *
 * Steps:
 * 1. Select extractor based on language
 * 2. Extract dependency graph
 * 3. Detect hubs (foundation files)
 * 4. Run Leiden clustering on hub-filtered graph (with adaptive resolution)
 * 5. Merge small clusters into most-coupled neighbors
 * 6. Compute coupling matrix between clusters
 * 7. Assemble result
 */
export async function runPipeline(
  targetDir: string,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const {
    language,
    hubThreshold = 95,
    hubMinFanIn = 20,
    maxIterations = 10,
  } = options ?? {};

  // If user passed explicit resolution, use it. Otherwise, defer to adaptive scaling.
  const userResolution = options?.resolution;
  // If user passed explicit minClusterSize, use it. Otherwise, defer to adaptive scaling.
  const userMinClusterSize = options?.minClusterSize;

  // Step 1: Select extractor
  const lang = language ?? detectLanguage(targetDir);
  const extractor = selectExtractor(lang);

  // Step 2: Extract dependency graph
  const graph = await extractor.extract(targetDir);

  // Handle empty graph
  if (graph.nodes.length === 0) {
    return emptyResult();
  }

  // Compute graph density
  const maxPossibleEdges = graph.nodes.length * (graph.nodes.length - 1);
  const density = maxPossibleEdges > 0 ? graph.edges.length / maxPossibleEdges : 0;

  // Handle graph with no edges
  if (graph.edges.length === 0) {
    return {
      graph: {
        totalNodes: graph.nodes.length,
        totalEdges: 0,
        density: 0,
      },
      foundation: { files: [], metrics: [] },
      clusters: [],
      modularity: 0,
      couplingMatrix: [],
      leidenIterations: 0,
    };
  }

  // Step 3: Hub detection
  const hubResult = detectHubs(graph, {
    percentileThreshold: hubThreshold,
    minFanIn: hubMinFanIn,
  });

  // Step 4: Leiden clustering on remaining (hub-filtered) graph
  const resolution = userResolution ?? adaptiveResolution(hubResult.remaining.nodes.length);
  const leidenResult = leiden(hubResult.remaining, {
    resolution,
    maxIterations,
  });

  // Step 5: Merge small clusters into most-coupled neighbors
  const minClusterSize = userMinClusterSize ?? adaptiveMinClusterSize(hubResult.remaining.nodes.length);
  const mergedClusters = mergeSmallClusters(
    hubResult.remaining,
    leidenResult.clusters,
    { minClusterSize },
  );

  // Step 6: Coupling matrix between clusters
  const rawCoupling = computeCouplingMatrix(hubResult.remaining, mergedClusters);

  // Convert coupling matrix from string cluster labels to numeric IDs
  const couplingMatrix = rawCoupling.map((entry) => ({
    from: parseClusterId(entry.from),
    to: parseClusterId(entry.to),
    edges: entry.edges,
  }));

  // Step 7: Modularity (already computed by Leiden, but also available via metrics)
  const modularity = leidenResult.modularity;

  return {
    graph: {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      density,
    },
    foundation: {
      files: hubResult.foundation.files,
      metrics: hubResult.foundation.metrics,
    },
    clusters: mergedClusters.map((c) => ({
      clusterId: c.clusterId,
      files: c.files,
      internalEdges: c.internalEdges,
      externalEdges: c.externalEdges,
      cohesion: c.cohesion,
    })),
    modularity,
    couplingMatrix,
    leidenIterations: leidenResult.iterations,
  };
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function selectExtractor(language: string) {
  switch (language) {
    case "typescript":
    case "javascript":
      return new TypeScriptExtractor();
    default:
      // Only TypeScript is supported for now; default to it
      return new TypeScriptExtractor();
  }
}

function emptyResult(): PipelineResult {
  return {
    graph: { totalNodes: 0, totalEdges: 0, density: 0 },
    foundation: { files: [], metrics: [] },
    clusters: [],
    modularity: 0,
    couplingMatrix: [],
    leidenIterations: 0,
  };
}

/** Parse "cluster-N" label to numeric N. */
function parseClusterId(label: string): number {
  const match = label.match(/^cluster-(\d+)$/);
  return match ? parseInt(match[1], 10) : -1;
}
