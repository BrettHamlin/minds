/**
 * java.ts — Java import graph extractor.
 *
 * Parses package declarations, class/interface/enum/record/@interface
 * declarations, and import statements via regex to build a dependency graph.
 *
 * Resolution approach:
 * 1. Walk rootDir for .java files (skip excluded dirs)
 * 2. Build package->files map from package declarations
 * 3. Build fully-qualified-class->file map from type declarations
 * 4. Resolve import statements against internal maps
 *
 * Handles:
 * - import com.example.Foo;                — single class import
 * - import com.example.*;                  — wildcard import (edges to all files in package)
 * - import static com.example.Foo.BAR;     — static import (resolve Foo class)
 * - package com.example.feature;           — package declaration
 * - class, interface, enum, record, @interface declarations
 * - abstract, final, sealed modifiers
 *
 * Skips: java.*, javax.*, sun.*, com.sun.* (JDK stdlib)
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set([
  "build",
  "target",
  ".gradle",
  ".git",
  "node_modules",
  "out",
  "bin",
  ".idea",
]);

/** JDK stdlib prefixes -- imports starting with these are always external. */
const EXTERNAL_PREFIXES = ["java.", "javax.", "sun.", "com.sun."];

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/** Package declaration: package com.example.feature; */
const PACKAGE_RE = /^package\s+([\w.]+)\s*;/m;

/** Standard import: import com.example.Foo; or import com.example.*; */
const IMPORT_RE = /^import\s+([\w]+(?:\.[\w]+)*(?:\.\*)?)\s*;/gm;

/** Static import: import static com.example.Foo.BAR; or import static com.example.Foo.*; */
const STATIC_IMPORT_RE = /^import\s+static\s+([\w]+(?:\.[\w]+)*(?:\.\*)?)\s*;/gm;

/**
 * Type declarations.
 * Matches: class, interface, enum, record, @interface
 * With optional modifiers: public, protected, private, abstract, final, sealed
 */
const DECLARATION_RE =
  /(?:^|\s)(?:(?:public|protected|private)\s+)?(?:(?:abstract|final|sealed)\s+)?(?:class|interface|enum|record|@interface)\s+(\w+)/gm;

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
    // Skip lines that are actually static imports (IMPORT_RE also matches them)
    // We handle static imports separately
    imports.push(match[1]);
  }
  return imports;
}

function parseStaticImports(source: string): string[] {
  const imports: string[] = [];
  STATIC_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STATIC_IMPORT_RE.exec(source)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function isExternalImport(importPath: string): boolean {
  return EXTERNAL_PREFIXES.some((prefix) => importPath.startsWith(prefix));
}

/**
 * For a static import like "com.example.Foo.BAR", extract the class FQN
 * by dropping the last segment (the member name).
 *
 * For "com.example.Foo.*", extract "com.example.Foo".
 */
function staticImportToClassFqn(staticPath: string): string {
  if (staticPath.endsWith(".*")) {
    // import static com.example.Foo.* -> class is com.example.Foo
    return staticPath.slice(0, -2);
  }
  // import static com.example.Foo.BAR -> class is com.example.Foo
  const lastDot = staticPath.lastIndexOf(".");
  if (lastDot === -1) return staticPath;
  return staticPath.substring(0, lastDot);
}

// ---------------------------------------------------------------------------
// JavaExtractor
// ---------------------------------------------------------------------------

export class JavaExtractor implements Extractor {
  language = "java";
  extensions = [".java"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // Phase 0: Discover all source files
    const files = walkDir(absRoot, absRoot, {
      extensions: [".java"],
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
        // First file wins (Java allows multiple non-public classes in one file)
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

      // Process standard imports
      const imports = parseImports(source);
      // Get static imports separately to avoid double-counting
      const staticImports = parseStaticImports(source);
      // The IMPORT_RE also captures "import static ..." lines because
      // "import static com.foo.Bar.BAZ;" matches "import static" then the path.
      // We need to filter out the static imports from the standard import list.
      const staticImportPaths = new Set(staticImports);

      for (const importPath of imports) {
        // Skip external imports
        if (isExternalImport(importPath)) continue;

        // Skip if this is actually a static import that was double-matched
        // (IMPORT_RE matches "import static X" as "import" + "static", which
        // won't match because "static" isn't a valid package start in IMPORT_RE)
        // Actually IMPORT_RE uses ^\s*import\s+ which won't match the "static"
        // keyword as part of the path. Let's handle both cases.

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

      // Process static imports
      for (const staticPath of staticImports) {
        // Resolve the class FQN from the static import
        const classFqn = staticImportToClassFqn(staticPath);

        // Skip external
        if (isExternalImport(classFqn)) continue;

        const targetFile = classToFile.get(classFqn);
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

    return {
      nodes: files,
      edges: Array.from(edgeMap.values()),
    };
  }
}
