import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

interface ReposMap {
  [repoId: string]: { path: string };
}

function getReposFile(): string {
  return process.env.COLLAB_REPOS_FILE ?? join(homedir(), ".collab", "repos.json");
}

function readRepos(): ReposMap {
  const file = getReposFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function writeRepos(repos: ReposMap): void {
  const file = getReposFile();
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(repos, null, 2) + "\n");
}

export async function repo(
  positional: string[],
  _flags: Record<string, string | boolean>
): Promise<void> {
  const action = positional[0];

  if (!action) {
    console.log("Usage: collab repo <resolve|add|list|remove>");
    return;
  }

  if (action === "resolve") {
    const repoId = positional[1];
    if (!repoId) {
      console.error("Usage: collab repo resolve <repo-id>");
      process.exit(1);
    }
    const repos = readRepos();
    const entry = repos[repoId];
    if (!entry) {
      console.error(`Repo '${repoId}' not found in ${getReposFile()}`);
      process.exit(1);
    }
    if (!existsSync(entry.path)) {
      console.error(`Repo '${repoId}' path does not exist: ${entry.path}`);
      process.exit(1);
    }
    console.log(entry.path);
    return;
  }

  if (action === "add") {
    const repoId = positional[1];
    const repoPath = positional[2];
    if (!repoId || !repoPath) {
      console.error("Usage: collab repo add <repo-id> <path>");
      process.exit(1);
    }
    if (!existsSync(repoPath)) {
      console.error(`Path does not exist: ${repoPath}`);
      process.exit(1);
    }
    const repos = readRepos();
    repos[repoId] = { path: repoPath };
    writeRepos(repos);
    console.log(`Added '${repoId}' → ${repoPath}`);
    return;
  }

  if (action === "list") {
    const repos = readRepos();
    const entries = Object.entries(repos);
    if (entries.length === 0) {
      console.log("No repos registered. Use `collab repo add <id> <path>` to add one.");
      return;
    }
    for (const [id, { path }] of entries) {
      console.log(`${id} → ${path}`);
    }
    return;
  }

  if (action === "remove") {
    const repoId = positional[1];
    if (!repoId) {
      console.error("Usage: collab repo remove <repo-id>");
      process.exit(1);
    }
    const repos = readRepos();
    if (!repos[repoId]) {
      console.error(`Repo '${repoId}' not found.`);
      process.exit(1);
    }
    delete repos[repoId];
    writeRepos(repos);
    console.log(`Removed '${repoId}'`);
    return;
  }

  console.error(`Unknown repo subcommand: "${action}"`);
  console.error("Run: collab repo --help");
  process.exit(1);
}
