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

  // Determine variant: explicit option takes precedence over registry lookup
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
    // Variant file missing — fall back to default (same behavior as orchestrator-init.ts)
  }

  return defaultPath;
}
