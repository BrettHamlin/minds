import { describe, test, expect, afterEach } from "bun:test";
import { createTempGitRepo, cleanupTempDir, runCLI } from "../helpers";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { countFiles } from "../../src/utils/fs";

describe("collab status", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      cleanupTempDir(dir);
    }
    dirs.length = 0;
  });

  test("shows 'no installation found' in repo without collab", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    const { exitCode, stdout } = runCLI("status", dir);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain("no collab installation found");
  });

  test("shows version and file counts after init", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    const { exitCode, stdout } = runCLI("status", dir);
    expect(exitCode).toBe(0);

    // Should show version
    expect(stdout).toContain("0.1.0");

    // Should show file counts
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("Skills:");
    expect(stdout).toContain("Handlers:");
  });

  test("file counts match actual filesystem counts", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Count actual files
    const actualCommandCount = countFiles(join(dir, ".claude/commands"), /\.md$/);
    const actualHandlerCount = countFiles(join(dir, ".collab/handlers"), /\.ts$/);
    const actualSkillDirs = existsSync(join(dir, ".claude/skills"))
      ? readdirSync(join(dir, ".claude/skills")).filter((e) =>
          statSync(join(dir, ".claude/skills", e)).isDirectory()
        ).length
      : 0;

    // Run status and check counts appear
    const { stdout } = runCLI("status", dir);

    // The counts should be present in the output
    expect(actualCommandCount).toBeGreaterThan(0);
    expect(stdout).toContain(String(actualCommandCount));
    expect(stdout).toContain(String(actualHandlerCount));
  });
});
