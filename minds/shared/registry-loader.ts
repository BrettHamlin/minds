/**
 * registry-loader.ts — Multi-repo Mind registry loading.
 *
 * Loads minds.json from each repo in a multi-repo workspace,
 * tags each mind with its repo alias, and detects name collisions.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveMindsDir } from "./paths.ts";
import type { MindDescription } from "../mind.ts";

/**
 * Load Mind registries from each repo in a multi-repo workspace.
 * Tags each mind with its repo alias. Throws on name collisions.
 * Silently skips repos without minds.json.
 */
export function loadMultiRepoRegistries(repoPaths: Map<string, string>): MindDescription[] {
  const merged: MindDescription[] = [];
  for (const [alias, repoPath] of repoPaths) {
    const mindsDir = resolveMindsDir(repoPath);
    const jsonPath = join(mindsDir, "minds.json");
    if (!existsSync(jsonPath)) continue;
    const registry = JSON.parse(readFileSync(jsonPath, "utf-8")) as MindDescription[];
    for (const mind of registry) {
      const existing = merged.find(m => m.name === mind.name);
      if (existing) {
        throw new Error(
          `Mind name collision: @${mind.name} exists in both "${existing.repo ?? "orchestrator"}" and "${alias}"`,
        );
      }
      merged.push({ ...mind, repo: alias });
    }
  }
  return merged;
}
