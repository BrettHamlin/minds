#!/usr/bin/env bun
/**
 * run-pipeline.ts — Standalone script that runs the Fission analysis pipeline
 * and outputs the result as JSON to stdout.
 *
 * Usage:
 *   bun minds/fission/run-pipeline.ts [target-dir]
 *
 * If target-dir is omitted, uses the current working directory.
 * All progress messages go to stderr so stdout is clean JSON.
 */

import { resolve } from "path";
import { existsSync } from "fs";
import { runPipeline, detectLanguage } from "./lib/pipeline.js";
import { prepareClusterData } from "./naming/naming.js";

const targetDir = resolve(process.argv[2] ?? process.cwd());

if (!existsSync(targetDir)) {
  process.stderr.write(`Error: directory does not exist: ${targetDir}\n`);
  process.exit(1);
}

const language = detectLanguage(targetDir);
process.stderr.write(`Analyzing ${targetDir} (language: ${language})...\n`);

const result = await runPipeline(targetDir, { language });

if (result.graph.totalNodes === 0) {
  process.stderr.write("No source files found.\n");
  process.exit(1);
}

// Enrich clusters with naming-ready data (directories, sample filenames)
const clusterData = result.clusters.length > 0
  ? prepareClusterData(result.clusters.map(c => ({
      ...c,
      clusterId: c.clusterId,
      files: c.files,
      internalEdges: c.internalEdges,
      externalEdges: c.externalEdges,
      cohesion: c.cohesion,
    })))
  : [];

const output = {
  graph: result.graph,
  foundation: result.foundation,
  clusters: clusterData,
  modularity: result.modularity,
  couplingMatrix: result.couplingMatrix,
  leidenIterations: result.leidenIterations,
};

process.stdout.write(JSON.stringify(output, null, 2) + "\n");
process.stderr.write(`Done: ${result.graph.totalNodes} files, ${result.clusters.length} clusters, modularity ${result.modularity.toFixed(3)}\n`);
