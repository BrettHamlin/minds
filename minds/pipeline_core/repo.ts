/**
 * repo.ts — Repository root detection.
 */

import { execSync } from "child_process";

export function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return process.cwd();
  }
}
