import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const REPOS_FILE = process.env.COLLAB_REPOS_FILE ?? join(homedir(), ".collab", "repos.json");

interface ReposMap {
  [repoId: string]: { path: string };
}

function readRepos(): ReposMap {
  if (!existsSync(REPOS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(REPOS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeRepos(repos: ReposMap): void {
  const dir = dirname(REPOS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2) + "\n");
}

export function repoResolve(repoId: string): void {
  const repos = readRepos();
  const entry = repos[repoId];
  if (!entry) {
    console.error(`Repo '${repoId}' not found in ${REPOS_FILE}`);
    process.exit(1);
  }
  if (!existsSync(entry.path)) {
    console.error(`Repo '${repoId}' path does not exist: ${entry.path}`);
    process.exit(1);
  }
  console.log(entry.path);
}

export function repoAdd(repoId: string, repoPath: string): void {
  if (!existsSync(repoPath)) {
    console.error(`Path does not exist: ${repoPath}`);
    process.exit(1);
  }
  const repos = readRepos();
  repos[repoId] = { path: repoPath };
  writeRepos(repos);
  console.log(`Added '${repoId}' → ${repoPath}`);
}

export function repoList(): void {
  const repos = readRepos();
  const entries = Object.entries(repos);
  if (entries.length === 0) {
    console.log("No repos registered. Use `collab repo add <id> <path>` to add one.");
    return;
  }
  for (const [id, { path }] of entries) {
    console.log(`${id} → ${path}`);
  }
}

export function repoRemove(repoId: string): void {
  const repos = readRepos();
  if (!repos[repoId]) {
    console.error(`Repo '${repoId}' not found.`);
    process.exit(1);
  }
  delete repos[repoId];
  writeRepos(repos);
  console.log(`Removed '${repoId}'`);
}
