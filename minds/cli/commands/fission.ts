/**
 * fission.ts — CLI command handler for `minds fission`.
 *
 * Runs the Fission pipeline against a target codebase, displays
 * proposed Mind boundaries, and optionally scaffolds them.
 */

import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import { runPipeline, detectLanguage } from "../../fission/lib/pipeline.js";
import { nameAndValidate, type NamingInput } from "../../fission/naming/naming.js";
import { displayProposedMap, displaySummary } from "../../fission/lib/display.js";
import { scaffoldAllMinds } from "../../fission/lib/scaffold-minds.js";
import { detectProjectType } from "../../fission/lib/project-type.js";
import type { PipelineResult } from "../../fission/lib/pipeline.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface FissionOptions {
  language?: string;
  hubThreshold?: string;
  resolution?: string;
  output?: string;
  dryRun?: boolean;
  yes?: boolean;
  offline?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Command handler                                                    */
/* ------------------------------------------------------------------ */

export async function runFission(
  targetDir: string | undefined,
  options: FissionOptions,
): Promise<void> {
  // 1. Resolve target directory
  const target = resolve(targetDir ?? process.cwd());
  if (!existsSync(target)) {
    console.error(`Error: Target directory does not exist: ${target}`);
    process.exit(1);
    return;
  }

  // 2. Parse numeric options
  const hubThreshold = parseFloat(options.hubThreshold ?? "95");
  const resolution = parseFloat(options.resolution ?? "1.0");

  // 3. Detect language
  const language = options.language ?? detectLanguage(target);
  console.log(`Analyzing ${target} (language: ${language})...`);

  // 4. Run the pipeline
  let pipelineResult: PipelineResult;
  try {
    pipelineResult = await runPipeline(target, {
      language,
      hubThreshold,
      resolution,
    });
  } catch (err) {
    console.error(`Pipeline failed: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  // Handle empty results
  if (pipelineResult.graph.totalNodes === 0) {
    console.log("No source files found. Nothing to analyze.");
    return;
  }

  if (pipelineResult.clusters.length === 0 && pipelineResult.foundation.files.length === 0) {
    console.log("No clusters or foundation files detected. The codebase may be too small.");
    return;
  }

  // 5. Build the NamingInput from PipelineResult
  //    We need the remaining graph (hub-filtered). Since the pipeline doesn't
  //    expose it directly, we reconstruct it from clusters.
  const clusterFiles = new Set(pipelineResult.clusters.flatMap((c) => c.files));
  const foundationFiles = new Set(pipelineResult.foundation.files);
  const allNodes = [...clusterFiles];
  const remainingEdges = []; // We don't have exact remaining edges, use empty for naming

  const namingInput: NamingInput = {
    foundation: pipelineResult.foundation,
    remaining: {
      nodes: allNodes,
      edges: [],
    },
    clusters: pipelineResult.clusters,
    modularity: pipelineResult.modularity,
    graph: {
      nodes: [...clusterFiles, ...foundationFiles],
      edges: [],
    },
  };

  // 6. Run naming (LLM by default if claude CLI is available, --offline to disable)
  const proposedMap = await nameAndValidate(namingInput, {
    offline: options.offline ?? false,
  });

  // 7. Display results
  console.log("");
  console.log(displayProposedMap(proposedMap));
  console.log(displaySummary(proposedMap));
  console.log("");

  // 8. Write JSON output if requested
  if (options.output) {
    const outputPath = resolve(options.output);
    writeFileSync(outputPath, JSON.stringify(proposedMap, null, 2) + "\n", "utf8");
    console.log(`Proposed map written to: ${outputPath}`);
  }

  // 9. Dry-run stops here
  if (options.dryRun) {
    console.log("Dry run complete. No Minds were scaffolded.");
    return;
  }

  // 10. Detect project type for build/verify mind scaffolding
  const projectType = detectProjectType(target);
  if (projectType !== "unknown") {
    console.log(`\nDetected project type: ${projectType}`);
  }

  // 11. Scaffold all Minds (including build/verify when project type is known)
  console.log("\nScaffolding Minds...");
  const scaffoldResult = await scaffoldAllMinds(proposedMap, { projectType });

  // 12. Display scaffold results
  if (scaffoldResult.created.length > 0) {
    console.log(`\nCreated ${scaffoldResult.created.length} Minds:`);
    for (const name of scaffoldResult.created) {
      console.log(`  + ${name}`);
    }
  }

  if (scaffoldResult.failed.length > 0) {
    console.error(`\nFailed to create ${scaffoldResult.failed.length} Minds:`);
    for (const { mind, error } of scaffoldResult.errors) {
      console.error(`  x ${mind}: ${error}`);
    }
  }

  if (scaffoldResult.failed.length === 0) {
    console.log("\nFission complete. All Minds scaffolded successfully.");
  } else {
    console.log(
      `\nFission completed with ${scaffoldResult.failed.length} error(s).`,
    );
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */
