#!/usr/bin/env bun
/**
 * check-contracts.ts — Deterministic contract verification for Mind review loop.
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
import { resolve } from "path";

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

// ── Parse annotations from task descriptions ────────────────────────────────

interface ContractAnnotation {
  type: "produces" | "consumes";
  interfaceName: string; // e.g. "serializeEventForSSE()" or "MindsBusMessage"
  filePath: string;      // e.g. ".minds/transport/minds-events.ts"
  taskId: string;        // e.g. "T001"
}

function parseAnnotations(tasksText: string, forMind: string): ContractAnnotation[] {
  const annotations: ContractAnnotation[] = [];
  const lines = tasksText.split("\n");

  for (const line of lines) {
    // Only process task lines for this mind
    const taskMatch = line.match(/^-\s*\[.\]\s*(T\d+)\s+@(\w+)/);
    if (!taskMatch) continue;

    const [, taskId, taskMind] = taskMatch;
    if (taskMind !== forMind) continue;

    // Parse produces: annotations
    const producesMatch = line.match(/produces:\s*`([^`]+)`\s+at\s+(\S+)/);
    if (producesMatch) {
      annotations.push({
        type: "produces",
        interfaceName: producesMatch[1].replace(/[()]/g, ""), // strip parens
        filePath: producesMatch[2],
        taskId,
      });
    }

    // Parse consumes: annotations
    const consumesMatch = line.match(/consumes:\s*`([^`]+)`\s+from\s+(\S+)/);
    if (consumesMatch) {
      annotations.push({
        type: "consumes",
        interfaceName: consumesMatch[1].replace(/[()]/g, ""), // strip parens
        filePath: consumesMatch[2],
        taskId,
      });
    }
  }

  return annotations;
}

// ── Verify contracts ────────────────────────────────────────────────────────

interface Violation {
  annotation: ContractAnnotation;
  reason: string;
}

function resolveFilePath(filePath: string, root: string): string {
  // Handle .minds/ vs minds/ — check both
  const direct = resolve(root, filePath);
  if (existsSync(direct)) return direct;

  // Try swapping .minds/ ↔ minds/
  if (filePath.startsWith(".minds/")) {
    const alt = resolve(root, filePath.replace(/^\.minds\//, "minds/"));
    if (existsSync(alt)) return alt;
  } else if (filePath.startsWith("minds/")) {
    const alt = resolve(root, filePath.replace(/^minds\//, ".minds/"));
    if (existsSync(alt)) return alt;
  }

  return direct; // return original path even if not found
}

function verifyContracts(annotations: ContractAnnotation[], root: string): Violation[] {
  const violations: Violation[] = [];

  // Find all files owned by this mind (for consumes: checking local reimplementation)
  // We check all .ts files in the mind's directory

  for (const ann of annotations) {
    if (ann.type === "produces") {
      // Verify the interface is exported at the declared path
      const fullPath = resolveFilePath(ann.filePath, root);
      if (!existsSync(fullPath)) {
        violations.push({
          annotation: ann,
          reason: `File does not exist: ${ann.filePath}`,
        });
        continue;
      }

      const content = readFileSync(fullPath, "utf-8");
      // Check for export of the interface name
      const exportPatterns = [
        new RegExp(`export\\s+function\\s+${escapeRegExp(ann.interfaceName)}\\b`),
        new RegExp(`export\\s+const\\s+${escapeRegExp(ann.interfaceName)}\\b`),
        new RegExp(`export\\s+type\\s+${escapeRegExp(ann.interfaceName)}\\b`),
        new RegExp(`export\\s+interface\\s+${escapeRegExp(ann.interfaceName)}\\b`),
        new RegExp(`export\\s+class\\s+${escapeRegExp(ann.interfaceName)}\\b`),
        new RegExp(`export\\s+enum\\s+${escapeRegExp(ann.interfaceName)}\\b`),
        new RegExp(`export\\s*\\{[^}]*\\b${escapeRegExp(ann.interfaceName)}\\b[^}]*\\}`),
      ];

      const isExported = exportPatterns.some((p) => p.test(content));
      if (!isExported) {
        violations.push({
          annotation: ann,
          reason: `'${ann.interfaceName}' is NOT exported from ${ann.filePath}`,
        });
      }
    } else if (ann.type === "consumes") {
      // For consumes: check that this mind's files import from the declared path,
      // and do NOT define/export the interface locally.

      // Find the consuming mind's source files (check BOTH .minds/ and minds/)
      const mindDir1 = resolve(root, ".minds", mindName);
      const mindDir2 = resolve(root, "minds", mindName);
      const searchDirs: string[] = [];
      if (existsSync(mindDir1)) searchDirs.push(mindDir1);
      if (existsSync(mindDir2)) searchDirs.push(mindDir2);

      if (searchDirs.length === 0) {
        violations.push({
          annotation: ann,
          reason: `Mind directory not found for @${mindName}`,
        });
        continue;
      }

      // Scan all .ts files in both directories, deduplicate by basename
      const tsFiles = [...new Set(searchDirs.flatMap((d) => findTsFiles(d)))];
      let foundLocalDef = false;
      let localDefFile = "";

      for (const tsFile of tsFiles) {
        // Skip test files for local def check
        if (tsFile.includes("__tests__") || tsFile.includes(".test.")) continue;

        const content = readFileSync(tsFile, "utf-8");
        const localDefPatterns = [
          new RegExp(`export\\s+function\\s+${escapeRegExp(ann.interfaceName)}\\b`),
          new RegExp(`export\\s+const\\s+${escapeRegExp(ann.interfaceName)}\\b`),
          new RegExp(`function\\s+${escapeRegExp(ann.interfaceName)}\\s*\\(`),
        ];

        if (localDefPatterns.some((p) => p.test(content))) {
          foundLocalDef = true;
          localDefFile = tsFile.replace(root + "/", "");
          break;
        }
      }

      if (foundLocalDef) {
        violations.push({
          annotation: ann,
          reason: `CONTRACT VIOLATION: '${ann.interfaceName}' is defined locally in ${localDefFile} — must be imported from ${ann.filePath}`,
        });
      }

      // Also check that at least one file imports it from the correct source
      let foundImport = false;
      const importSourceBase = ann.filePath
        .replace(/^\.?minds\//, "")  // strip minds/ or .minds/
        .replace(/\.ts$/, "");       // strip .ts extension

      for (const tsFile of tsFiles) {
        if (tsFile.includes("__tests__") || tsFile.includes(".test.")) continue;
        const content = readFileSync(tsFile, "utf-8");

        // Check for import from the expected path (various alias formats)
        const importPatterns = [
          new RegExp(`import\\s*\\{[^}]*\\b${escapeRegExp(ann.interfaceName)}\\b[^}]*\\}\\s*from`),
          new RegExp(`import\\s+type\\s*\\{[^}]*\\b${escapeRegExp(ann.interfaceName)}\\b[^}]*\\}\\s*from`),
        ];

        if (importPatterns.some((p) => p.test(content))) {
          foundImport = true;
          break;
        }
      }

      if (!foundImport && !foundLocalDef) {
        violations.push({
          annotation: ann,
          reason: `'${ann.interfaceName}' is not imported anywhere in @${mindName}'s source files`,
        });
      }
    }
  }

  return violations;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = require("fs").readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        results.push(...findTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or can't be read
  }
  return results;
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

const violations = verifyContracts(annotations, repoRoot);

if (violations.length === 0) {
  console.log(`✅ All ${annotations.length} contract(s) verified for @${mindName}.`);
  process.exit(0);
} else {
  console.log(`❌ ${violations.length} contract violation(s) found for @${mindName}:\n`);
  for (const v of violations) {
    console.log(`  ${v.annotation.taskId} [${v.annotation.type}] ${v.reason}`);
  }
  process.exit(1);
}
