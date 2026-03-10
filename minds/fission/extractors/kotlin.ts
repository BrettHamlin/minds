/**
 * kotlin.ts — Kotlin/KotlinScript import graph extractor.
 *
 * Parses package declarations, class/interface/object/enum declarations,
 * and import statements via regex to build a dependency graph.
 *
 * Resolution approach:
 * 1. Walk rootDir for .kt and .kts files (skip excluded dirs)
 * 2. Build package->files map from package declarations
 * 3. Build fully-qualified-class->file map from declarations
 * 4. Resolve import statements against internal maps
 *
 * Handles:
 * - import com.example.Foo — fully qualified import
 * - import com.example.* — wildcard import (edges to all files in package)
 * - package com.example.feature — package declaration
 * - class, interface, object, enum class, sealed class, data class,
 *   value class, annotation class declarations
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".kt", ".kts"];

const EXCLUDED_DIRS = new Set([
  "build",
  ".gradle",
  ".git",
  "node_modules",
  "out",
]);

/** Stdlib prefixes — imports starting with these are always external. */
const EXTERNAL_PREFIXES = ["kotlin.", "kotlinx.", "java.", "javax."];

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/** Package declaration: package com.example.feature */
const PACKAGE_RE = /^package\s+([\w.]+)/m;

/** Import statement: import com.example.Foo or import com.example.* */
const IMPORT_RE = /^import\s+([\w]+(?:\.[\w]+)*(?:\.\*)?)/gm;

/**
 * Class-like declarations.
 * Matches: class, interface, object, enum class, sealed class, data class,
 * value class, annotation class — followed by identifier.
 */
const DECLARATION_RE =
  /(?:^|\s)(?:(?:data|sealed|value|annotation|enum)\s+)?(?:class|interface|object)\s+(\w+)/gm;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parsePackage(source: string): string | null {
  const match = source.match(PACKAGE_RE);
  return match ? match[1] : null;
}

function parseDeclarations(source: string): string[] {
  const names: string[] = [];
  DECLARATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARATION_RE.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function parseImports(source: string): string[] {
  const imports: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function isExternalImport(importPath: string): boolean {
  return EXTERNAL_PREFIXES.some((prefix) => importPath.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// KotlinExtractor
// ---------------------------------------------------------------------------

export class KotlinExtractor implements Extractor {
  language = "kotlin";
  extensions = [".kt", ".kts"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // Phase 0: Discover all source files
    const files = walkDir(absRoot, absRoot, {
      extensions: SOURCE_EXTENSIONS,
      excludedDirs: EXCLUDED_DIRS,
    });

    if (files.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Phase 1: Build package->files map and read sources
    const packageToFiles = new Map<string, string[]>();
    const filePackages = new Map<string, string | null>();
    const fileSources = new Map<string, string>();

    for (const relFile of files) {
      const absFile = join(absRoot, relFile);
      let source: string;
      try {
        source = readFileSync(absFile, "utf-8");
      } catch {
        continue;
      }

      fileSources.set(relFile, source);
      const pkg = parsePackage(source);
      filePackages.set(relFile, pkg);

      if (pkg) {
        const existing = packageToFiles.get(pkg) ?? [];
        existing.push(relFile);
        packageToFiles.set(pkg, existing);
      }
    }

    // Phase 2: Build fully-qualified-class->file map
    const classToFile = new Map<string, string>();

    for (const relFile of files) {
      const source = fileSources.get(relFile);
      if (!source) continue;

      const pkg = filePackages.get(relFile);
      const declarations = parseDeclarations(source);

      for (const decl of declarations) {
        const fqn = pkg ? `${pkg}.${decl}` : decl;
        // First file wins (Kotlin enforces one public class per file for top-level,
        // but multiple classes in same file is valid)
        if (!classToFile.has(fqn)) {
          classToFile.set(fqn, relFile);
        }
      }
    }

    // Phase 3: Resolve imports
    const edgeMap = new Map<string, GraphEdge>();

    for (const relFile of files) {
      const source = fileSources.get(relFile);
      if (!source) continue;

      const imports = parseImports(source);

      for (const importPath of imports) {
        // Skip external imports
        if (isExternalImport(importPath)) continue;

        if (importPath.endsWith(".*")) {
          // Wildcard import: find all files in that package
          const pkg = importPath.slice(0, -2);
          const pkgFiles = packageToFiles.get(pkg);
          if (!pkgFiles) continue;

          for (const targetFile of pkgFiles) {
            // Skip self-edges
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
        } else {
          // Fully qualified import: look up in class map
          const targetFile = classToFile.get(importPath);
          if (!targetFile) continue;

          // Skip self-edges
          if (targetFile === relFile) continue;

          const key = `${relFile}->${targetFile}`;
          const existing = edgeMap.get(key);
          if (existing) {
            existing.weight += 1;
          } else {
            edgeMap.set(key, {
              from: relFile,
              to: targetFile,
              weight: 1,
            });
          }
        }
      }
    }

    return {
      nodes: files,
      edges: Array.from(edgeMap.values()),
    };
  }
}
