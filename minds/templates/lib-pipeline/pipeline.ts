/**
 * pipeline.ts — Pipeline config path resolution utility.
 *
 * Install path: .collab/lib/pipeline/pipeline.ts
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Resolve the pipeline config file path, supporting pipeline variants.
 *
 * Resolution order:
 *   1. Explicit `variant` option  → .collab/config/pipeline-variants/{variant}.json
 *   2. `ticketId` + registry      → read pipeline_variant from registry, same resolution
 *   3. Default                    → .collab/config/pipeline.json
 */
export function resolvePipelineConfigPath(
  repoRoot: string,
  options: { variant?: string; ticketId?: string } = {}
): string {
  const defaultPath = path.join(repoRoot, ".collab", "config", "pipeline.json");

  let variant = options.variant;
  if (!variant && options.ticketId) {
    const { registryPath } = require("./paths");
    const regPath = registryPath(repoRoot, options.ticketId);
    try {
      if (fs.existsSync(regPath)) {
        const registry = JSON.parse(fs.readFileSync(regPath, "utf-8"));
        variant = registry?.pipeline_variant as string | undefined;
      }
    } catch {
      // registry unreadable — fall through to default
    }
  }

  if (variant) {
    const variantPath = path.join(
      repoRoot, ".collab", "config", "pipeline-variants", `${variant}.json`
    );
    if (fs.existsSync(variantPath)) return variantPath;
  }

  return defaultPath;
}
