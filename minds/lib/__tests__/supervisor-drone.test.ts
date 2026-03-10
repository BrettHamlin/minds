/**
 * supervisor-drone.test.ts — Tests for drone Stop hook installation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installDroneStopHook } from "../supervisor-drone.ts";

describe("installDroneStopHook", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `drone-hook-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates .claude/settings.json with Stop hook", () => {
    installDroneStopHook(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].type).toBe("command");
    expect(settings.hooks.Stop[0].hooks[0].command).toContain(".drone-complete");
  });

  test("creates .claude directory if it does not exist", () => {
    const claudeDir = join(tmpDir, ".claude");
    expect(existsSync(claudeDir)).toBe(false);

    installDroneStopHook(tmpDir);

    expect(existsSync(claudeDir)).toBe(true);
  });

  test("merges with existing settings.json without overwriting", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    const existing = {
      customField: "preserved",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
      },
    };
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(existing));

    installDroneStopHook(tmpDir);

    const merged = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    expect(merged.customField).toBe("preserved");
    expect(merged.hooks.Stop).toBeDefined();
    expect(merged.hooks.PreToolUse).toBeDefined();
  });

  test("sentinel path in hook command matches worktree root", () => {
    installDroneStopHook(tmpDir);

    const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    const hookCommand = settings.hooks.Stop[0].hooks[0].command;
    const expectedSentinelPath = join(tmpDir, ".drone-complete");
    expect(hookCommand).toContain(expectedSentinelPath);
  });
});
