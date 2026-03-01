import { execSync } from "child_process";

export function isGitRepo(dir?: string): boolean {
  try {
    execSync("git rev-parse --show-toplevel", { cwd: dir, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot(dir?: string): string {
  return execSync("git rev-parse --show-toplevel", { cwd: dir, encoding: "utf-8" }).trim();
}
