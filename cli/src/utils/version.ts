import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export interface CollabVersion {
  version: string;
  installedAt: string;
  updatedAt: string;
  previousVersion?: string;
}

const VERSION_FILE = ".collab/version.json";

export function readVersion(repoRoot: string): CollabVersion | null {
  const path = join(repoRoot, VERSION_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeVersion(repoRoot: string, version: CollabVersion): void {
  const path = join(repoRoot, VERSION_FILE);
  writeFileSync(path, JSON.stringify(version, null, 2) + "\n");
}
