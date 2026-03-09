import { execSync } from "child_process";

export function isGitRepo(dir?: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir ?? process.cwd(),
      stdio: "pipe",
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot(dir?: string): string {
  return execSync("git rev-parse --show-toplevel", {
    cwd: dir ?? process.cwd(),
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();
}
