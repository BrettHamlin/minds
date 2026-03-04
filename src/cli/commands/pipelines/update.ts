/**
 * collab pipelines update — check registry for updates, show diff, prompt before updating
 * Composes: registry → state → lockfile → install (for actual update)
 */

import { fetchRegistry, buildVersionMap } from "../../lib/registry.js";
import { readState } from "../../lib/state.js";
import { readLockfile, diffAgainstRegistry } from "../../lib/lockfile.js";
import { install } from "./install.js";
import { printError } from "../../types/index.js";
import type { InstalledState, Lockfile } from "../../types/index.js";

export interface UpdateOptions {
  registryUrl?: string;
  statePath?: string;
  lockPath?: string;
  installDir?: string;
  yes?: boolean;   // skip confirmation
  json?: boolean;
}

const DEFAULT_STATE_PATH = ".collab/state/installed-pipelines.json";
const DEFAULT_LOCK_PATH = "pipeline-lock.json";

export async function update(names: string[] = [], options: UpdateOptions = {}): Promise<void> {
  const statePath = options.statePath ?? DEFAULT_STATE_PATH;
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;

  console.log("Fetching registry...");
  let registry;
  try {
    registry = await fetchRegistry(options.registryUrl);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  let state: InstalledState;
  try {
    state = readState(statePath);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  const installedNames = Object.keys(state.pipelines);
  if (installedNames.length === 0) {
    console.log("No pipelines installed. Nothing to update.");
    return;
  }

  const versionMap = buildVersionMap(registry);

  // Find outdated pipelines
  const toCheck = names.length > 0 ? names : installedNames;
  const updates: Array<{ name: string; current: string; latest: string }> = [];

  for (const name of toCheck) {
    const installed = state.pipelines[name];
    if (!installed) {
      console.warn(`  ? "${name}" is not installed — skipping`);
      continue;
    }
    const latest = versionMap.get(name);
    if (!latest) {
      console.warn(`  ? "${name}" not found in registry`);
      continue;
    }
    if (latest !== installed.version) {
      updates.push({ name, current: installed.version, latest });
    }
  }

  if (updates.length === 0) {
    console.log("All pipelines are up to date.");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(updates, null, 2));
    return;
  }

  console.log(`\n${updates.length} update(s) available:\n`);
  for (const u of updates) {
    console.log(`  ${u.name.padEnd(24)} ${u.current.padEnd(12)} → ${u.latest}`);
  }

  if (!options.yes) {
    // In a real interactive CLI this would use readline/prompt
    // For now: print instructions and exit
    console.log("\nRun with --yes to apply all updates:");
    console.log(`  collab pipelines update --yes`);
    return;
  }

  console.log("\nApplying updates...");
  const updateNames = updates.map((u) => u.name);

  await install(updateNames, {
    registryUrl: options.registryUrl,
    statePath,
    lockPath,
    installDir: options.installDir,
    force: true,
  });
}

