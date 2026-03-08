/**
 * Unit tests for hygiene-cli.ts — promote and prune CLI operations.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { memoryMdPath } from "./paths";

const CLI = join(import.meta.dir, "hygiene-cli.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const TEST_MIND = "memory";
const mdPath = memoryMdPath(TEST_MIND);

let savedContent: string | null = null;

function saveMemoryMd(): void {
  savedContent = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : null;
}

function restoreMemoryMd(): void {
  if (savedContent !== null) {
    writeFileSync(mdPath, savedContent, "utf-8");
  }
}

afterEach(restoreMemoryMd);

function runCLI(args: string[]): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(["bun", CLI, ...args], { cwd: REPO_ROOT });
  return {
    exitCode: result.exitCode ?? 1,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
}

describe("hygiene-cli --promote", () => {
  test("adds promoted entry to MEMORY.md", () => {
    saveMemoryMd();
    const { exitCode, stdout } = runCLI([
      "--mind", TEST_MIND,
      "--promote", "Test insight for promote __cli_test__",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Promoted");

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("Test insight for promote __cli_test__");
  });

  test("multiple --promote flags add all entries", () => {
    saveMemoryMd();
    const { exitCode } = runCLI([
      "--mind", TEST_MIND,
      "--promote", "First promoted entry __cli__",
      "--promote", "Second promoted entry __cli__",
    ]);

    expect(exitCode).toBe(0);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("First promoted entry __cli__");
    expect(content).toContain("Second promoted entry __cli__");
  });
});

describe("hygiene-cli --prune", () => {
  test("removes stale entries from MEMORY.md", () => {
    saveMemoryMd();
    const before = savedContent ?? "";
    writeFileSync(mdPath, before + "\n- Stale line to remove <!-- STALE -->\n- Fresh line\n", "utf-8");

    const { exitCode, stdout } = runCLI(["--mind", TEST_MIND, "--prune"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pruned");

    const after = readFileSync(mdPath, "utf-8");
    expect(after).not.toContain("<!-- STALE -->");
    expect(after).toContain("Fresh line");
  });
});

describe("hygiene-cli combined --promote and --prune", () => {
  test("promotes entries and prunes stale in one call", () => {
    saveMemoryMd();
    const before = savedContent ?? "";
    writeFileSync(mdPath, before + "\n- Old stale entry <!-- STALE -->\n", "utf-8");

    const { exitCode } = runCLI([
      "--mind", TEST_MIND,
      "--promote", "New durable insight __combo__",
      "--prune",
    ]);

    expect(exitCode).toBe(0);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("New durable insight __combo__");
    expect(content).not.toContain("<!-- STALE -->");
  });
});

describe("hygiene-cli error cases", () => {
  test("error when neither --promote nor --prune given", () => {
    const { exitCode, stderr } = runCLI(["--mind", TEST_MIND]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--promote");
    expect(stderr).toContain("--prune");
  });

  test("error when --mind is missing", () => {
    const { exitCode, stderr } = runCLI(["--promote", "some entry"]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--mind");
  });
});
