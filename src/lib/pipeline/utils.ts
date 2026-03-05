/**
 * Pipeline utilities — shared between orchestrator scripts.
 *
 * Pure functions for repo root detection, JSON file I/O, and registry paths.
 * No side effects - all I/O is explicit in the function signatures.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { emitStatusEvent } from "./status-emitter";

export function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

export function readJsonFile(filePath: string): any | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath: string, data: any): void {
  const previous = readJsonFile(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
  if (data && typeof data === "object" && data.ticket_id) {
    emitStatusEvent(filePath, previous, data);
  }
}

export function getRegistryPath(registryDir: string, ticketId: string): string {
  return path.join(registryDir, `${ticketId}.json`);
}

/**
 * Scan specs/ for a directory whose name contains ticketId (case-insensitive).
 * Returns the full path, or null if not found.
 */
export function findFeatureDir(repoRoot: string, ticketId: string): string | null {
  const specsDir = path.join(repoRoot, "specs");
  if (!fs.existsSync(specsDir)) return null;
  try {
    const entries = fs.readdirSync(specsDir);
    // Pass 1: check directory name for ticket ID (fast path)
    for (const entry of entries) {
      if (entry.toLowerCase().includes(ticketId.toLowerCase())) {
        return path.join(specsDir, entry);
      }
    }
    // Pass 2: check metadata.json ticket_id in each subdir (handles 001-feature-name dirs)
    for (const entry of entries) {
      const metaPath = path.join(specsDir, entry, "metadata.json");
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        if (meta.ticket_id === ticketId) {
          return path.join(specsDir, entry);
        }
      } catch {
        // malformed metadata — skip
      }
    }
  } catch {}
  return null;
}

/**
 * Parse --pipeline and --ticket flags from CLI args.
 * Single source of truth for pipeline variant arg parsing across all orchestrator scripts.
 */
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
 *   1. Explicit `variant` option  → .collab/config/pipeline-variants/{variant}.json
 *   2. `ticketId` + `registryDir` → read pipeline_variant from registry, same resolution
 *   3. Default                    → .collab/config/pipeline.json
 *
 * Falls back to the default pipeline.json when a variant is specified but
 * the variant file does not exist (mirrors orchestrator-init.ts behavior).
 */
export function resolvePipelineConfigPath(
  repoRoot: string,
  options: {
    variant?: string;
    ticketId?: string;
    registryDir?: string;
  } = {}
): string {
  const defaultPath = path.join(repoRoot, ".collab", "config", "pipeline.json");

  let variant = options.variant;
  if (!variant && options.ticketId && options.registryDir) {
    const regPath = getRegistryPath(options.registryDir, options.ticketId);
    const registry = readJsonFile(regPath);
    variant = registry?.pipeline_variant as string | undefined;
  }

  if (variant) {
    const variantPath = path.join(
      repoRoot,
      ".collab",
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

// ---------------------------------------------------------------------------
// loadPipelineForTicket — SINGLE SOURCE OF TRUTH for loading pipeline config
//
// Every orchestrator script that needs the pipeline config calls this ONE
// function with the ticket ID. It reads the registry, resolves the variant,
// loads and returns the config. No flags, no env vars, no guessing.
// ---------------------------------------------------------------------------

export interface LoadedPipeline {
  configPath: string;
  pipeline: Record<string, any>;
  variant: string | undefined;
}

export function loadPipelineForTicket(repoRoot: string, ticketId: string): LoadedPipeline {
  const registryDir = path.join(repoRoot, ".collab", "state", "pipeline-registry");
  const regPath = getRegistryPath(registryDir, ticketId);
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
