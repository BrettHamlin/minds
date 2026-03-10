/**
 * typescript.ts — TypeScript/JavaScript import graph extractor.
 *
 * Parses import/require/export statements via regex and resolves them
 * to file paths within the target codebase. No AST parser needed.
 *
 * Handles:
 * - import { x } from './foo'
 * - import './foo' (side-effect)
 * - require('./foo')
 * - export { x } from './foo'
 * - import('./foo') (dynamic)
 * - NodeNext .js → .ts resolution
 * - tsconfig.json path aliases and baseUrl
 * - Barrel index.ts resolution
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve, relative, dirname, extname } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
]);

// ---------------------------------------------------------------------------
// Import statement regexes
// ---------------------------------------------------------------------------

/** import { a, b } from '...' or import x from '...' or import type { } from '...' */
const IMPORT_FROM_RE =
  /import\s+(?:type\s+)?(?:\{([^}]*)\}|(\*\s+as\s+\w+)|\w+(?:\s*,\s*\{([^}]*)\})?)\s+from\s+['"]([^'"]+)['"]/g;

/** import '...' (side-effect) */
const SIDE_EFFECT_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;

/** require('...') */
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** export { a, b } from '...' */
const EXPORT_FROM_RE =
  /export\s+(?:type\s+)?(?:\{([^}]*)\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/g;

/** Dynamic import('...') — capture the specifier */
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// ---------------------------------------------------------------------------
// tsconfig path alias resolution
// ---------------------------------------------------------------------------

interface TsConfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

function loadTsConfigPaths(rootDir: string): TsConfigPaths | null {
  const tsConfigPath = join(rootDir, "tsconfig.json");
  if (!existsSync(tsConfigPath)) return null;

  try {
    const raw = readFileSync(tsConfigPath, "utf-8");
    const parsed = JSON.parse(raw);
    const compilerOptions = parsed.compilerOptions ?? {};
    const baseUrl = compilerOptions.baseUrl ?? ".";
    const paths = compilerOptions.paths ?? {};

    if (Object.keys(paths).length === 0) return null;

    return { baseUrl, paths };
  } catch {
    return null;
  }
}

function resolveAlias(
  specifier: string,
  tsConfig: TsConfigPaths,
  rootDir: string,
): string | null {
  for (const [pattern, mappings] of Object.entries(tsConfig.paths)) {
    if (pattern.endsWith("/*")) {
      // Wildcard alias: @utils/* → src/utils/*
      const prefix = pattern.slice(0, -2);
      if (specifier.startsWith(prefix + "/")) {
        const rest = specifier.slice(prefix.length + 1);
        for (const mapping of mappings) {
          const mappingPrefix = mapping.slice(0, -2); // remove /*
          const resolved = join(
            rootDir,
            tsConfig.baseUrl,
            mappingPrefix,
            rest,
          );
          const file = tryResolveFile(resolved);
          if (file) return file;
        }
      }
    } else {
      // Exact alias: @config → src/config.ts
      if (specifier === pattern) {
        for (const mapping of mappings) {
          const resolved = join(rootDir, tsConfig.baseUrl, mapping);
          // The mapping might include extension already
          if (existsSync(resolved)) return resolved;
          // Try without extension
          const file = tryResolveFile(
            resolved.replace(/\.[^.]+$/, ""),
          );
          if (file) return file;
          // Also try as-is with extension resolution
          const file2 = tryResolveFile(resolved);
          if (file2) return file2;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

/**
 * Try to resolve a path to an actual file by appending extensions
 * or looking for index files.
 */
function tryResolveFile(basePath: string): string | null {
  // Direct match (path already has extension)
  if (existsSync(basePath) && statSync(basePath).isFile()) {
    return basePath;
  }

  // Try each extension
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = basePath + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // Try index file in directory
  if (existsSync(basePath) && statSync(basePath).isDirectory()) {
    for (const ext of [".ts", ".js"]) {
      const indexPath = join(basePath, "index" + ext);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  // NodeNext: .js → .ts, .jsx → .tsx
  const ext = extname(basePath);
  if (ext === ".js") {
    const tsPath = basePath.slice(0, -3) + ".ts";
    if (existsSync(tsPath) && statSync(tsPath).isFile()) return tsPath;
    const tsxPath = basePath.slice(0, -3) + ".tsx";
    if (existsSync(tsxPath) && statSync(tsxPath).isFile()) return tsxPath;
  }
  if (ext === ".jsx") {
    const tsxPath = basePath.slice(0, -4) + ".tsx";
    if (existsSync(tsxPath) && statSync(tsxPath).isFile()) return tsxPath;
  }

  return null;
}

function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

interface ParsedImport {
  specifier: string;
  namedCount: number;
}

function countNames(namesStr: string): number {
  if (!namesStr) return 0;
  return namesStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

function parseImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];

  // import { a, b } from '...' / import x from '...' / import * as x from '...'
  let match: RegExpExecArray | null;

  // Reset all regex lastIndex
  IMPORT_FROM_RE.lastIndex = 0;
  while ((match = IMPORT_FROM_RE.exec(source)) !== null) {
    const namedImports = match[1]; // { a, b }
    const starImport = match[2]; // * as x
    const mixedNamed = match[3]; // import x, { a, b }
    const specifier = match[4];

    let count = 1;
    if (namedImports) {
      count = countNames(namedImports);
    } else if (mixedNamed) {
      count = countNames(mixedNamed) + 1; // +1 for default
    } else if (starImport) {
      count = 1;
    }

    imports.push({ specifier, namedCount: Math.max(count, 1) });
  }

  // Side-effect imports: import '...'
  // Need to exclude matches already caught by IMPORT_FROM_RE
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((match = SIDE_EFFECT_IMPORT_RE.exec(source)) !== null) {
    const specifier = match[1];
    // Verify this isn't a "from" import by checking surrounding context
    const before = source.slice(Math.max(0, match.index - 50), match.index);
    if (!before.includes("from")) {
      // Also exclude if this specifier was already captured
      if (!imports.some((i) => i.specifier === specifier)) {
        imports.push({ specifier, namedCount: 1 });
      }
    }
  }

  // require('...')
  REQUIRE_RE.lastIndex = 0;
  while ((match = REQUIRE_RE.exec(source)) !== null) {
    imports.push({ specifier: match[1], namedCount: 1 });
  }

  // export { a, b } from '...'
  EXPORT_FROM_RE.lastIndex = 0;
  while ((match = EXPORT_FROM_RE.exec(source)) !== null) {
    const names = match[1];
    const specifier = match[2];
    const count = names ? countNames(names) : 1;
    imports.push({ specifier, namedCount: Math.max(count, 1) });
  }

  // Dynamic import('...')
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((match = DYNAMIC_IMPORT_RE.exec(source)) !== null) {
    const specifier = match[1];
    // Skip if already captured by IMPORT_FROM_RE
    if (!imports.some((i) => i.specifier === specifier)) {
      imports.push({ specifier, namedCount: 1 });
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// TypeScriptExtractor
// ---------------------------------------------------------------------------

export class TypeScriptExtractor implements Extractor {
  language = "typescript";
  extensions = [".ts", ".tsx", ".js", ".jsx"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);
    const tsConfig = loadTsConfigPaths(absRoot);

    // 1. Discover all source files
    const files = walkDir(absRoot, absRoot, {
      extensions: SOURCE_EXTENSIONS,
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

      for (const { specifier, namedCount } of parsed) {
        let resolved: string | null = null;

        if (isRelativeImport(specifier)) {
          // Resolve relative to the importing file's directory
          const absTarget = resolve(dirname(absFile), specifier);
          resolved = tryResolveFile(absTarget);
        } else if (isBareSpecifier(specifier) && tsConfig) {
          // Try tsconfig path alias
          resolved = resolveAlias(specifier, tsConfig, absRoot);
        }

        // Skip unresolved (external modules, etc.)
        if (!resolved) continue;

        // Convert to relative path
        const relTarget = relative(absRoot, resolved);

        // Skip if target is outside the root or in excluded dirs
        if (relTarget.startsWith("..") || relTarget.startsWith("/")) continue;
        if (
          relTarget.startsWith("node_modules/") ||
          relTarget.startsWith("dist/") ||
          relTarget.startsWith("build/")
        )
          continue;

        // Deduplicate edges (same from→to), keeping highest weight
        const key = `${relFile}->${relTarget}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight = Math.max(existing.weight, namedCount);
        } else {
          edgeMap.set(key, {
            from: relFile,
            to: relTarget,
            weight: namedCount,
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
