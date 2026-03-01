import { describe, test, expect, afterEach } from "bun:test";
import { createTempGitRepo, createTempDir, cleanupTempDir, runCLI } from "../helpers";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

describe("collab update", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      cleanupTempDir(dir);
    }
    dirs.length = 0;
  });

  test("exits with code 1 in repo without collab installation", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    const { exitCode, stderr } = runCLI("update", dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No collab installation found");
  });

  test("reports already up to date when version matches", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Update with same version
    const { exitCode, stdout } = runCLI("update", dir);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain("already up to date");
  });

  test("updates files when version differs", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Manually change the installed version to simulate an older version
    const versionPath = join(dir, ".collab/version.json");
    const versionData = JSON.parse(readFileSync(versionPath, "utf-8"));
    versionData.version = "0.0.1";
    writeFileSync(versionPath, JSON.stringify(versionData, null, 2));

    // Update
    const { exitCode, stdout } = runCLI("update", dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Update complete");
  });

  test("preserves user-customizable files during update", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Customize settings file
    const settingsPath = join(dir, ".claude/settings.json");
    if (existsSync(settingsPath)) {
      writeFileSync(settingsPath, JSON.stringify({ myCustomSetting: "keep-me" }));
    }

    // Change version to trigger update
    const versionPath = join(dir, ".collab/version.json");
    const versionData = JSON.parse(readFileSync(versionPath, "utf-8"));
    versionData.version = "0.0.1";
    writeFileSync(versionPath, JSON.stringify(versionData, null, 2));

    // Update (without --force, settings should be preserved)
    runCLI("update", dir);

    if (existsSync(settingsPath)) {
      const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(content.myCustomSetting).toBe("keep-me");
    }
  });

  test("updates version.json with previousVersion", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Change version to simulate older install
    const versionPath = join(dir, ".collab/version.json");
    const versionData = JSON.parse(readFileSync(versionPath, "utf-8"));
    versionData.version = "0.0.9";
    writeFileSync(versionPath, JSON.stringify(versionData, null, 2));

    // Update
    runCLI("update", dir);

    const updated = JSON.parse(readFileSync(versionPath, "utf-8"));
    expect(updated.version).toBe("0.1.0");
    expect(updated.previousVersion).toBe("0.0.9");
  });

  test("preserves original installedAt timestamp", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    const versionPath = join(dir, ".collab/version.json");
    const original = JSON.parse(readFileSync(versionPath, "utf-8"));
    const originalInstalledAt = original.installedAt;

    // Change version to simulate older install
    original.version = "0.0.1";
    writeFileSync(versionPath, JSON.stringify(original, null, 2));

    // Update
    runCLI("update", dir);

    const updated = JSON.parse(readFileSync(versionPath, "utf-8"));
    expect(updated.installedAt).toBe(originalInstalledAt);
    // updatedAt should be different (newer)
    expect(updated.updatedAt).not.toBe(original.updatedAt);
  });

  test("--dry-run shows changes without applying", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Change version
    const versionPath = join(dir, ".collab/version.json");
    const versionData = JSON.parse(readFileSync(versionPath, "utf-8"));
    const oldVersion = "0.0.1";
    versionData.version = oldVersion;
    writeFileSync(versionPath, JSON.stringify(versionData, null, 2));

    // Dry run
    const { exitCode, stdout } = runCLI("update --dry-run", dir);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain("would update");

    // Verify version was NOT changed
    const afterDryRun = JSON.parse(readFileSync(versionPath, "utf-8"));
    expect(afterDryRun.version).toBe(oldVersion);
  });

  test("--force updates even when version matches", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Install first
    runCLI("init --skip-verify", dir);

    // Force update with same version
    const { exitCode, stdout } = runCLI("update --force", dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Update complete");
  });
});
