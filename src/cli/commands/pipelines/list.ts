/**
 * collab pipelines list — list installed pipelines with versions
 * Composes state.ts only.
 */

import { readState, listPipelineNames } from "../../lib/state.js";
import { printError } from "../../types/index.js";
import type { InstalledState } from "../../types/index.js";

export interface ListOptions {
  statePath?: string;
  json?: boolean;
}

const DEFAULT_STATE_PATH = ".collab/state/installed-pipelines.json";

export async function list(options: ListOptions = {}): Promise<void> {
  const statePath = options.statePath ?? DEFAULT_STATE_PATH;

  let state: InstalledState;
  try {
    state = readState(statePath);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(state.pipelines, null, 2));
    return;
  }

  const names = listPipelineNames(state);

  if (names.length === 0) {
    console.log("No pipelines installed.");
    console.log("\nBrowse available: collab pipelines");
    console.log("Install one:      collab pipelines install <name>");
    return;
  }

  console.log("\nInstalled Pipelines");
  console.log("───────────────────");
  for (const name of names) {
    const entry = state.pipelines[name];
    const requiredBy =
      entry.requiredBy.length > 0 && entry.requiredBy[0] !== "direct"
        ? ` (required by: ${entry.requiredBy.join(", ")})`
        : "";
    console.log(`  ${name.padEnd(24)} v${entry.version.padEnd(12)} installed ${formatDate(entry.installedAt)}${requiredBy}`);
  }

  if (Object.keys(state.clis).length > 0) {
    console.log("\nTracked CLI Dependencies");
    console.log("────────────────────────");
    for (const [name, cli] of Object.entries(state.clis)) {
      console.log(`  ${name.padEnd(24)} v${cli.version}`);
    }
  }

  console.log(`\n${names.length} pipeline(s) installed.`);
  console.log("Check for updates: collab pipelines update");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

