import { existsSync } from "fs";
import { readRepos, writeRepos, getReposFilePath } from "../../../minds/pipeline_core/repo-registry";

export function repoResolve(repoId: string): void {
  const repos = readRepos();
  const entry = repos[repoId];
  if (!entry) {
    console.error(`Repo '${repoId}' not found in ${getReposFilePath()}`);
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
