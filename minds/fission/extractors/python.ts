/**
 * python.ts — Python import graph extractor.
 *
 * Parses import/from-import statements via regex and resolves them
 * to file paths within the target codebase. No AST parser needed.
 *
 * Handles:
 * - import foo
 * - import foo.bar.baz
 * - from foo import bar, baz
 * - from foo.bar import baz
 * - from . import foo (relative)
 * - from .. import foo (parent relative)
 * - from .foo import bar (relative with module)
 * - from ...utils import helper (multi-level relative)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".py"];

const EXCLUDED_DIRS = new Set([
  "__pycache__",
  ".git",
  "venv",
  ".venv",
  "env",
  ".env",
  ".tox",
  "node_modules",
  "dist",
  "build",
  ".eggs",
]);

// ---------------------------------------------------------------------------
// Import statement regexes
// ---------------------------------------------------------------------------

/**
 * from <module> import <names>
 * Captures: group 1 = module path (may start with dots for relative, or a word for absolute),
 *           group 2 = imported names
 * Handles both:
 *   from myapp.models import User     (absolute)
 *   from .foo import bar              (relative)
 *   from ...utils import helper       (multi-level relative)
 *   from . import foo                 (current-package relative)
 */
const FROM_IMPORT_RE = /^from\s+(\.+\w*(?:\.\w+)*|\w+(?:\.\w+)*)\s+import\s+(.+)/;

/**
 * import <dotted.names> [, <dotted.names>]*
 * Only matches plain import (not from-import).
 */
const PLAIN_IMPORT_RE = /^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*$/;

// ---------------------------------------------------------------------------
// Triple-quote string stripping
// ---------------------------------------------------------------------------

/**
 * Remove triple-quoted strings to avoid matching imports inside docstrings.
 * Replaces content with spaces to preserve line structure.
 */
function stripTripleQuotes(source: string): string {
  return source.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

interface ParsedImport {
  /** The module specifier (e.g., "myapp.models", ".foo", "..config") */
  module: string;
  /** Number of dots for relative imports (0 = absolute) */
  dots: number;
  /** The module path after the dots (may be empty for "from . import X") */
  modulePath: string;
  /** Named imports (for from-import) */
  names: string[];
  /** Weight = number of named imports, minimum 1 */
  weight: number;
  /** Whether this is a from-import (true) or plain import (false) */
  isFromImport: boolean;
}

function parseImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const cleaned = stripTripleQuotes(source);
  const lines = cleaned.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("#")) continue;

    // Skip empty lines
    if (!trimmed) continue;

    // Try from-import first
    const fromMatch = FROM_IMPORT_RE.exec(trimmed);
    if (fromMatch) {
      const moduleStr = fromMatch[1]; // e.g., ".foo.bar" or "myapp.models"
      const namesStr = fromMatch[2];

      // Count leading dots
      let dots = 0;
      for (const ch of moduleStr) {
        if (ch === ".") dots++;
        else break;
      }

      const modulePath = moduleStr.slice(dots); // path after dots
      const names = namesStr
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0 && !n.startsWith("#"));

      imports.push({
        module: moduleStr,
        dots,
        modulePath,
        names,
        weight: Math.max(names.length, 1),
        isFromImport: true,
      });
      continue;
    }

    // Try plain import
    const plainMatch = PLAIN_IMPORT_RE.exec(trimmed);
    if (plainMatch) {
      const modules = plainMatch[1]
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0);

      for (const mod of modules) {
        imports.push({
          module: mod,
          dots: 0,
          modulePath: mod,
          names: [],
          weight: 1,
          isFromImport: false,
        });
      }
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Check if a top-level package exists as a directory in rootDir.
 * This filters out external/stdlib packages.
 */
function isLocalPackage(rootDir: string, topLevel: string): boolean {
  const candidate = join(rootDir, topLevel);
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists with an exact case-sensitive name match.
 * On case-insensitive filesystems (macOS), existsSync("User.py") matches "user.py".
 * This function verifies the actual directory entry matches.
 */
function existsCaseSensitive(filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  // Verify the final component matches exactly
  const dir = dirname(filePath);
  const base = filePath.slice(dir.length + 1);
  try {
    const entries = readdirSync(dir);
    return entries.includes(base);
  } catch {
    return false;
  }
}

/**
 * Try to resolve a dotted module path to a file.
 * e.g., "myapp.models.user" -> "myapp/models/user.py" or "myapp/models/user/__init__.py"
 */
function resolveModulePath(
  baseDir: string,
  modulePath: string,
): string | null {
  if (!modulePath) return null;

  const parts = modulePath.split(".");
  const fsPath = join(baseDir, ...parts);

  // Try as a .py file first
  const pyFile = fsPath + ".py";
  if (existsCaseSensitive(pyFile) && statSync(pyFile).isFile()) {
    return pyFile;
  }

  // Try as a package (__init__.py)
  const initFile = join(fsPath, "__init__.py");
  if (existsCaseSensitive(initFile) && statSync(initFile).isFile()) {
    return initFile;
  }

  return null;
}

/**
 * Resolve a relative import.
 * dots = number of leading dots
 * modulePath = path after the dots (may be empty)
 * names = imported names (for trying sub-module resolution)
 * fileDir = directory of the importing file
 * rootDir = project root
 */
function resolveRelativeImport(
  rootDir: string,
  fileDir: string,
  dots: number,
  modulePath: string,
  names: string[],
): string | null {
  // Each dot goes up one directory from the file's package.
  // The first dot means "current package" (the directory containing the file).
  // Two dots = parent package, etc.
  let baseDir = fileDir;
  for (let i = 1; i < dots; i++) {
    baseDir = dirname(baseDir);
  }

  // Check we haven't gone above root
  const relBase = relative(rootDir, baseDir);
  if (relBase.startsWith("..") || relBase.startsWith("/")) {
    return null;
  }

  if (modulePath) {
    // from .foo import bar / from ..config import X
    return resolveModulePath(baseDir, modulePath);
  }

  // from . import foo / from .. import foo
  // Try each named import as a module
  if (names.length > 0) {
    // Try the first name as a module reference
    const firstName = names[0];
    const pyFile = join(baseDir, firstName + ".py");
    if (existsSync(pyFile) && statSync(pyFile).isFile()) return pyFile;

    const initFile = join(baseDir, firstName, "__init__.py");
    if (existsSync(initFile) && statSync(initFile).isFile()) return initFile;
  }

  // Fall back to __init__.py of the base directory
  const initFallback = join(baseDir, "__init__.py");
  if (existsSync(initFallback) && statSync(initFallback).isFile()) {
    return initFallback;
  }

  return null;
}

/**
 * Resolve an absolute import.
 * For plain `import foo.bar.baz`: resolve the full dotted path.
 * For `from foo.bar import baz`: resolve foo.bar, trying baz as sub-module first.
 */
function resolveAbsoluteImport(
  rootDir: string,
  modulePath: string,
  names: string[],
  isFromImport: boolean,
): string | null {
  const parts = modulePath.split(".");
  const topLevel = parts[0];

  // Only resolve if the top-level is a local package
  if (!isLocalPackage(rootDir, topLevel)) {
    return null;
  }

  if (isFromImport) {
    // from foo.bar import baz
    // Strategy: if a named import resolves as a sub-module, use that.
    // Otherwise fall back to the module path itself (__init__.py or .py).
    if (names.length > 0) {
      const firstName = names[0];
      const subModulePath = modulePath + "." + firstName;
      const subResolved = resolveModulePath(rootDir, subModulePath);
      if (subResolved) return subResolved;
    }

    // Fall back: resolve module path itself
    return resolveModulePath(rootDir, modulePath);
  }

  // Plain import: import foo.bar.baz
  return resolveModulePath(rootDir, modulePath);
}

// ---------------------------------------------------------------------------
// PythonExtractor
// ---------------------------------------------------------------------------

export class PythonExtractor implements Extractor {
  language = "python";
  extensions = [".py"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // 1. Discover all .py files
    const files = walkDir(absRoot, absRoot, {
      extensions: [".py"],
      excludedDirs: EXCLUDED_DIRS,
    });

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

      const parsed = parseImports(source);
      const fileDir = dirname(absFile);

      for (const imp of parsed) {
        let resolved: string | null = null;

        if (imp.dots > 0) {
          // Relative import
          resolved = resolveRelativeImport(
            absRoot,
            fileDir,
            imp.dots,
            imp.modulePath,
            imp.names,
          );
        } else {
          // Absolute import
          resolved = resolveAbsoluteImport(
            absRoot,
            imp.modulePath,
            imp.names,
            imp.isFromImport,
          );
        }

        if (!resolved) continue;

        // Convert to relative path
        const relTarget = relative(absRoot, resolved);

        // Skip if outside root
        if (relTarget.startsWith("..") || relTarget.startsWith("/")) continue;

        // Skip excluded directories
        const topDir = relTarget.split("/")[0];
        if (EXCLUDED_DIRS.has(topDir)) continue;

        // Skip self-imports
        if (relFile === relTarget) continue;

        // Deduplicate edges, keeping highest weight
        const key = `${relFile}->${relTarget}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight = Math.max(existing.weight, imp.weight);
        } else {
          edgeMap.set(key, {
            from: relFile,
            to: relTarget,
            weight: imp.weight,
          });
        }
      }
    }

    // 3. Build the graph
    const edges = Array.from(edgeMap.values());

    return {
      nodes: files,
      edges,
    };
  }
}
