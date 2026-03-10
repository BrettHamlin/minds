/**
 * go.ts — Go import graph extractor.
 *
 * Parses Go import statements via regex and resolves internal imports
 * using the module path from go.mod. No AST parser needed.
 *
 * Handles:
 * - import "pkg" (single import)
 * - import ( ... ) (grouped imports)
 * - Module-relative internal imports (resolved via go.mod module path)
 * - Standard library filtering (no dots in path = stdlib)
 * - External dependency filtering (module prefix mismatch)
 * - _test.go file exclusion
 * - vendor/, testdata/, .git/ directory exclusion
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set(["vendor", "testdata", ".git", "node_modules"]);

// ---------------------------------------------------------------------------
// Import statement regexes
// ---------------------------------------------------------------------------

/** Single import: import "pkg/path" */
const SINGLE_IMPORT_RE = /import\s+"([^"]+)"/g;

/** Grouped import block: import ( ... ) */
const GROUPED_IMPORT_RE = /import\s*\(([\s\S]*?)\)/g;

/** Individual import line within a grouped block: "pkg/path" */
const IMPORT_LINE_RE = /"([^"]+)"/g;

/** Module path from go.mod: module github.com/user/project */
const MODULE_RE = /^module\s+(\S+)/m;

// ---------------------------------------------------------------------------
// go.mod parsing
// ---------------------------------------------------------------------------

function readModulePath(rootDir: string): string | null {
  const goModPath = join(rootDir, "go.mod");
  if (!existsSync(goModPath)) return null;

  try {
    const content = readFileSync(goModPath, "utf-8");
    const match = MODULE_RE.exec(content);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

function parseImports(source: string): string[] {
  const imports: string[] = [];

  // First, extract all grouped import blocks and collect their import paths.
  // Track positions of grouped blocks so we can exclude them from single-import matching.
  const groupedRanges: [number, number][] = [];

  GROUPED_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = GROUPED_IMPORT_RE.exec(source)) !== null) {
    groupedRanges.push([match.index, match.index + match[0].length]);
    const block = match[1];
    IMPORT_LINE_RE.lastIndex = 0;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = IMPORT_LINE_RE.exec(block)) !== null) {
      imports.push(lineMatch[1]);
    }
  }

  // Then find single imports that are NOT inside grouped blocks
  SINGLE_IMPORT_RE.lastIndex = 0;
  while ((match = SINGLE_IMPORT_RE.exec(source)) !== null) {
    const pos = match.index;
    const inGrouped = groupedRanges.some(
      ([start, end]) => pos >= start && pos < end,
    );
    if (!inGrouped) {
      imports.push(match[1]);
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Import classification
// ---------------------------------------------------------------------------

/**
 * Determine if an import path is internal (belongs to this module).
 * Internal imports start with the module path prefix.
 */
function isInternalImport(importPath: string, modulePath: string): boolean {
  return (
    importPath === modulePath || importPath.startsWith(modulePath + "/")
  );
}

/**
 * Resolve an internal import path to a directory relative to rootDir.
 * E.g., "github.com/user/project/internal/auth" with module "github.com/user/project"
 * → "internal/auth"
 */
function resolveInternalImport(
  importPath: string,
  modulePath: string,
): string {
  if (importPath === modulePath) return ".";
  return importPath.slice(modulePath.length + 1);
}

/**
 * Find all .go files (excluding _test.go) in a directory.
 */
function goFilesInDir(absDir: string, rootDir: string): string[] {
  if (!existsSync(absDir)) return [];
  let stat;
  try {
    stat = statSync(absDir);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (
      entry.endsWith(".go") &&
      !entry.endsWith("_test.go")
    ) {
      const fullPath = join(absDir, entry);
      try {
        if (statSync(fullPath).isFile()) {
          results.push(relative(rootDir, fullPath));
        }
      } catch {
        // skip
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// GoExtractor
// ---------------------------------------------------------------------------

export class GoExtractor implements Extractor {
  language = "go";
  extensions = [".go"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);
    const modulePath = readModulePath(absRoot);

    // 1. Discover all source files
    const files = walkDir(absRoot, absRoot, {
      extensions: [".go"],
      excludedDirs: EXCLUDED_DIRS,
      fileFilter: (f) => !f.endsWith("_test.go"),
    });

    // If no go.mod, we can still list files but cannot resolve internal imports
    if (!modulePath) {
      return { nodes: files, edges: [] };
    }

    // 2. Parse each file and resolve imports
    const edgeMap = new Map<string, GraphEdge>();

    for (const relFile of files) {
      const absFile = join(absRoot, relFile);
      let source: string;
      try {
        source = readFileSync(absFile, "utf-8");
      } catch {
        continue;
      }

      const importPaths = parseImports(source);

      for (const importPath of importPaths) {
        // Skip non-internal imports
        if (!isInternalImport(importPath, modulePath)) continue;

        // Resolve to relative directory
        const relDir = resolveInternalImport(importPath, modulePath);
        const absDir = join(absRoot, relDir);

        // Find all .go files in the target package directory
        const targetFiles = goFilesInDir(absDir, absRoot);

        for (const targetFile of targetFiles) {
          // Skip self-references
          if (targetFile === relFile) continue;

          const key = `${relFile}->${targetFile}`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, {
              from: relFile,
              to: targetFile,
              weight: 1,
            });
          }
        }
      }
    }

    // 3. Build the graph
    const edges = Array.from(edgeMap.values());

    return { nodes: files, edges };
  }
}
