/**
 * walk.ts — Shared file discovery utility for all extractors.
 *
 * Provides a single walkDir() implementation to avoid duplication
 * across language-specific extractors.
 */

import { readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

export interface WalkOptions {
  /** File extensions to include (e.g., [".ts", ".tsx"]) */
  extensions: string[];
  /** Directory names to exclude (e.g., ["node_modules", ".git"]) */
  excludedDirs: Set<string>;
  /** Optional predicate to filter individual filenames (return false to skip) */
  fileFilter?: (filename: string) => boolean;
}

/**
 * Recursively walk a directory tree collecting files that match
 * the given extensions, skipping excluded and dot-prefixed directories.
 *
 * Returns relative paths sorted alphabetically.
 */
export function walkDir(
  dir: string,
  rootDir: string,
  options: WalkOptions,
): string[] {
  const files: string[] = [];
  walkDirInner(dir, rootDir, options, files);
  files.sort();
  return files;
}

function walkDirInner(
  dir: string,
  rootDir: string,
  options: WalkOptions,
  files: string[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    // Skip excluded and dot-prefixed directories
    if (options.excludedDirs.has(entry) || entry.startsWith(".")) {
      try {
        if (statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }
    }

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (!entry.startsWith(".") && !options.excludedDirs.has(entry)) {
        walkDirInner(fullPath, rootDir, options, files);
      }
    } else if (stat.isFile()) {
      const ext = extname(entry);
      if (options.extensions.includes(ext)) {
        if (!options.fileFilter || options.fileFilter(entry)) {
          files.push(relative(rootDir, fullPath));
        }
      }
    }
  }
}
