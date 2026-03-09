#!/usr/bin/env bun
/**
 * minds/setup.ts — One-time setup: create symlinks from minds/commands/*.md to ~/.claude/commands/
 *
 * Creates:
 *   ~/.claude/commands/minds.tasks.md     → minds/commands/tasks.md
 *   ~/.claude/commands/minds.implement.md → minds/commands/implement.md
 *   ~/.claude/commands/drone.launch.md    → minds/commands/drone.launch.md (if it exists)
 *
 * Idempotent: safe to run multiple times. Re-creates broken symlinks, skips valid ones.
 *
 * Usage:
 *   bun minds/setup.ts
 */

import { existsSync, mkdirSync, symlinkSync, unlinkSync, realpathSync, lstatSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
const commandsDir = join(process.env.HOME ?? "/root", ".claude", "commands");

// Mapping: target symlink name → source file (relative to repo root)
const LINKS: Array<{ name: string; source: string }> = [
  { name: "minds.tasks.md", source: "minds/commands/tasks.md" },
  { name: "minds.implement.md", source: "minds/commands/implement.md" },
  { name: "drone.launch.md", source: "minds/commands/drone.launch.md" },
];

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

// Ensure ~/.claude/commands/ exists
if (!existsSync(commandsDir)) {
  mkdirSync(commandsDir, { recursive: true });
  log(`created ${commandsDir}`);
}

let created = 0;
let skipped = 0;

for (const { name, source } of LINKS) {
  const absoluteSource = resolve(repoRoot, source);
  const linkPath = join(commandsDir, name);

  // Skip if source doesn't exist (e.g., drone.launch.md not created yet)
  if (!existsSync(absoluteSource)) {
    log(`skip  ${name} — source not found: ${absoluteSource}`);
    skipped++;
    continue;
  }

  // Check if symlink already exists and points to the right place
  if (existsSync(linkPath) || /* broken symlink */ (() => { try { lstatSync(linkPath); return true; } catch { return false; } })()) {
    let stat;
    try {
      stat = lstatSync(linkPath);
    } catch {
      stat = null;
    }

    if (stat?.isSymbolicLink()) {
      let current: string | null = null;
      try {
        current = realpathSync(linkPath);
      } catch {
        // broken symlink — remove and re-create
      }
      if (current === realpathSync(absoluteSource)) {
        log(`ok    ${name} → ${absoluteSource}`);
        skipped++;
        continue;
      }
      // Wrong target — remove and re-create
      unlinkSync(linkPath);
      log(`unlink ${name} (was pointing elsewhere)`);
    } else {
      log(`skip  ${name} — exists as non-symlink, not touching`);
      skipped++;
      continue;
    }
  }

  symlinkSync(absoluteSource, linkPath);
  log(`link  ${name} → ${absoluteSource}`);
  created++;
}

log(`\nDone: ${created} created, ${skipped} skipped.`);
