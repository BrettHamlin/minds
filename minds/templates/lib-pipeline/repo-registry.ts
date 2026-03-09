/**
 * Repo registry — reads/writes ~/.collab/repos.json (or COLLAB_REPOS_FILE override).
 * Used by both the `collab repo` CLI and orchestrator-init.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ReposMap {
  [repoId: string]: { path: string };
}

export function getReposFilePath(): string {
  return process.env.COLLAB_REPOS_FILE ?? join(homedir(), ".collab", "repos.json");
}

export function readRepos(): ReposMap {
  const file = getReposFilePath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

export function writeRepos(repos: ReposMap): void {
  const file = getReposFilePath();
  const dir = join(file, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(repos, null, 2) + "\n");
}

export function resolveRepoPath(repoId: string): string | null {
  const repos = readRepos();
  const entry = repos[repoId];
  if (!entry) return null;
  if (!existsSync(entry.path)) return null;
  return entry.path;
}
