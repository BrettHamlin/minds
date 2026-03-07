/**
 * generate-registry.ts — CLI script to generate .collab/minds.json.
 *
 * Spawns all child Mind servers, calls describe() on each via MCP,
 * collects their MindDescription objects, writes them as a JSON array
 * to the output path, then shuts down all child processes.
 *
 * Usage: bun minds/generate-registry.ts [--output path/to/minds.json]
 */

import { resolve } from "path";
import { writeFileSync, renameSync } from "fs";
import { findChildServerFiles, spawnChild, callDescribe } from "./discovery.js";
import type { MindDescription } from "./mind.js";

// Detect repo root
const gitProc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe" });
const repoRoot = new TextDecoder().decode(gitProc.stdout).trim();

// Parse --output arg
const args = process.argv.slice(2);
const outputFlagIdx = args.indexOf("--output");
const outputPath =
  outputFlagIdx !== -1 && args[outputFlagIdx + 1]
    ? resolve(args[outputFlagIdx + 1])
    : resolve(repoRoot, ".collab/minds.json");

// Find child server files, excluding the router itself
const selfPath = resolve(import.meta.dir, "router/server.ts");
const childFiles = findChildServerFiles(repoRoot).filter((p) => resolve(p) !== selfPath);

// Spawn each child, call describe(), collect descriptions
const descriptions: MindDescription[] = [];
const procs: Array<ReturnType<typeof Bun.spawn>> = [];

for (const serverPath of childFiles) {
  let spawned: Awaited<ReturnType<typeof spawnChild>>;
  try {
    spawned = await spawnChild(serverPath);
  } catch (err) {
    console.warn(`[generate-registry] WARNING: Failed to start ${serverPath}:`, err);
    continue;
  }

  procs.push(spawned.proc);

  try {
    descriptions.push(await callDescribe(spawned.port));
  } catch (err) {
    console.warn(`[generate-registry] WARNING: Failed to describe port ${spawned.port}:`, err);
    spawned.proc.kill();
  }
}

// Shutdown all children
for (const proc of procs) proc.kill();

// Exit 1 if nothing found
if (descriptions.length === 0) {
  console.error("[generate-registry] No Minds discovered.");
  process.exit(1);
}

// Atomic write
const tmpPath = `${outputPath}.tmp`;
writeFileSync(tmpPath, JSON.stringify(descriptions, null, 2) + "\n");
renameSync(tmpPath, outputPath);

console.error(`[generate-registry] Discovered ${descriptions.length} Minds → ${outputPath}`);
