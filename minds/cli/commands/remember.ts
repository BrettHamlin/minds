/**
 * remember.ts — Append a learning entry to a Mind's MEMORY.md.
 *
 * Works in the target repo context — writes to .minds/<mind>/memory/MEMORY.md.
 * Creates the directory and file if they don't exist.
 *
 * Usage: bun minds/cli/bin/minds.ts remember <mind-name> "<entry>"
 *   or:  bun .minds/cli/bin/minds.ts remember <mind-name> --file <path>
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getRepoRoot, resolveMindsDir } from "../../shared/paths.js";
import { loadWorkspace } from "../../shared/workspace-loader.ts";

export async function runRemember(
  mindName: string,
  options: { entry?: string; file?: string },
): Promise<void> {
  const repoRoot = getRepoRoot();
  const workspace = loadWorkspace(repoRoot);
  const mindsDir = resolveMindsDir(workspace.orchestratorRoot);

  // Resolve the content
  let content: string;
  if (options.file) {
    if (!existsSync(options.file)) {
      console.error(`Error: file not found: ${options.file}`);
      process.exit(1);
    }
    content = readFileSync(options.file, "utf-8").trim();
  } else if (options.entry) {
    content = options.entry.trim();
  } else {
    console.error("Error: provide an entry as an argument or --file <path>");
    process.exit(1);
  }

  // Guard against empty content
  if (!content) {
    console.error("Error: entry content is empty");
    process.exit(1);
  }

  // Validate mind exists in registry (warn but continue)
  const mindsJsonPath = join(mindsDir, "minds.json");
  if (existsSync(mindsJsonPath)) {
    try {
      const registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8"));
      if (Array.isArray(registry)) {
        const exists = registry.some((m: { name: string }) => m.name === mindName);
        if (!exists) {
          console.warn(`Warning: @${mindName} not found in registry. Writing anyway.`);
        }
      }
    } catch {
      console.warn("Warning: could not parse minds.json. Writing anyway.");
    }
  }

  // Ensure memory directory exists
  const memoryDir = join(mindsDir, mindName, "memory");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  // Append to MEMORY.md (create if needed)
  const memoryPath = join(memoryDir, "MEMORY.md");
  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, `# @${mindName} Memory\n\n`);
  }

  const existing = readFileSync(memoryPath, "utf-8");

  // If today's heading already exists, append under it; otherwise create new heading
  const todayHeading = `## ${today}`;
  let entry: string;
  if (existing.includes(todayHeading)) {
    entry = `\n${content}\n`;
  } else {
    entry = `\n${todayHeading}\n\n${content}\n`;
  }

  writeFileSync(memoryPath, existing + entry);

  console.log(`Appended to @${mindName} MEMORY.md`);
  console.log(`  Path: ${memoryPath}`);
  console.log(`  Entry: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);
}
