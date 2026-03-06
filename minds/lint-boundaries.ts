#!/usr/bin/env bun

/**
 * minds/lint-boundaries.ts — Architectural boundary linter for the Minds system.
 *
 * Scans all .ts files in each minds/{name}/ directory and flags any import
 * that crosses a Mind boundary without explicit authorization.
 *
 * ALLOWED:
 *   - Imports within the same Mind (relative paths not crossing a boundary)
 *   - Imports from minds/ top-level files (mind.ts, server-base.ts, etc.)
 *   - Imports annotated with "// CROSS-MIND" (temporary exceptions until Wave E Router)
 *
 * VIOLATIONS:
 *   - Any import from another minds/{name}/ directory without // CROSS-MIND annotation
 *
 * Usage:
 *   bun minds/lint-boundaries.ts [--json]
 *
 * Exit codes:
 *   0 = clean (no violations)
 *   1 = violations found
 */

import * as fs from "fs";
import * as path from "path";

interface Violation {
  file: string;
  line: number;
  importPath: string;
  fromMind: string;
  toMind: string;
}

interface CrossMindAnnotation {
  file: string;
  line: number;
  importPath: string;
  fromMind: string;
  toMind: string;
}

const MINDS_DIR = path.join(import.meta.dir);
const REPO_ROOT = path.join(MINDS_DIR, "..");

// Directories that are NOT Minds — either shared infrastructure or templates.
// Imports TO these from any Mind are allowed (no boundary enforcement needed).
// Files IN these directories are not subject to boundary scanning.
const NON_MIND_DIRS = new Set([
  "shared",     // shared utilities intentionally imported by multiple Minds
  "templates",  // template files for distribution (not runtime Mind code)
  "fixtures",   // test fixtures (shared test infrastructure)
  "integrations", // cross-mind integration tests
  "lib",        // older shared lib directory
]);

// Mind names: each subdirectory in minds/ that is an actual Mind
function getMinds(): string[] {
  return fs
    .readdirSync(MINDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith(".") && name !== "node_modules" && !NON_MIND_DIRS.has(name));
}

// Recursively collect all .ts files under a directory
function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTs(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

// Extract all import statements from a TypeScript file
// Returns: { importPath: string, lineNo: number, annotated: boolean }[]
function extractImports(
  content: string
): { importPath: string; lineNo: number; annotated: boolean }[] {
  const lines = content.split("\n");
  const imports: { importPath: string; lineNo: number; annotated: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: import ... from "path" or require("path")
    const staticMatch =
      line.match(/^\s*(?:import|export)\s+.*?from\s+["']([^"']+)["']/) ||
      line.match(/^\s*(?:import|export)\s+["']([^"']+)["']/);
    const requireMatch = line.match(/\brequire\(["']([^"']+)["']\)/);

    const match = staticMatch || requireMatch;
    if (match) {
      const importPath = match[1];
      const annotated = line.includes("// CROSS-MIND");
      imports.push({ importPath, lineNo: i + 1, annotated });
    }
  }

  return imports;
}

// Resolve an import path relative to the source file → absolute path
function resolveImportPath(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) return null; // package import, skip
  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importPath);
  // Normalize: strip trailing .js or .ts extension for comparison
  resolved = resolved.replace(/\.(js|ts)$/, "");
  return resolved;
}

// Which Mind does an absolute path belong to? Returns null if not in a tracked Mind.
function mindOf(absolutePath: string): string | null {
  const rel = path.relative(MINDS_DIR, absolutePath);
  const parts = rel.split(path.sep);
  if (parts.length >= 2 && !parts[0].startsWith(".")) {
    const dir = parts[0];
    // Non-Mind directories are not subject to boundary enforcement
    if (NON_MIND_DIRS.has(dir)) return null;
    return dir;
  }
  return null; // minds/ top-level file or outside minds/
}

function main(): void {
  const jsonMode = process.argv.includes("--json");
  const minds = getMinds();
  const violations: Violation[] = [];
  const crossMindAnnotations: CrossMindAnnotation[] = [];

  for (const mindName of minds) {
    const mindDir = path.join(MINDS_DIR, mindName);
    const files = collectTs(mindDir);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const imports = extractImports(content);

      for (const { importPath, lineNo, annotated } of imports) {
        const resolved = resolveImportPath(file, importPath);
        if (!resolved) continue;

        const targetMind = mindOf(resolved);
        if (!targetMind) continue; // minds/ top-level or outside — OK

        if (targetMind === mindName) continue; // same Mind — OK

        // Cross-Mind import found
        if (annotated) {
          crossMindAnnotations.push({
            file: path.relative(REPO_ROOT, file),
            line: lineNo,
            importPath,
            fromMind: mindName,
            toMind: targetMind,
          });
        } else {
          violations.push({
            file: path.relative(REPO_ROOT, file),
            line: lineNo,
            importPath,
            fromMind: mindName,
            toMind: targetMind,
          });
        }
      }
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ violations, crossMindAnnotations }, null, 2));
  } else {
    if (violations.length > 0) {
      console.error(`\n❌ Boundary violations found (${violations.length}):\n`);
      for (const v of violations) {
        console.error(
          `  ${v.file}:${v.line}\n` +
            `    Import: "${v.importPath}"\n` +
            `    Crosses: ${v.fromMind} → ${v.toMind}\n` +
            `    Fix: Add "// CROSS-MIND" annotation (temporary until Wave E Router)\n`
        );
      }
    }

    if (crossMindAnnotations.length > 0) {
      console.log(
        `\n⚠️  Authorized cross-Mind imports (${crossMindAnnotations.length}) — remove when Wave E Router ships:\n`
      );
      for (const a of crossMindAnnotations) {
        console.log(`  ${a.file}:${a.line}  (${a.fromMind} → ${a.toMind})`);
      }
    }

    if (violations.length === 0) {
      console.log(`\n✅ No boundary violations across ${minds.length} Minds.\n`);
    }
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

main();
