import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import os from "os";

export function createTempGitRepo(): string {
  const dir = mkdtempSync(join(os.tmpdir(), "collab-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
  return dir;
}

export function createTempDir(): string {
  return mkdtempSync(join(os.tmpdir(), "collab-test-"));
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const CLI_PATH = join(import.meta.dir, "..", "bin", "collab.ts");

export function runCLI(
  args: string,
  cwd: string
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`bun run ${CLI_PATH} ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}
