#!/usr/bin/env bun
import { cpSync, mkdirSync, existsSync, rmSync, statSync } from "fs";
import { join, dirname, basename } from "path";

// Resolve collab root relative to this script
const SCRIPT_DIR = dirname(Bun.main);
const CLI_ROOT = join(SCRIPT_DIR, "..");
const COLLAB_ROOT = join(CLI_ROOT, "..");
const TEMPLATE_DIR = join(CLI_ROOT, "src", "templates");

// Clean existing templates
if (existsSync(TEMPLATE_DIR)) {
  rmSync(TEMPLATE_DIR, { recursive: true });
}

const copies: Array<{ from: string; to: string; filter?: (name: string) => boolean }> = [
  { from: "src/commands", to: "commands" },
  { from: "src/skills", to: "skills" },
  { from: "src/handlers", to: "handlers" },
  {
    from: "src/scripts/orchestrator",
    to: "orchestrator",
    filter: (name: string) => !name.endsWith(".test.ts")
  },
  { from: "src/scripts/verify-and-complete.sh", to: "scripts/verify-and-complete.sh" },
  { from: "src/scripts/webhook-notify.sh", to: "scripts/webhook-notify.sh" },
  { from: "src/config", to: "config" },
  { from: "src/lib/pipeline", to: "lib-pipeline" },
  { from: ".specify/scripts", to: "specify-scripts" },
  { from: ".specify/templates", to: "specify-templates" },
  { from: "src/claude-settings.json", to: "claude-settings.json" },
];

for (const { from, to, filter } of copies) {
  const src = join(COLLAB_ROOT, from);
  const dest = join(TEMPLATE_DIR, to);
  if (existsSync(src)) {
    const isFile = statSync(src).isFile();
    if (isFile) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
    } else {
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, {
        recursive: true,
        filter: filter ? (source: string) => {
          const name = basename(source);
          // Always allow directories
          if (statSync(source).isDirectory()) return true;
          return filter(name);
        } : undefined
      });
    }
    console.log(`✓ ${from} → templates/${to}`);
  } else {
    console.log(`⚠ ${from} not found, skipping`);
  }
}

console.log("\nTemplate bundling complete.");
