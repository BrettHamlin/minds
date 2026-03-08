import { existsSync, readdirSync, mkdirSync, copyFileSync, chmodSync, statSync } from "fs";
import { join } from "path";

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function countFiles(dir: string, pattern?: RegExp): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => (pattern ? pattern.test(f) : true)).length;
}

export interface CopyResult {
  copied: string[];
  skipped: string[];
}

export function copyRecursive(
  src: string,
  dest: string,
  options: { force?: boolean } = {}
): CopyResult {
  const result: CopyResult = { copied: [], skipped: [] };
  if (!existsSync(src)) return result;

  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = copyRecursive(srcPath, destPath, options);
      result.copied.push(...sub.copied);
      result.skipped.push(...sub.skipped);
    } else {
      if (existsSync(destPath) && !options.force) {
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
