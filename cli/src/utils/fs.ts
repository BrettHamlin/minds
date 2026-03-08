import { existsSync, readdirSync, mkdirSync, copyFileSync, chmodSync, statSync } from "fs";
import { join } from "path";

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function countFiles(dir: string, pattern?: RegExp): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(join(dir, entry.name), pattern);
    } else if (!pattern || pattern.test(entry.name)) {
      count++;
    }
  }
  return count;
}

export interface CopyResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

export function copyRecursive(
  src: string,
  dest: string,
  options: { force?: boolean; skipIfExists?: boolean } = {}
): CopyResult {
  const result: CopyResult = { copied: [], skipped: [], errors: [] };
  if (!existsSync(src)) {
    result.errors.push(`source not found: ${src}`);
    return result;
  }

  const srcStat = statSync(src);

  // Handle single-file source
  if (srcStat.isFile()) {
    if (existsSync(dest) && (options.skipIfExists || (!options.force && existsSync(dest)))) {
      result.skipped.push(dest);
    } else {
      copyFileSync(src, dest);
      result.copied.push(dest);
    }
    return result;
  }

  // Handle directory source
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = copyRecursive(srcPath, destPath, options);
      result.copied.push(...sub.copied);
      result.skipped.push(...sub.skipped);
      result.errors.push(...sub.errors);
    } else {
      if (existsSync(destPath) && (options.skipIfExists || !options.force)) {
        result.skipped.push(destPath);
      } else {
        copyFileSync(srcPath, destPath);
        result.copied.push(destPath);
      }
    }
  }

  return result;
}

export function setExecutable(filePath: string): void {
  chmodSync(filePath, 0o755);
}
