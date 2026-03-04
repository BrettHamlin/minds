/**
 * collab pipelines — browse available packs and pipelines from registry
 * Displays an interactive list. Composes registry.ts only.
 */

import { fetchRegistry, listPacks, listPipelines } from "../../lib/registry.js";
import { printError } from "../../types/index.js";
import type { RegistryEntry, RegistryIndex } from "../../types/index.js";

export interface BrowseOptions {
  registryUrl?: string;
  json?: boolean;
}

export async function browse(options: BrowseOptions = {}): Promise<void> {
  let registry: RegistryIndex;
  try {
    registry = await fetchRegistry(options.registryUrl);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  const packs = listPacks(registry);
  const pipelines = listPipelines(registry);

  if (options.json) {
    console.log(JSON.stringify({ packs, pipelines }, null, 2));
    return;
  }

  printHeader("Available Packs");
  if (packs.length === 0) {
    console.log("  (none)");
  } else {
    for (const entry of packs) {
      printEntry(entry);
    }
  }

  console.log();

  printHeader("Available Pipelines");
  if (pipelines.length === 0) {
    console.log("  (none)");
  } else {
    for (const entry of pipelines) {
      printEntry(entry);
    }
  }

  console.log();
  console.log(`Registry: ${options.registryUrl ?? process.env.COLLAB_REGISTRY ?? "default"}`);
  console.log(`Updated: ${registry.updatedAt || "unknown"}`);
  console.log();
  console.log("Install with: collab pipelines install <name>");
}

function printHeader(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

function printEntry(entry: RegistryEntry): void {
  console.log(`  ${entry.name.padEnd(24)} v${entry.latestVersion.padEnd(10)} ${entry.description}`);
}

