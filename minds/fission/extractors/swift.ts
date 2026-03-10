/**
 * swift.ts — Swift type-reference graph extractor.
 *
 * Swift doesn't have file-level imports like TypeScript. All .swift files
 * in the same module/target can see each other. Dependencies come from
 * type references across files.
 *
 * Phase 1: Collect type declarations (class, struct, enum, protocol, actor)
 *          from each file. Build a map: typeName -> filePath.
 * Phase 2: For each file, find references to types declared in OTHER files.
 *          Each cross-file reference creates an edge. Weight = number of
 *          distinct types from that target file referenced.
 *
 * This is a heuristic approach using regex — no AST parser needed.
 * Good enough for clustering: files sharing many type references are
 * likely in the same domain.
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".swift"];

const EXCLUDED_DIRS = new Set([
  ".build",
  "Pods",
  "Carthage",
  "DerivedData",
  ".git",
  "node_modules",
  "Tests",
  ".swiftpm",
]);

/**
 * Common Swift/Foundation types to filter out. These are ubiquitous and
 * create false edges if any file happens to declare a type with a
 * matching name (extremely unlikely but worth filtering for noise).
 */
const COMMON_TYPES = new Set([
  "String",
  "Int",
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "UInt",
  "UInt8",
  "UInt16",
  "UInt32",
  "UInt64",
  "Float",
  "Double",
  "Bool",
  "Array",
  "Dictionary",
  "Set",
  "Optional",
  "Error",
  "URL",
  "Data",
  "Date",
  "Result",
  "Void",
  "Any",
  "AnyObject",
  "Self",
  "Never",
  "Character",
  "Substring",
  "Range",
  "ClosedRange",
  "Codable",
  "Encodable",
  "Decodable",
  "Hashable",
  "Equatable",
  "Comparable",
  "Identifiable",
  "Sendable",
  "CustomStringConvertible",
  "CaseIterable",
]);

// ---------------------------------------------------------------------------
// Type declaration regex
// ---------------------------------------------------------------------------

/**
 * Matches type declarations with optional access modifiers and `final`.
 * Captures the type name (group 1).
 *
 * Examples matched:
 *   class Foo
 *   public class Bar
 *   open class Baz
 *   private struct Qux
 *   final class FinalThing
 *   public final class Thing
 *   internal enum Status
 *   protocol Fetchable
 *   actor DataStore
 */
const TYPE_DECL_RE =
  /(?:^|\n)\s*(?:(?:public|open|internal|private|fileprivate)\s+)?(?:final\s+)?(?:class|struct|enum|protocol|actor)\s+(\w+)/g;

// ---------------------------------------------------------------------------
// Type declaration parsing
// ---------------------------------------------------------------------------

/**
 * Extract all type names declared in a Swift source file.
 * Returns an array of type names (class, struct, enum, protocol, actor).
 */
function extractTypeDeclarations(source: string): string[] {
  const types: string[] = [];
  TYPE_DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TYPE_DECL_RE.exec(source)) !== null) {
    const typeName = match[1];
    if (!COMMON_TYPES.has(typeName)) {
      types.push(typeName);
    }
  }

  return types;
}

/**
 * Count how many times a type name appears in source code as a word-boundary
 * match. This detects references like `let x: TypeName`, `TypeName()`,
 * `-> TypeName`, etc.
 */
function countTypeReferences(source: string, typeName: string): number {
  const re = new RegExp(`\\b${typeName}\\b`, "g");
  const matches = source.match(re);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// SwiftExtractor
// ---------------------------------------------------------------------------

export class SwiftExtractor implements Extractor {
  language = "swift";
  extensions = [".swift"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // 1. Discover all Swift source files
    const files = walkDir(absRoot, absRoot, {
      extensions: SOURCE_EXTENSIONS,
      excludedDirs: EXCLUDED_DIRS,
      fileFilter: (f) => !f.endsWith("Tests.swift") && !f.endsWith("Spec.swift"),
    });

    if (files.length === 0) {
      return { nodes: [], edges: [] };
    }

    // 2. Phase 1: Collect type declarations from each file
    //    Build a map: typeName -> filePath (relative)
    const typeToFile = new Map<string, string>();
    const fileContents = new Map<string, string>();

    for (const relFile of files) {
      const absFile = join(absRoot, relFile);
      let source: string;
      try {
        source = readFileSync(absFile, "utf-8");
      } catch {
        continue;
      }

      fileContents.set(relFile, source);
      const types = extractTypeDeclarations(source);

      for (const typeName of types) {
        // First declaration wins (if multiple files declare same type name,
        // the first one found takes precedence)
        if (!typeToFile.has(typeName)) {
          typeToFile.set(typeName, relFile);
        }
      }
    }

    // 3. Phase 2: For each file, find references to types in OTHER files
    const edgeMap = new Map<string, GraphEdge>();

    for (const relFile of files) {
      const source = fileContents.get(relFile);
      if (!source) continue;

      // Track which target files are referenced and how many distinct types
      const targetTypeCounts = new Map<string, number>();

      for (const [typeName, declaringFile] of typeToFile) {
        // Skip self-references
        if (declaringFile === relFile) continue;

        // Check if this file references the type
        const refCount = countTypeReferences(source, typeName);
        if (refCount > 0) {
          const current = targetTypeCounts.get(declaringFile) ?? 0;
          targetTypeCounts.set(declaringFile, current + 1);
        }
      }

      // Create edges
      for (const [targetFile, distinctTypeCount] of targetTypeCounts) {
        const key = `${relFile}->${targetFile}`;
        edgeMap.set(key, {
          from: relFile,
          to: targetFile,
          weight: distinctTypeCount,
        });
      }
    }

    return {
      nodes: files,
      edges: Array.from(edgeMap.values()),
    };
  }
}
