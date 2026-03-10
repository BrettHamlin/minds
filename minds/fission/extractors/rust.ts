/**
 * rust.ts — Rust module/import graph extractor.
 *
 * Parses `use`, `mod`, and `pub use` statements via regex and resolves them
 * to file paths within the target crate. No AST parser needed.
 *
 * Handles:
 * - use crate::foo::bar;           (crate-relative)
 * - use crate::foo::{bar, baz};    (grouped)
 * - use super::foo;                (parent module)
 * - use self::foo;                 (current module)
 * - mod foo;                       (module declaration)
 * - use crate::foo::bar::*;        (glob)
 * - pub use crate::foo::bar;       (re-export)
 * - use crate::foo::bar as alias;  (aliased)
 *
 * Skips external crate imports (std::, serde::, tokio::, etc.)
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set([
  "target",
  "node_modules",
  ".git",
  "dist",
  "build",
]);

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip line comments (//) and block comments from Rust source.
 * Basic heuristic — does not handle comments inside string literals,
 * but sufficient for import extraction.
 */
function stripComments(source: string): string {
  // Remove block comments (non-greedy, handles multiline)
  let result = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  result = result.replace(/\/\/.*$/gm, "");
  return result;
}

// ---------------------------------------------------------------------------
// Module path resolution
// ---------------------------------------------------------------------------

/**
 * Given a module path (segments like ["foo", "bar"]) relative to a crate's
 * src directory, resolve to the .rs file path.
 *
 * Tries: src/foo/bar.rs then src/foo/bar/mod.rs
 */
function resolveModulePath(
  crateSrcDir: string,
  segments: string[],
): string | null {
  if (segments.length === 0) return null;

  // Try as file: src/seg1/seg2/.../segN.rs
  const filePath = join(crateSrcDir, ...segments) + ".rs";
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }

  // Try as directory module: src/seg1/seg2/.../segN/mod.rs
  const modPath = join(crateSrcDir, ...segments, "mod.rs");
  if (existsSync(modPath) && statSync(modPath).isFile()) {
    return modPath;
  }

  return null;
}

/**
 * Resolve a `mod foo;` declaration from a given file.
 *
 * If the declaring file is src/lib.rs or src/main.rs:
 *   -> src/foo.rs or src/foo/mod.rs
 *
 * If the declaring file is src/bar.rs:
 *   -> src/bar/foo.rs or src/bar/foo/mod.rs
 *
 * If the declaring file is src/bar/mod.rs:
 *   -> src/bar/foo.rs or src/bar/foo/mod.rs
 */
function resolveModDeclaration(
  declaringFile: string,
  modName: string,
  crateSrcDir: string,
): string | null {
  const absDeclaringFile = resolve(declaringFile);
  const absSrcDir = resolve(crateSrcDir);
  const declaringDir = dirname(absDeclaringFile);
  const declaringBasename = absDeclaringFile.slice(
    absDeclaringFile.lastIndexOf("/") + 1,
  );

  let searchDir: string;

  if (
    declaringBasename === "lib.rs" ||
    declaringBasename === "main.rs" ||
    declaringBasename === "mod.rs"
  ) {
    // Module is a sibling or child of this directory
    searchDir = declaringDir;
  } else {
    // e.g., src/foo.rs declaring `mod bar;` -> look in src/foo/bar.rs
    const stem = declaringBasename.replace(/\.rs$/, "");
    searchDir = join(declaringDir, stem);
  }

  // Try file: searchDir/modName.rs
  const filePath = join(searchDir, modName + ".rs");
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }

  // Try directory module: searchDir/modName/mod.rs
  const dirModPath = join(searchDir, modName, "mod.rs");
  if (existsSync(dirModPath) && statSync(dirModPath).isFile()) {
    return dirModPath;
  }

  return null;
}

/**
 * Given a file path, determine its module path segments relative to the
 * crate src directory.
 *
 * src/lib.rs       -> []  (crate root)
 * src/main.rs      -> []  (crate root)
 * src/foo.rs       -> ["foo"]
 * src/foo/mod.rs   -> ["foo"]
 * src/foo/bar.rs   -> ["foo", "bar"]
 */
function fileToModuleSegments(
  filePath: string,
  crateSrcDir: string,
): string[] {
  const absFile = resolve(filePath);
  const absSrc = resolve(crateSrcDir);
  const rel = relative(absSrc, absFile);

  // Split path and remove .rs extension
  const parts = rel.replace(/\.rs$/, "").split("/");

  // Remove trailing "mod" (directory modules)
  if (parts[parts.length - 1] === "mod") {
    parts.pop();
  }

  // Remove "lib" or "main" (crate root)
  if (parts.length === 1 && (parts[0] === "lib" || parts[0] === "main")) {
    return [];
  }

  return parts;
}

/**
 * Resolve `use super::path` from a given file.
 *
 * `super` refers to the parent module.
 */
function resolveSuperPath(
  filePath: string,
  crateSrcDir: string,
  pathAfterSuper: string[],
): string | null {
  const mySegments = fileToModuleSegments(filePath, crateSrcDir);

  if (mySegments.length === 0) {
    // Already at crate root; super makes no sense but we handle gracefully
    return null;
  }

  // Parent module segments = my segments minus last one
  const parentSegments = mySegments.slice(0, -1);

  if (pathAfterSuper.length === 0) {
    // `use super;` — resolve to parent module file
    if (parentSegments.length === 0) {
      // Parent is crate root
      const libPath = join(crateSrcDir, "lib.rs");
      if (existsSync(libPath)) return libPath;
      const mainPath = join(crateSrcDir, "main.rs");
      if (existsSync(mainPath)) return mainPath;
      return null;
    }
    return resolveModulePath(crateSrcDir, parentSegments);
  }

  // `use super::foo::bar` — resolve from parent module
  // The first segment after super could be a sibling module or a symbol
  // Try to resolve as a module path from the parent
  const targetSegments = [...parentSegments, ...pathAfterSuper];
  const resolved = resolveModulePath(crateSrcDir, targetSegments);
  if (resolved) return resolved;

  // If we can't resolve with all segments, try with fewer
  // (remaining segments might be symbols, not modules)
  for (let i = pathAfterSuper.length - 1; i >= 0; i--) {
    const trySegments = [...parentSegments, ...pathAfterSuper.slice(0, i)];
    if (trySegments.length === 0) {
      // Points to crate root
      const libPath = join(crateSrcDir, "lib.rs");
      if (existsSync(libPath)) return libPath;
      const mainPath = join(crateSrcDir, "main.rs");
      if (existsSync(mainPath)) return mainPath;
    } else {
      const resolved = resolveModulePath(crateSrcDir, trySegments);
      if (resolved) return resolved;
    }
  }

  return null;
}

/**
 * Resolve `use self::path` from a given file.
 *
 * `self` refers to the current module.
 */
function resolveSelfPath(
  filePath: string,
  crateSrcDir: string,
  pathAfterSelf: string[],
): string | null {
  const mySegments = fileToModuleSegments(filePath, crateSrcDir);

  if (pathAfterSelf.length === 0) return null;

  const targetSegments = [...mySegments, ...pathAfterSelf];
  const resolved = resolveModulePath(crateSrcDir, targetSegments);
  if (resolved) return resolved;

  // Try with fewer segments (remaining might be symbols)
  for (let i = pathAfterSelf.length - 1; i > 0; i--) {
    const trySegments = [...mySegments, ...pathAfterSelf.slice(0, i)];
    const resolved = resolveModulePath(crateSrcDir, trySegments);
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Resolve `use crate::path` from a given crate's src directory.
 */
function resolveCratePath(
  crateSrcDir: string,
  pathSegments: string[],
): string | null {
  if (pathSegments.length === 0) return null;

  const resolved = resolveModulePath(crateSrcDir, pathSegments);
  if (resolved) return resolved;

  // Try with fewer segments (trailing segments might be symbols)
  for (let i = pathSegments.length - 1; i > 0; i--) {
    const trySegments = pathSegments.slice(0, i);
    const resolved = resolveModulePath(crateSrcDir, trySegments);
    if (resolved) return resolved;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

interface ParsedRustImport {
  kind: "crate" | "super" | "self" | "mod";
  /** Module path segments after the prefix (crate/super/self) */
  pathSegments: string[];
  /** Number of named items (for weight calculation) */
  namedCount: number;
}

/**
 * Parse a path string that may contain grouped items {a, b, c},
 * glob *, or alias (as X).
 *
 * Returns the module path segments and the count of named items.
 */
function parseUsePath(rawPath: string): { segments: string[]; count: number } {
  let path = rawPath.trim();

  // Remove trailing semicolons
  path = path.replace(/;$/, "").trim();

  // Check for grouped use: foo::bar::{a, b, c}
  const groupMatch = path.match(/^(.*)::\{([^}]+)\}$/);
  if (groupMatch) {
    const prefix = groupMatch[1].trim();
    const items = groupMatch[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const segments = prefix.split("::").map((s) => s.trim());
    return { segments, count: items.length };
  }

  // Check for glob: foo::bar::*
  if (path.endsWith("::*")) {
    const prefix = path.slice(0, -3);
    const segments = prefix.split("::").map((s) => s.trim());
    return { segments, count: 1 };
  }

  // Check for alias: foo::bar as Baz
  const aliasMatch = path.match(/^(.+?)\s+as\s+\w+$/);
  if (aliasMatch) {
    const actualPath = aliasMatch[1].trim();
    const segments = actualPath.split("::").map((s) => s.trim());
    return { segments, count: 1 };
  }

  // Simple path: foo::bar::baz
  const segments = path.split("::").map((s) => s.trim());
  return { segments, count: 1 };
}

/** Match `mod foo;` declarations (not inline `mod foo { ... }`) */
const MOD_DECL_RE = /\bmod\s+(\w+)\s*;/g;

/** Match `use (pub)? crate::...;` */
const USE_CRATE_RE = /\buse\s+(?:pub\s+)?crate::([^;]+);/g;

/** Match `use (pub)? super::...;` */
const USE_SUPER_RE = /\buse\s+(?:pub\s+)?super::([^;]+);/g;

/** Match `use (pub)? self::...;` */
const USE_SELF_RE = /\buse\s+(?:pub\s+)?self::([^;]+);/g;

function parseRustImports(source: string): ParsedRustImport[] {
  const cleaned = stripComments(source);
  const imports: ParsedRustImport[] = [];

  // mod foo;
  let match: RegExpExecArray | null;
  MOD_DECL_RE.lastIndex = 0;
  while ((match = MOD_DECL_RE.exec(cleaned)) !== null) {
    imports.push({
      kind: "mod",
      pathSegments: [match[1]],
      namedCount: 1,
    });
  }

  // use crate::...
  USE_CRATE_RE.lastIndex = 0;
  while ((match = USE_CRATE_RE.exec(cleaned)) !== null) {
    const { segments, count } = parseUsePath(match[1]);
    imports.push({
      kind: "crate",
      pathSegments: segments,
      namedCount: count,
    });
  }

  // use super::...
  USE_SUPER_RE.lastIndex = 0;
  while ((match = USE_SUPER_RE.exec(cleaned)) !== null) {
    const { segments, count } = parseUsePath(match[1]);
    imports.push({
      kind: "super",
      pathSegments: segments,
      namedCount: count,
    });
  }

  // use self::...
  USE_SELF_RE.lastIndex = 0;
  while ((match = USE_SELF_RE.exec(cleaned)) !== null) {
    const { segments, count } = parseUsePath(match[1]);
    imports.push({
      kind: "self",
      pathSegments: segments,
      namedCount: count,
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Cargo.toml parsing
// ---------------------------------------------------------------------------

interface CrateInfo {
  /** Root directory of the crate (contains Cargo.toml) */
  rootDir: string;
  /** src directory of the crate */
  srcDir: string;
  /** Crate root file (lib.rs or main.rs) */
  crateRoot: string | null;
}

/**
 * Parse a Cargo.toml to determine if it's a workspace or single crate.
 * Returns the list of crate source directories to process.
 */
function parseCargo(rootDir: string): CrateInfo[] {
  const cargoPath = join(rootDir, "Cargo.toml");
  if (!existsSync(cargoPath)) return [];

  let content: string;
  try {
    content = readFileSync(cargoPath, "utf-8");
  } catch {
    return [];
  }

  // Check for workspace
  if (content.includes("[workspace]")) {
    // Parse workspace members (basic TOML parsing)
    const membersMatch = content.match(
      /members\s*=\s*\[([^\]]*)\]/,
    );
    if (membersMatch) {
      const membersStr = membersMatch[1];
      const members = membersStr
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);

      const crates: CrateInfo[] = [];
      for (const member of members) {
        const memberDir = join(rootDir, member);
        const srcDir = join(memberDir, "src");
        if (!existsSync(srcDir)) continue;

        const libRs = join(srcDir, "lib.rs");
        const mainRs = join(srcDir, "main.rs");
        const crateRoot = existsSync(libRs)
          ? libRs
          : existsSync(mainRs)
            ? mainRs
            : null;

        crates.push({ rootDir: memberDir, srcDir, crateRoot });
      }
      return crates;
    }
  }

  // Single crate
  const srcDir = join(rootDir, "src");
  if (!existsSync(srcDir)) return [];

  const libRs = join(srcDir, "lib.rs");
  const mainRs = join(srcDir, "main.rs");
  const crateRoot = existsSync(libRs)
    ? libRs
    : existsSync(mainRs)
      ? mainRs
      : null;

  return [{ rootDir, srcDir, crateRoot }];
}

// ---------------------------------------------------------------------------
// RustExtractor
// ---------------------------------------------------------------------------

export class RustExtractor implements Extractor {
  language = "rust";
  extensions = [".rs"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // Parse Cargo.toml to find crate(s)
    const crates = parseCargo(absRoot);
    if (crates.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Discover all .rs files
    const files = walkDir(absRoot, absRoot, {
      extensions: [".rs"],
      excludedDirs: EXCLUDED_DIRS,
    });

    if (files.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Process each file for imports
    const edgeMap = new Map<string, GraphEdge>();

    for (const relFile of files) {
      const absFile = join(absRoot, relFile);
      let source: string;
      try {
        source = readFileSync(absFile, "utf-8");
      } catch {
        continue;
      }

      // Determine which crate this file belongs to
      const crate = crates.find((c) => absFile.startsWith(resolve(c.srcDir)));
      if (!crate) continue;

      const parsed = parseRustImports(source);

      for (const imp of parsed) {
        let resolvedAbs: string | null = null;

        switch (imp.kind) {
          case "mod":
            resolvedAbs = resolveModDeclaration(
              absFile,
              imp.pathSegments[0],
              crate.srcDir,
            );
            break;

          case "crate":
            resolvedAbs = resolveCratePath(crate.srcDir, imp.pathSegments);
            break;

          case "super":
            resolvedAbs = resolveSuperPath(
              absFile,
              crate.srcDir,
              imp.pathSegments,
            );
            break;

          case "self":
            resolvedAbs = resolveSelfPath(
              absFile,
              crate.srcDir,
              imp.pathSegments,
            );
            break;
        }

        if (!resolvedAbs) continue;

        const relTarget = relative(absRoot, resolvedAbs);

        // Skip if outside root or in excluded dirs
        if (relTarget.startsWith("..") || relTarget.startsWith("/")) continue;
        if (
          relTarget.startsWith("target/") ||
          relTarget.startsWith("node_modules/") ||
          relTarget.startsWith(".git/")
        )
          continue;

        // Deduplicate edges, keeping max weight
        const key = `${relFile}->${relTarget}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight = Math.max(existing.weight, imp.namedCount);
        } else {
          edgeMap.set(key, {
            from: relFile,
            to: relTarget,
            weight: imp.namedCount,
          });
        }
      }
    }

    return {
      nodes: files,
      edges: Array.from(edgeMap.values()),
    };
  }
}
