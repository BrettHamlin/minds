import { mkdirSync, copyFileSync, readdirSync, statSync, chmodSync, existsSync } from "fs";
import { join } from "path";

export interface CopyResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function copyRecursive(
  src: string,
  dest: string,
  options: { force?: boolean; skipIfExists?: boolean } = {}
): CopyResult {
  const result: CopyResult = { copied: [], skipped: [], errors: [] };

  if (!existsSync(src)) {
    result.errors.push(`Source not found: ${src}`);
    return result;
  }

  const stat = statSync(src);
  if (stat.isFile()) {
    if (existsSync(dest) && options.skipIfExists && !options.force) {
      result.skipped.push(dest);
    } else {
      ensureDir(join(dest, "..").replace(/\/[^/]*$/, ""));
      copyFileSync(src, dest);
      result.copied.push(dest);
    }
    return result;
  }

  // Directory
  ensureDir(dest);
  for (const entry of readdirSync(src)) {
    const childResult = copyRecursive(
      join(src, entry),
      join(dest, entry),
      options
    );
    result.copied.push(...childResult.copied);
    result.skipped.push(...childResult.skipped);
    result.errors.push(...childResult.errors);
  }

  return result;
}

export function setExecutable(path: string): void {
  chmodSync(path, 0o755);
}

export function countFiles(dir: string, pattern?: RegExp): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { recursive: true })) {
    const fullPath = join(dir, entry.toString());
    if (statSync(fullPath).isFile()) {
      if (!pattern || pattern.test(entry.toString())) {
        count++;
      }
    }
  }
  return count;
}
