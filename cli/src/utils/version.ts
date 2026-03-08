import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface CollabVersion {
  version: string;
  installedAt: string;
  updatedAt: string;
  previousVersion?: string;
}

const VERSION_FILE = ".collab/version.json";

export function readVersion(repoRoot: string): CollabVersion | null {
  const versionPath = join(repoRoot, VERSION_FILE);
  if (!existsSync(versionPath)) return null;
  try {
    return JSON.parse(readFileSync(versionPath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeVersion(repoRoot: string, data: CollabVersion): void {
  const versionPath = join(repoRoot, VERSION_FILE);
  mkdirSync(dirname(versionPath), { recursive: true });
  writeFileSync(versionPath, JSON.stringify(data, null, 2) + "\n");
}
