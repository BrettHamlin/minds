/**
 * tests/unit/portable-imports.test.ts
 *
 * Guard test: ensures all relative imports in installed files resolve correctly
 * from their INSTALLED location (.collab/), not just their source location (src/).
 *
 * The installer copies files with this mapping:
 *   src/handlers/       → .collab/handlers/
 *   src/scripts/        → .collab/scripts/        (top-level only)
 *   src/scripts/orchestrator/** → .collab/scripts/orchestrator/**
 *   src/lib/**           → .collab/lib/**
 *   transport/           → .collab/transport/
 *
 * A relative import that works from src/ may break from .collab/ if it
 * references a path that doesn't exist after the prefix transformation.
 * This test catches that class of bug statically.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve, dirname } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

// ── Install mapping: source path → installed path prefix ───────────────────

interface InstallMapping {
  /** Source directory relative to project root */
  srcDir: string;
  /** Installed directory relative to project root */
  destDir: string;
  /** Whether to recurse into subdirectories */
  recursive: boolean;
}

const INSTALL_MAPPINGS: InstallMapping[] = [
  { srcDir: "src/handlers", destDir: ".collab/handlers", recursive: false },
  { srcDir: "src/scripts", destDir: ".collab/scripts", recursive: false },
  { srcDir: "src/scripts/orchestrator", destDir: ".collab/scripts/orchestrator", recursive: true },
  { srcDir: "src/lib", destDir: ".collab/lib", recursive: true },
  { srcDir: "transport", destDir: ".collab/transport", recursive: false },
];

// ── Extract imports from a TypeScript file ─────────────────────────────────

const STATIC_IMPORT_RE = /(?:import|export)\s+.*?from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /(?:await\s+)?import\s*\(\s*["']([^"']+)["']\s*\)/g;

interface ImportRef {
  importPath: string;
  line: number;
}

function extractImports(filePath: string): ImportRef[] {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const imports: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const importPath = m[1];
        // Only check relative imports (skip node builtins, npm packages)
        if (importPath.startsWith(".")) {
          imports.push({ importPath, line: i + 1 });
        }
      }
    }
  }

  return imports;
}

// ── Collect all installed .ts files (excluding tests) ──────────────────────

function collectFiles(dir: string, recursive: boolean): string[] {
  const absDir = join(PROJECT_ROOT, dir);
  if (!existsSync(absDir)) return [];

  const files: string[] = [];

  for (const entry of readdirSync(absDir)) {
    const full = join(absDir, entry);
    const stat = statSync(full);

    if (stat.isDirectory() && recursive) {
      // Recurse one level
      for (const sub of readdirSync(full)) {
        if (sub.endsWith(".ts") && !sub.endsWith(".test.ts")) {
          files.push(join(dir, entry, sub));
        }
      }
    } else if (stat.isFile() && entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(join(dir, entry));
    }
  }

  return files;
}

// ── Transform a source-relative file path to its installed equivalent ──────

function sourceToInstalled(srcRelPath: string): string | null {
  for (const m of INSTALL_MAPPINGS) {
    if (srcRelPath.startsWith(m.srcDir + "/")) {
      return srcRelPath.replace(m.srcDir, m.destDir);
    }
  }
  return null;
}

// ── Resolve an import from the installed location ──────────────────────────

function resolveFromInstalled(
  installedFilePath: string,
  importPath: string
): { resolvedPath: string; exists: boolean } {
  const installedDir = dirname(join(PROJECT_ROOT, installedFilePath));
  let resolved = resolve(installedDir, importPath);

  // Bun resolves .ts extensions and maps .js → .ts
  if (resolved.endsWith(".js")) {
    const tsVariant = resolved.replace(/\.js$/, ".ts");
    if (existsSync(tsVariant)) resolved = tsVariant;
  } else if (!resolved.endsWith(".ts") && !resolved.endsWith(".json")) {
    if (existsSync(resolved + ".ts")) resolved += ".ts";
    else if (existsSync(resolved + "/index.ts")) resolved += "/index.ts";
  }

  return {
    resolvedPath: resolved.replace(PROJECT_ROOT + "/", ""),
    exists: existsSync(resolved),
  };
}

// ── Check if a resolved path stays within .collab/ ─────────────────────────
//
// In an installed repo, only .collab/ exists — not transport/, src/, etc.
// Imports from .collab/handlers/, .collab/scripts/, .collab/lib/ must resolve
// to targets WITHIN .collab/. Only .collab/transport/ files may import siblings
// within .collab/transport/ (they're installed together).

function escapesCollabBoundary(installedFile: string, resolvedPath: string): boolean {
  // Normalize: strip PROJECT_ROOT prefix if present
  const rel = resolvedPath.startsWith(PROJECT_ROOT)
    ? resolvedPath.slice(PROJECT_ROOT.length + 1)
    : resolvedPath;

  // If it starts with .collab/, it's inside the boundary
  if (rel.startsWith(".collab/") || rel.startsWith(".collab\\")) return false;

  // Anything else escapes — in installed repos, only .collab/ exists.
  // Paths like transport/X, src/X, lib/X all break outside the collab dev repo.
  return true;
}

// ── The test ───────────────────────────────────────────────────────────────

describe("portable imports", () => {
  test("all relative imports in installed files resolve from .collab/ location", () => {
    const failures: string[] = [];

    for (const mapping of INSTALL_MAPPINGS) {
      const srcFiles = collectFiles(mapping.srcDir, mapping.recursive);

      for (const srcFile of srcFiles) {
        const installedFile = sourceToInstalled(srcFile);
        if (!installedFile) continue;

        const imports = extractImports(join(PROJECT_ROOT, srcFile));

        for (const imp of imports) {
          // Resolve from the INSTALLED location
          const result = resolveFromInstalled(installedFile, imp.importPath);

          if (!result.exists) {
            // File doesn't exist at all from installed location
            const srcDir = dirname(join(PROJECT_ROOT, srcFile));
            let srcResolved = resolve(srcDir, imp.importPath);
            if (!srcResolved.endsWith(".ts") && existsSync(srcResolved + ".ts")) {
              srcResolved += ".ts";
            }
            const worksFromSource = existsSync(srcResolved);

            failures.push(
              `${srcFile}:${imp.line} → import("${imp.importPath}")\n` +
              `  Installed at: ${installedFile}\n` +
              `  Resolves to:  ${result.resolvedPath} (NOT FOUND)\n` +
              `  Works from source: ${worksFromSource ? "YES — this import breaks after install!" : "NO — broken everywhere"}`
            );
          } else if (escapesCollabBoundary(installedFile, result.resolvedPath)) {
            // File exists in collab repo but escapes .collab/ boundary.
            // This works in the collab dev repo (transport/ exists at root)
            // but breaks in installed repos where only .collab/ exists.
            failures.push(
              `${srcFile}:${imp.line} → import("${imp.importPath}")\n` +
              `  Installed at: ${installedFile}\n` +
              `  Resolves to:  ${result.resolvedPath} (ESCAPES .collab/ boundary)\n` +
              `  This import works in the collab repo but breaks in installed repos\n` +
              `  where only .collab/ exists (not transport/, src/, etc.)`
            );
          }
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Found ${failures.length} import(s) that break when installed to .collab/:\n\n` +
        failures.join("\n\n") +
        "\n\nFix: use dynamic path resolution (check .collab/ first, fall back to source location)"
      );
    }
  });
});
