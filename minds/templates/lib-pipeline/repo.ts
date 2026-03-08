/**
 * repo.ts — Repo root detection utility.
 *
 * Install path: .collab/lib/pipeline/repo.ts
 */

import { execSync } from "child_process";

export function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}
