/**
 * pipeline.ts — Pipeline config loading and resolution.
 */

import * as fs from "fs";
import * as path from "path";
import { readJsonFile } from "./json-io";
import { registryPath } from "./paths";

export function parsePipelineArgs(args: string[]): { variant: string | undefined; ticketId: string | undefined } {
  const pipelineIdx = args.indexOf("--pipeline");
  const variant = pipelineIdx !== -1 && args[pipelineIdx + 1] ? args[pipelineIdx + 1] : undefined;
  const ticketIdx = args.indexOf("--ticket");
  const ticketId = ticketIdx !== -1 && args[ticketIdx + 1] ? args[ticketIdx + 1] : undefined;
  return { variant, ticketId };
}

/**
 * Resolve the pipeline config file path, supporting pipeline variants.
 *
 * Resolution order:
 *   1. Explicit `variant` option  → .minds/config/pipeline-variants/{variant}.json
 *   2. `ticketId` + `registryDir` → read pipeline_variant from registry, same resolution
 *   3. Default                    → .minds/config/pipeline.json
 *
 * Falls back to the default pipeline.json when a variant is specified but
 * the variant file does not exist (mirrors orchestrator-init.ts behavior).
 */
export function resolvePipelineConfigPath(
  repoRoot: string,
  options: {
    variant?: string;
    ticketId?: string;
  } = {}
): string {
  const defaultPath = path.join(repoRoot, ".minds", "config", "pipeline.json");

  let variant = options.variant;
  if (!variant && options.ticketId) {
    const regPath = registryPath(repoRoot, options.ticketId);
    const registry = readJsonFile(regPath);
    variant = registry?.pipeline_variant as string | undefined;
  }

  if (variant) {
    const variantPath = path.join(
      repoRoot,
      ".minds",
      "config",
      "pipeline-variants",
      `${variant}.json`
    );
    if (fs.existsSync(variantPath)) {
      return variantPath;
    }
  }

  return defaultPath;
}

export interface LoadedPipeline {
  configPath: string;
  pipeline: Record<string, any>;
  variant: string | undefined;
}

// ---------------------------------------------------------------------------
// loadPipelineForTicket — SINGLE SOURCE OF TRUTH for loading pipeline config
//
// Every orchestrator script that needs the pipeline config calls this ONE
// function with the ticket ID. It reads the registry, resolves the variant,
// loads and returns the config. No flags, no env vars, no guessing.
// ---------------------------------------------------------------------------

export function loadPipelineForTicket(repoRoot: string, ticketId: string): LoadedPipeline {
  const regPath = registryPath(repoRoot, ticketId);
  const registry = readJsonFile(regPath);
  const variant = registry?.pipeline_variant as string | undefined;

  // Multi-repo: use repo_path from registry if available (agent may work in a different repo)
  const effectiveRoot = (registry?.repo_path as string | undefined) ?? repoRoot;
  const configPath = resolvePipelineConfigPath(effectiveRoot, { variant });
  const pipeline = readJsonFile(configPath);

  if (!pipeline || !pipeline.phases || typeof pipeline.phases !== "object") {
    throw new Error(
      `Pipeline config not found or malformed: ${configPath}` +
      (variant ? ` (variant: ${variant})` : "") +
      ` for ticket ${ticketId}`
    );
  }

  return { configPath, pipeline, variant };
}
