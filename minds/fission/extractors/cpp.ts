/**
 * cpp.ts — C/C++ include graph extractor.
 *
 * Parses #include directives via regex and resolves project-local
 * includes to file paths within the target codebase. No AST parser needed.
 *
 * Handles:
 * - #include "relative/path/file.h" (quoted include — project-local)
 * - #include <project/file.h> (angle-bracket — resolved against project dirs)
 * - System includes skipped only when they don't resolve to a project file
 * - Multiple resolution paths: includer dir, project root, include/, src/
 * - All C/C++ extensions: .cpp, .cc, .cxx, .c, .h, .hpp, .hxx
 * - Comment stripping (// and multi-line comments)
 * - Excluded directories: build/, cmake-build-*, third_party/, vendor/, etc.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx"];

const EXCLUDED_DIRS = new Set([
  "build",
  "cmake-build-debug",
  "cmake-build-release",
  "cmake-build-relwithdebinfo",
  "cmake-build-minsizerel",
  ".git",
  "node_modules",
  "third_party",
  "vendor",
  "external",
  "deps",
]);

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip C/C++ comments from source code to avoid parsing #include
 * directives that appear inside comments.
 *
 * Handles:
 * - Single-line comments: // ...
 * - Multi-line comments: /* ... (asterisk slash)
 * - String literals (to avoid stripping comments inside strings)
 */
function stripComments(source: string): string {
  // Match strings, single-line comments, and multi-line comments
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (match) => {
      // Preserve string literals
      if (match.startsWith('"') || match.startsWith("'")) {
        return match;
      }
      // Replace comments with equivalent whitespace (preserve line count)
      return match.replace(/[^\n]/g, " ");
    },
  );
}

// ---------------------------------------------------------------------------
// Include parsing
// ---------------------------------------------------------------------------

/** Quoted include: #include "path/to/file.h" */
const QUOTED_INCLUDE_RE = /^\s*#\s*include\s*"([^"]+)"/gm;

/** Angle-bracket include: #include <path/to/file.h> */
const ANGLE_INCLUDE_RE = /^\s*#\s*include\s*<([^>]+)>/gm;

interface ParsedInclude {
  path: string;
  /** "quoted" = #include "...", "angle" = #include <...> */
  kind: "quoted" | "angle";
}

/**
 * Parse all #include directives from source code.
 * Both quoted and angle-bracket includes are captured.
 * Angle-bracket includes are resolved against project dirs —
 * if they map to a real project file, they create edges.
 */
function parseIncludes(source: string): ParsedInclude[] {
  const stripped = stripComments(source);
  const includes: ParsedInclude[] = [];

  QUOTED_INCLUDE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUOTED_INCLUDE_RE.exec(stripped)) !== null) {
    includes.push({ path: match[1], kind: "quoted" });
  }

  ANGLE_INCLUDE_RE.lastIndex = 0;
  while ((match = ANGLE_INCLUDE_RE.exec(stripped)) !== null) {
    includes.push({ path: match[1], kind: "angle" });
  }

  return includes;
}

// ---------------------------------------------------------------------------
// Include resolution
// ---------------------------------------------------------------------------

/**
 * Try to resolve an include to a file within the project.
 *
 * For quoted includes (#include "..."):
 * 1. Relative to the directory containing the including file
 * 2. Relative to the project root
 * 3. Common include paths: include/, src/ (relative to project root)
 *
 * For angle-bracket includes (#include <...>):
 * Skip step 1 (not relative to includer), try project root + common paths.
 * This catches project headers used with angle brackets (e.g., <nlohmann/json.hpp>).
 *
 * Returns the absolute path if found, null otherwise.
 */
function resolveInclude(
  includePath: string,
  includerAbsPath: string,
  absRoot: string,
  kind: "quoted" | "angle",
): string | null {
  if (kind === "quoted") {
    // 1. Relative to includer's directory (quoted only)
    const includerDir = dirname(includerAbsPath);
    const relToIncluder = join(includerDir, includePath);
    if (existsSync(relToIncluder)) {
      return relToIncluder;
    }
  }

  // 2. Relative to project root
  const relToRoot = join(absRoot, includePath);
  if (existsSync(relToRoot)) {
    return relToRoot;
  }

  // 3. Common include paths
  const searchPaths = ["include", "src"];
  for (const searchDir of searchPaths) {
    const candidate = join(absRoot, searchDir, includePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Custom walk that handles cmake-build-* glob pattern
// ---------------------------------------------------------------------------

/**
 * Walk directory tree for C/C++ files, excluding cmake-build-* directories
 * and other excluded directories.
 */
function walkCppDir(absRoot: string): string[] {
  // We use the shared walkDir but with an augmented excluded set.
  // For cmake-build-* we need to pre-scan root and add matching dirs.
  const augmentedExcluded = new Set(EXCLUDED_DIRS);

  // Scan root level for cmake-build-* directories to add dynamically
  try {
    const entries = readdirSync(absRoot) as string[];
    for (const entry of entries) {
      if (entry.startsWith("cmake-build-")) {
        try {
          const full = join(absRoot, entry);
          if (statSync(full).isDirectory()) {
            augmentedExcluded.add(entry);
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip
  }

  return walkDir(absRoot, absRoot, {
    extensions: SOURCE_EXTENSIONS,
    excludedDirs: augmentedExcluded,
  });
}

// ---------------------------------------------------------------------------
// CppExtractor
// ---------------------------------------------------------------------------

export class CppExtractor implements Extractor {
  language = "cpp";
  extensions = [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // 1. Discover all source and header files
    const files = walkCppDir(absRoot);

    if (files.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Build a set of known project files for fast lookup
    const knownFiles = new Set(files);

    // 2. Parse each file and resolve includes
    const edgeMap = new Map<string, GraphEdge>();

    for (const relFile of files) {
      const absFile = join(absRoot, relFile);
      let source: string;
      try {
        source = readFileSync(absFile, "utf-8");
      } catch {
        continue;
      }

      const includes = parseIncludes(source);

      for (const { path: includePath, kind } of includes) {
        const resolved = resolveInclude(includePath, absFile, absRoot, kind);
        if (!resolved) continue;

        // Convert to relative path
        const relTarget = relative(absRoot, resolved);

        // Skip if target is outside the project root
        if (relTarget.startsWith("..") || relTarget.startsWith("/")) continue;

        // Skip if target is not a known project file (could be in excluded dir)
        if (!knownFiles.has(relTarget)) continue;

        // Skip self-references
        if (relTarget === relFile) continue;

        // Deduplicate edges
        const key = `${relFile}->${relTarget}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            from: relFile,
            to: relTarget,
            weight: 1,
          });
        }
      }
    }

    // 3. Build the graph
    const edges = Array.from(edgeMap.values());

    return { nodes: files, edges };
  }
}
