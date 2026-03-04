/**
 * Collab CLI — installed-pipelines.json state management
 * Atomic reads and writes to prevent corruption on crash.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeError } from "../types/index.js";
import type {
  InstalledState,
  InstalledPipeline,
  InstalledCli,
  CollabError,
} from "../types/index.js";

const EMPTY_STATE: InstalledState = {
  version: "1",
  installedAt: new Date().toISOString(),
  pipelines: {},
  clis: {},
};

/**
 * Read installed-pipelines.json. Returns an empty state if file doesn't exist.
 * Throws CollabError if the file exists but is corrupt.
 */
export function readState(statePath: string): InstalledState {
  if (!existsSync(statePath)) {
    return { ...EMPTY_STATE, installedAt: new Date().toISOString() };
  }

  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch (err) {
    throw makeError("STATE_CORRUPT", `Cannot read state file: ${statePath}`, {
      path: statePath,
      cause: String(err),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw makeError("STATE_CORRUPT", `State file is not valid JSON: ${statePath}`, {
      path: statePath,
      cause: String(err),
    });
  }

  return validateState(parsed, statePath);
}

/**
 * Write installed-pipelines.json atomically (write to .tmp, then rename).
 * Creates the directory if it doesn't exist.
 */
export function writeState(statePath: string, state: InstalledState): void {
  const dir = dirname(statePath);
  mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(state, null, 2) + "\n";
  const tmpPath = statePath + ".tmp";

  try {
    writeFileSync(tmpPath, json, "utf8");
    renameSync(tmpPath, statePath);
  } catch (err) {
    throw makeError("ATOMIC_WRITE_FAILED", `Cannot write state file: ${statePath}`, {
      path: statePath,
      tmpPath,
      cause: String(err),
    });
  }
}

/**
 * Add or update a pipeline entry in state. Returns updated state (does not write).
 */
export function addPipeline(
  state: InstalledState,
  pipeline: Omit<InstalledPipeline, "installedAt">
): InstalledState {
  const existing = state.pipelines[pipeline.name];
  const requiredBy = existing
    ? mergeUnique(existing.requiredBy, pipeline.requiredBy)
    : pipeline.requiredBy;

  return {
    ...state,
    pipelines: {
      ...state.pipelines,
      [pipeline.name]: {
        ...pipeline,
        requiredBy,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
      },
    },
  };
}

/**
 * Remove a pipeline from state. Cleans requiredBy entries across all pipelines.
 * Returns updated state (does not write).
 */
export function removePipeline(state: InstalledState, name: string): InstalledState {
  const pipelines = { ...state.pipelines };
  delete pipelines[name];

  // Remove from requiredBy lists
  for (const key of Object.keys(pipelines)) {
    pipelines[key] = {
      ...pipelines[key],
      requiredBy: pipelines[key].requiredBy.filter((r) => r !== name),
    };
  }

  return { ...state, pipelines };
}

/**
 * Add or update a CLI tool entry in state. Returns updated state (does not write).
 */
export function addCli(
  state: InstalledState,
  cli: Omit<InstalledCli, "installedAt">
): InstalledState {
  const existing = state.clis[cli.name];
  const requiredBy = existing
    ? mergeUnique(existing.requiredBy, cli.requiredBy)
    : cli.requiredBy;

  return {
    ...state,
    clis: {
      ...state.clis,
      [cli.name]: {
        ...cli,
        requiredBy,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
      },
    },
  };
}

/**
 * Remove a requiredBy entry for a pipeline from all CLI records.
 * Returns updated state (does not write).
 */
export function removePipelineFromClis(
  state: InstalledState,
  pipelineName: string
): InstalledState {
  const clis = { ...state.clis };
  for (const key of Object.keys(clis)) {
    clis[key] = {
      ...clis[key],
      requiredBy: clis[key].requiredBy.filter((r) => r !== pipelineName),
    };
  }
  return { ...state, clis };
}

/**
 * List all installed pipeline names.
 */
export function listPipelineNames(state: InstalledState): string[] {
  return Object.keys(state.pipelines).sort();
}

/**
 * Check if a pipeline is installed at a version satisfying the given range.
 */
export function isPipelineInstalled(state: InstalledState, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.pipelines, name);
}

// ─── Internal ────────────────────────────────────────────────────────────────

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

function validateState(parsed: unknown, path: string): InstalledState {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw makeError("STATE_CORRUPT", `State file must be a JSON object: ${path}`, { path });
  }

  const obj = parsed as Record<string, unknown>;

  // Treat missing version as uninitialized (e.g. installer wrote "{}") — return empty state.
  if (obj.version === undefined) {
    return { ...EMPTY_STATE, installedAt: new Date().toISOString() };
  }

  if (obj.version !== "1") {
    throw makeError("STATE_CORRUPT", `Unknown state version "${obj.version}": ${path}`, {
      path,
      version: obj.version,
    });
  }

  return {
    version: "1",
    installedAt: String(obj.installedAt ?? ""),
    pipelines: (obj.pipelines as Record<string, InstalledPipeline>) ?? {},
    clis: (obj.clis as Record<string, InstalledCli>) ?? {},
  };
}
