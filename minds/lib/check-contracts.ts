#!/usr/bin/env bun
/**
 * check-contracts.ts — CLI wrapper for deterministic contract verification.
 *
 * Parses `produces:` and `consumes:` annotations from task descriptions,
 * then verifies the actual source files match the contract.
 *
 * Usage:
 *   bun check-contracts.ts --mind <mindName> --tasks <tasks-file-or-inline> --repo-root <path>
 *
 * Exit code 0 = all contracts verified
 * Exit code 1 = contract violations found (prints details)
 *
 * Annotation format (in task descriptions):
 *   produces: `functionName()` at path/to/file.ts
 *   consumes: `functionName()` from path/to/file.ts
 */

import { existsSync, readFileSync } from "fs";
import { parseAnnotations, verifyContracts } from "./check-contracts-core.ts";

// ── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const mindName = getArg("mind");
const tasksInput = getArg("tasks");
const repoRoot = getArg("repo-root") ?? process.cwd();

if (!mindName || !tasksInput) {
  console.error("Usage: bun check-contracts.ts --mind <name> --tasks <file-or-text> --repo-root <path>");
  process.exit(2);
}

// ── Main ────────────────────────────────────────────────────────────────────

// Load tasks text
let tasksText: string;
if (existsSync(tasksInput)) {
  tasksText = readFileSync(tasksInput, "utf-8");
} else {
  tasksText = tasksInput; // inline text
}

const annotations = parseAnnotations(tasksText, mindName);

if (annotations.length === 0) {
  console.log(`✅ No contract annotations found for @${mindName} — nothing to verify.`);
  process.exit(0);
}

console.log(`Checking ${annotations.length} contract annotation(s) for @${mindName}...\n`);

for (const ann of annotations) {
  console.log(`  ${ann.taskId} ${ann.type}: ${ann.interfaceName} ${ann.type === "produces" ? "at" : "from"} ${ann.filePath}`);
}
console.log();

const { pass, violations } = verifyContracts(annotations, repoRoot, mindName);

if (pass) {
  console.log(`✅ All ${annotations.length} contract(s) verified for @${mindName}.`);
  process.exit(0);
} else {
  console.log(`❌ ${violations.length} contract violation(s) found for @${mindName}:\n`);
  for (const v of violations) {
    console.log(`  ${v.annotation.taskId} [${v.annotation.type}] ${v.reason}`);
  }
  process.exit(1);
}
