#!/usr/bin/env bun
/**
 * resolve-feature.ts — Resolve feature paths from git branch and specs/ directory.
 *
 * Replaces: check-prerequisites.sh, setup-plan.sh, common.sh
 *
 * Usage:
 *   bun src/scripts/resolve-feature.ts [TICKET_ID] [--require-tasks] [--include-tasks] [--setup-plan]
 *
 * Output: JSON to stdout
 */

import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";
import { findFeatureDir } from "../lib/pipeline/utils";

// --- Argument parsing ---
const argv = process.argv.slice(2);
const args = new Set(argv);
const requireTasks = args.has("--require-tasks");
const includeTasks = args.has("--include-tasks");
const setupPlan = args.has("--setup-plan");
// Positional ticket ID: first arg matching ABC-123 pattern
const positionalTicketId = argv.find(a => /^[A-Z]+-\d+$/.test(a)) ?? "";

function fail(message: string): never {
  process.stderr.write(JSON.stringify({ error: message }) + "\n");
  process.exit(1);
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

// --- 1. REPO_ROOT ---
let repoRoot = exec("git rev-parse --show-toplevel");
if (!repoRoot) {
  // Fallback: script location ../../..
  repoRoot = join(__dirname, "..", "..");
}

// --- 2. BRANCH ---
let branch = process.env.SPECIFY_FEATURE || "";
if (!branch) {
  branch = exec("git rev-parse --abbrev-ref HEAD");
}
if (!branch) {
  // Non-git fallback: find highest-numbered spec dir
  const specsDir = join(repoRoot, "specs");
  if (existsSync(specsDir)) {
    let highest = 0;
    let latestFeature = "";
    for (const entry of readdirSync(specsDir)) {
      const m = entry.match(/^(\d{3})-/);
      if (m && statSync(join(specsDir, entry)).isDirectory()) {
        const num = parseInt(m[1], 10);
        if (num > highest) {
          highest = num;
          latestFeature = entry;
        }
      }
    }
    branch = latestFeature || "main";
  } else {
    branch = "main";
  }
}

// --- 3. Extract numeric prefix or ticket ID ---
const specsDir = join(repoRoot, "specs");
const prefixMatch = branch.match(/^(\d{3})-/);
// Match ticket ID patterns: ABC-123, BRE-418, PROJ-1234 (at start of branch name)
const ticketMatch = !prefixMatch ? branch.match(/^([A-Z]+-\d+)/) : null;

if (!prefixMatch && !ticketMatch && !positionalTicketId) {
  fail(`Not on a feature branch. Current branch: ${branch}\nFeature branches should be named like: 001-feature-name or BRE-123-description`);
}

// --- 4. Find FEATURE_DIR ---
let featureDir: string;

// Use positional arg, branch ticket match, or prefix — in that order
const lookupId = positionalTicketId || (prefixMatch ? prefixMatch[1] : ticketMatch![1]);
const resolved = findFeatureDir(repoRoot, lookupId, { branch });
const fallback = positionalTicketId ? join(specsDir, positionalTicketId) : join(specsDir, branch);
featureDir = resolved ?? fallback;

// --- 5. Derive paths ---
const featureSpec = join(featureDir, "spec.md");
const implPlan = join(featureDir, "plan.md");
const tasks = join(featureDir, "tasks.md");

// --- 6. Validation ---
// Auto-create specs/{TICKET_ID}/ when positional ticket ID is provided and dir doesn't exist
if (positionalTicketId && !existsSync(featureDir)) {
  mkdirSync(featureDir, { recursive: true });
}

if (!setupPlan && !existsSync(featureDir)) {
  // Print sentinel to stdout and exit 0 so callers can check output without it looking like a failure.
  // Only use exit 1 for actual errors (e.g., invalid ticket ID format, which fails earlier via fail()).
  process.stdout.write("NO_FEATURE_DIR\n");
  process.exit(0);
}

if (requireTasks && !existsSync(tasks)) {
  fail(`tasks.md not found in ${featureDir}\nRun /collab.tasks first to create the task list.`);
}

// --- 7. --setup-plan: create dir + copy template ---
if (setupPlan) {
  if (!existsSync(featureDir)) {
    mkdirSync(featureDir, { recursive: true });
  }
  const template = join(repoRoot, ".specify", "templates", "plan-template.md");
  if (!existsSync(implPlan)) {
    if (existsSync(template)) {
      copyFileSync(template, implPlan);
    } else {
      // Create empty plan file
      Bun.write(implPlan, "");
    }
  }
}

// --- 8. Build AVAILABLE_DOCS ---
const availableDocs: string[] = [];
const checkFiles: [string, string][] = [
  [join(featureDir, "research.md"), "research.md"],
  [join(featureDir, "data-model.md"), "data-model.md"],
];

for (const [path, name] of checkFiles) {
  if (existsSync(path)) availableDocs.push(name);
}

// contracts/ — only if non-empty directory
const contractsDir = join(featureDir, "contracts");
if (existsSync(contractsDir) && statSync(contractsDir).isDirectory()) {
  const entries = readdirSync(contractsDir);
  if (entries.length > 0) availableDocs.push("contracts/");
}

if (existsSync(join(featureDir, "quickstart.md"))) {
  availableDocs.push("quickstart.md");
}

if (includeTasks && existsSync(tasks)) {
  availableDocs.push("tasks.md");
}

// --- 9. Resolve TICKET_ID from metadata.json ---
let ticketId = positionalTicketId;
const metadataPath = join(featureDir, "metadata.json");
if (existsSync(metadataPath)) {
  try {
    const meta = JSON.parse(readFileSync(metadataPath, "utf-8"));
    ticketId = meta.ticket_id ?? ticketId;
  } catch {
    // non-fatal — ticketId stays as positionalTicketId or empty
  }
}

// --- 10. Output JSON ---
const output = {
  REPO_ROOT: repoRoot,
  BRANCH: branch,
  FEATURE_DIR: featureDir,
  FEATURE_SPEC: featureSpec,
  IMPL_PLAN: implPlan,
  TASKS: tasks,
  AVAILABLE_DOCS: availableDocs,
  TICKET_ID: ticketId,
};

console.log(JSON.stringify(output));
