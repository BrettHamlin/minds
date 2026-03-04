/**
 * collab pipelines remove <name> — uninstall a pipeline, update state
 * Composes: state → lockfile
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { readState, writeState, removePipeline, removePipelineFromClis, isPipelineInstalled } from "../../lib/state.js";
import { readLockfile, writeLockfile, removePipelineFromLockfile } from "../../lib/lockfile.js";
import { printError } from "../../types/index.js";
import type { InstalledState } from "../../types/index.js";

export interface RemoveOptions {
  statePath?: string;
  lockPath?: string;
  installDir?: string;
}

const DEFAULT_STATE_PATH = ".collab/state/installed-pipelines.json";
const DEFAULT_LOCK_PATH = "pipeline-lock.json";
const DEFAULT_INSTALL_DIR = ".collab/pipelines";

export async function remove(names: string[], options: RemoveOptions = {}): Promise<void> {
  if (names.length === 0) {
    console.error("Usage: collab pipelines remove <name> [<name>...]");
    process.exit(1);
  }

  const statePath = options.statePath ?? DEFAULT_STATE_PATH;
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const installDir = options.installDir ?? DEFAULT_INSTALL_DIR;

  let state: InstalledState;
  try {
    state = readState(statePath);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  let lockfile = readLockfile(lockPath);

  for (const name of names) {
    if (!isPipelineInstalled(state, name)) {
      console.warn(`  ? "${name}" is not installed — skipping`);
      continue;
    }

    // Check if any other pipeline requires this one
    const entry = state.pipelines[name];
    const dependents = Object.entries(state.pipelines)
      .filter(([, p]) => p.requiredBy.includes(name))
      .map(([n]) => n);

    if (dependents.length > 0) {
      console.warn(
        `  ! "${name}" is required by: ${dependents.join(", ")}. Remove those first.`
      );
      continue;
    }

    // Remove from state
    state = removePipeline(state, name);
    state = removePipelineFromClis(state, name);

    // Remove from lockfile
    if (lockfile) {
      lockfile = removePipelineFromLockfile(lockfile, name);
    }

    // Remove installed files
    const pipelineDir = join(installDir, name);
    try {
      rmSync(pipelineDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`  ! Could not remove files at ${pipelineDir}: ${err}`);
    }

    console.log(`  ✓ Removed ${name}`);
  }

  // Write updated state
  try {
    writeState(statePath, state);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  // Write updated lockfile
  if (lockfile) {
    try {
      writeLockfile(lockPath, lockfile);
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  }

  console.log("\nDone.");
}

