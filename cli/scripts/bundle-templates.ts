#!/usr/bin/env bun
import { cpSync, mkdirSync, existsSync, rmSync, statSync, readdirSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";

// ---------------------------------------------------------------------------
// Pre-bundle validation: no bare /collab.X skill invocations in command files
// ---------------------------------------------------------------------------

const ALLOWED_PATTERNS = ["Read the file", "Do NOT invoke", "execute inline", "lint:ok"];

function findBareSkillInvocations(content: string, filePath: string): string[] {
  const errors: string[] = [];
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
    if (!inCodeBlock) continue;
    if (!/^\/collab\.\w+/.test(stripped)) continue;

    const context = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
    if (ALLOWED_PATTERNS.some((p) => context.includes(p))) continue;

    errors.push(
      `ERROR: ${filePath}:${i + 1}: "${stripped}" uses /collab.X as a Skill invocation.\n` +
      `  Replace with inline execution to avoid Skill tool response boundary.`
    );
  }
  return errors;
}

// Resolve collab root relative to this script
const SCRIPT_DIR = dirname(Bun.main);
const CLI_ROOT = join(SCRIPT_DIR, "..");
const COLLAB_ROOT = join(CLI_ROOT, "..");
const TEMPLATE_DIR = join(CLI_ROOT, "src", "templates");

// Pre-bundle validation
const commandsDir = join(COLLAB_ROOT, "src/commands");
const allErrors: string[] = [];
for (const file of readdirSync(commandsDir).filter((f) => f.endsWith(".md"))) {
  const content = readFileSync(join(commandsDir, file), "utf-8");
  allErrors.push(...findBareSkillInvocations(content, file));
}
if (allErrors.length > 0) {
  console.error("\n" + allErrors.join("\n"));
  process.exit(1);
}

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
  { from: "src/scripts/verify-and-complete.ts", to: "scripts/verify-and-complete.ts" },
  { from: "src/scripts/webhook-notify.sh", to: "scripts/webhook-notify.sh" },
  { from: "src/config", to: "config" },
  { from: "src/lib/pipeline", to: "lib-pipeline" },
  { from: "src/hooks", to: "hooks" },
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
