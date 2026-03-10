/**
 * csharp.ts — C# dependency graph extractor.
 *
 * C# uses `using` directives for namespaces, not file-level imports.
 * The real dependency signal comes from both using directives AND
 * type references (especially intra-namespace where no using is needed).
 *
 * Phase 1: Parse namespace and type declarations from each file.
 *          Build maps: namespace->files, fqn->file.
 * Phase 2: Parse `using` directives and resolve against internal maps.
 *          - `using Foo.Bar;` -> edges to all files in that namespace
 *          - `using static Foo.Bar.Baz;` -> resolve type in class map
 *          - `using Alias = Foo.Bar.Baz;` -> resolve the right side
 *          Skip System.*, Microsoft.*, Windows.* (framework).
 * Phase 3: Intra-namespace type reference detection.
 *          For types in the same namespace but different files, scan for
 *          word-boundary references to catch dependencies without using.
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { Extractor } from "./extractor.js";
import type { DependencyGraph, GraphEdge } from "../lib/types.js";
import { walkDir } from "./walk.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".cs"];

const EXCLUDED_DIRS = new Set([
  "bin",
  "obj",
  ".git",
  "node_modules",
  "packages",
  ".vs",
]);

/** Framework namespace prefixes to skip. */
const EXTERNAL_PREFIXES = ["System", "Microsoft", "Windows"];

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/**
 * Namespace declaration — both forms:
 *   namespace Foo.Bar { ... }   (traditional)
 *   namespace Foo.Bar;          (file-scoped, C# 10+)
 */
const NAMESPACE_RE = /^[ \t]*namespace\s+([\w.]+)/m;

/**
 * Type declarations with optional access modifiers and keywords.
 * Captures the type name (group 1).
 *
 * Matches:
 *   class Foo
 *   public class Bar
 *   internal static class Baz
 *   public abstract class Qux
 *   public sealed class Thing
 *   public partial class Widget
 *   protected struct Data
 *   private enum Status
 *   public interface IFoo
 *   public record MyRecord
 */
const TYPE_DECL_RE =
  /(?:^|\n)\s*(?:(?:public|internal|private|protected)\s+)?(?:(?:static|abstract|sealed|partial)\s+)*(?:class|struct|interface|enum|record)\s+(\w+)/g;

/**
 * Using directive patterns:
 *   using Foo.Bar;
 *   using static Foo.Bar.Baz;
 *   using Alias = Foo.Bar.Baz;
 */
const USING_NAMESPACE_RE = /^[ \t]*using\s+([\w.]+)\s*;/gm;
const USING_STATIC_RE = /^[ \t]*using\s+static\s+([\w.]+)\s*;/gm;
const USING_ALIAS_RE = /^[ \t]*using\s+\w+\s*=\s*([\w.]+)\s*;/gm;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseNamespace(source: string): string | null {
  const match = source.match(NAMESPACE_RE);
  return match ? match[1] : null;
}

function parseTypeDeclarations(source: string): string[] {
  const types: string[] = [];
  TYPE_DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TYPE_DECL_RE.exec(source)) !== null) {
    types.push(match[1]);
  }
  return types;
}

function parseUsingNamespaces(source: string): string[] {
  const results: string[] = [];
  USING_NAMESPACE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USING_NAMESPACE_RE.exec(source)) !== null) {
    // Filter out "using static" and "using Alias =" which have their own parsers
    const line = source.substring(
      Math.max(0, source.lastIndexOf("\n", match.index) + 1),
      match.index + match[0].length,
    );
    if (line.includes("static") || line.includes("=")) continue;
    results.push(match[1]);
  }
  return results;
}

function parseUsingStatic(source: string): string[] {
  const results: string[] = [];
  USING_STATIC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USING_STATIC_RE.exec(source)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function parseUsingAlias(source: string): string[] {
  const results: string[] = [];
  USING_ALIAS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USING_ALIAS_RE.exec(source)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function isExternalNamespace(ns: string): boolean {
  return EXTERNAL_PREFIXES.some(
    (prefix) => ns === prefix || ns.startsWith(prefix + "."),
  );
}

function countTypeReferences(source: string, typeName: string): number {
  const re = new RegExp(`\\b${typeName}\\b`, "g");
  const matches = source.match(re);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// CSharpExtractor
// ---------------------------------------------------------------------------

export class CSharpExtractor implements Extractor {
  language = "csharp";
  extensions = [".cs"];

  async extract(rootDir: string): Promise<DependencyGraph> {
    const absRoot = resolve(rootDir);

    // Phase 0: Discover all C# source files
    const files = walkDir(absRoot, absRoot, {
      extensions: SOURCE_EXTENSIONS,
      excludedDirs: EXCLUDED_DIRS,
    });

    if (files.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Phase 1: Parse namespace and type declarations
    const namespaceToFiles = new Map<string, string[]>();
    const fqnToFile = new Map<string, string>();
    const fileNamespaces = new Map<string, string | null>();
    const fileContents = new Map<string, string>();
    const fileTypes = new Map<string, string[]>();

    for (const relFile of files) {
      const absFile = join(absRoot, relFile);
      let source: string;
      try {
        source = readFileSync(absFile, "utf-8");
      } catch {
        continue;
      }

      fileContents.set(relFile, source);
      const ns = parseNamespace(source);
      fileNamespaces.set(relFile, ns);

      if (ns) {
        const existing = namespaceToFiles.get(ns) ?? [];
        existing.push(relFile);
        namespaceToFiles.set(ns, existing);
      }

      const types = parseTypeDeclarations(source);
      fileTypes.set(relFile, types);

      for (const typeName of types) {
        const fqn = ns ? `${ns}.${typeName}` : typeName;
        // First declaration wins (partial classes map to first file)
        if (!fqnToFile.has(fqn)) {
          fqnToFile.set(fqn, relFile);
        }
      }
    }

    // Phase 2: Resolve using directives
    const edgeMap = new Map<string, GraphEdge>();

    for (const relFile of files) {
      const source = fileContents.get(relFile);
      if (!source) continue;

      // 2a: using Namespace; -> edges to all files in that namespace
      const usingNamespaces = parseUsingNamespaces(source);
      for (const ns of usingNamespaces) {
        if (isExternalNamespace(ns)) continue;

        const nsFiles = namespaceToFiles.get(ns);
        if (!nsFiles) continue;

        for (const targetFile of nsFiles) {
          if (targetFile === relFile) continue;
          const key = `${relFile}->${targetFile}`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { from: relFile, to: targetFile, weight: 1 });
          }
        }
      }

      // 2b: using static Namespace.Type; -> resolve FQN
      const usingStatics = parseUsingStatic(source);
      for (const fqn of usingStatics) {
        if (isExternalNamespace(fqn)) continue;

        const targetFile = fqnToFile.get(fqn);
        if (!targetFile || targetFile === relFile) continue;

        const key = `${relFile}->${targetFile}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight += 1;
        } else {
          edgeMap.set(key, { from: relFile, to: targetFile, weight: 1 });
        }
      }

      // 2c: using Alias = Namespace.Type; -> resolve RHS FQN
      const usingAliases = parseUsingAlias(source);
      for (const fqn of usingAliases) {
        if (isExternalNamespace(fqn)) continue;

        const targetFile = fqnToFile.get(fqn);
        if (!targetFile || targetFile === relFile) continue;

        const key = `${relFile}->${targetFile}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight += 1;
        } else {
          edgeMap.set(key, { from: relFile, to: targetFile, weight: 1 });
        }
      }
    }

    // Phase 3: Intra-namespace type reference detection
    // For types in the same namespace but different files
    for (const relFile of files) {
      const source = fileContents.get(relFile);
      if (!source) continue;

      const fileNs = fileNamespaces.get(relFile);
      if (!fileNs) continue;

      // Get all files in the same namespace
      const sameNsFiles = namespaceToFiles.get(fileNs);
      if (!sameNsFiles) continue;

      for (const otherFile of sameNsFiles) {
        if (otherFile === relFile) continue;

        const otherTypes = fileTypes.get(otherFile);
        if (!otherTypes || otherTypes.length === 0) continue;

        let distinctTypeCount = 0;
        for (const typeName of otherTypes) {
          if (countTypeReferences(source, typeName) > 0) {
            distinctTypeCount++;
          }
        }

        if (distinctTypeCount > 0) {
          const key = `${relFile}->${otherFile}`;
          const existing = edgeMap.get(key);
          if (existing) {
            // Use the higher of the two weights
            if (distinctTypeCount > existing.weight) {
              existing.weight = distinctTypeCount;
            }
          } else {
            edgeMap.set(key, {
              from: relFile,
              to: otherFile,
              weight: distinctTypeCount,
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
