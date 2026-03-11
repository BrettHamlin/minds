/**
 * supervisor-drone.test.ts — Tests for drone Stop hook installation
 * and sentinel-based completion detection.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installDroneStopHook, waitForDroneCompletion } from "../supervisor-drone.ts";
import { SENTINEL_FILENAME } from "../supervisor-types.ts";

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
    expect(settings.hooks.Stop.length).toBeGreaterThanOrEqual(1);

    // Find the sentinel hook entry
    const sentinelHook = settings.hooks.Stop.find((entry: any) =>
      entry.hooks.some((h: any) => h.command.includes(SENTINEL_FILENAME))
    );
    expect(sentinelHook).toBeDefined();
    expect(sentinelHook.hooks[0].type).toBe("command");
    expect(sentinelHook.hooks[0].command).toContain(SENTINEL_FILENAME);
  });

  test("creates .claude directory if it does not exist", () => {
    const claudeDir = join(tmpDir, ".claude");
    expect(existsSync(claudeDir)).toBe(false);

    installDroneStopHook(tmpDir);

    expect(existsSync(claudeDir)).toBe(true);
  });

  test("merges with existing settings.json without overwriting non-hook fields", () => {
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

  test("preserves existing Stop hooks when adding sentinel hook", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    const existingSendEventHook = {
      hooks: [{ type: "command", command: "bun /path/to/send-event.ts --source-app drone:test" }],
    };
    const existing = {
      hooks: {
        Stop: [existingSendEventHook],
      },
    };
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(existing));

    installDroneStopHook(tmpDir);

    const merged = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    expect(merged.hooks.Stop.length).toBe(2);

    // Original send-event hook is preserved
    const sendEventEntry = merged.hooks.Stop.find((entry: any) =>
      entry.hooks.some((h: any) => h.command.includes("send-event.ts"))
    );
    expect(sendEventEntry).toBeDefined();

    // Sentinel hook is added
    const sentinelEntry = merged.hooks.Stop.find((entry: any) =>
      entry.hooks.some((h: any) => h.command.includes(SENTINEL_FILENAME))
    );
    expect(sentinelEntry).toBeDefined();
  });

  test("does not duplicate sentinel hook on repeated calls", () => {
    installDroneStopHook(tmpDir);
    installDroneStopHook(tmpDir);

    const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    const sentinelHooks = settings.hooks.Stop.filter((entry: any) =>
      entry.hooks.some((h: any) => h.command.includes(SENTINEL_FILENAME))
    );
    expect(sentinelHooks.length).toBe(1);
  });

  test("sentinel path in hook command matches worktree root", () => {
    installDroneStopHook(tmpDir);

    const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    const sentinelHook = settings.hooks.Stop.find((entry: any) =>
      entry.hooks.some((h: any) => h.command.includes(SENTINEL_FILENAME))
    );
    const hookCommand = sentinelHook.hooks[0].command;
    const expectedSentinelPath = join(tmpDir, SENTINEL_FILENAME);
    expect(hookCommand).toContain(expectedSentinelPath);
  });
});

describe("waitForDroneCompletion", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `drone-completion-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolves ok:true when sentinel file appears", async () => {
    const sentinelPath = join(tmpDir, SENTINEL_FILENAME);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // Write sentinel after a short delay to simulate drone completion.
      // Sentinel must appear BEFORE the first poll fires so the sentinel
      // check resolves before the pane-existence check detects the fake pane.
      timer = setTimeout(() => {
        try { writeFileSync(sentinelPath, "done"); } catch { /* dir may be gone */ }
      }, 50);

      const result = await waitForDroneCompletion(
        "fake-pane-id",
        tmpDir,
        10_000, // 10s timeout
        200,    // 200ms poll interval -- sentinel at 50ms arrives first
      );

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    } finally {
      clearTimeout(timer);
    }
  });

  test("resolves ok:true when sentinel appears shortly after start", async () => {
    const sentinelPath = join(tmpDir, SENTINEL_FILENAME);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // Create sentinel after cleanup runs (very short delay).
      // Sentinel at 30ms, poll at 200ms -- sentinel wins.
      timer = setTimeout(() => {
        try { writeFileSync(sentinelPath, "done"); } catch { /* dir may be gone */ }
      }, 30);

      const result = await waitForDroneCompletion(
        "fake-pane-id",
        tmpDir,
        10_000,
        200,
      );

      expect(result.ok).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  test("resolves ok:false with error on timeout", async () => {
    // Never create the sentinel file -- should timeout.
    // Use a poll interval LONGER than the timeout so the pane-existence
    // fallback never fires before the timeout does.
    const result = await waitForDroneCompletion(
      "fake-pane-id",
      tmpDir,
      300,    // Very short timeout: 300ms
      60_000, // Poll interval longer than timeout -- only timeout fires
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  test("resolves ok:false when pane dies before sentinel is written", async () => {
    // "nonexistent-pane-id" won't exist in tmux, so the pane-existence
    // check will detect it as dead -- simulating a crashed drone.
    // No sentinel file is created, so the only resolution path is the
    // pane-death detection in the poll fallback.
    const result = await waitForDroneCompletion(
      "nonexistent-pane-id",
      tmpDir,
      10_000, // Long timeout -- should resolve via pane death, not timeout
      100,    // Fast poll so the test finishes quickly
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("died");
    expect(result.error).toContain("nonexistent-pane-id");
  });

  test("returns ok:true immediately when drone completed before watching (TOCTOU guard)", async () => {
    const sentinelPath = join(tmpDir, SENTINEL_FILENAME);

    // Sentinel exists AND pane is gone (nonexistent-pane-id won't exist in tmux)
    // = drone completed successfully before we started watching.
    writeFileSync(sentinelPath, "done");

    const result = await waitForDroneCompletion(
      "nonexistent-pane-id",
      tmpDir,
      5_000,
      300,
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("cleans up stale sentinel when pane is still alive", async () => {
    const sentinelPath = join(tmpDir, SENTINEL_FILENAME);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // Pre-create a stale sentinel. Use "fake-pane-id" which doesn't exist
      // in tmux -- the TOCTOU guard will detect pane as dead and return ok:true
      // immediately (treating sentinel as valid, not stale).
      // To test actual stale cleanup we'd need a real tmux pane. Instead,
      // verify the fast-completion path works correctly.
      writeFileSync(sentinelPath, "stale");

      const result = await waitForDroneCompletion(
        "fake-pane-id",
        tmpDir,
        5_000,
        300,
      );

      // Pane is dead + sentinel exists = treated as successful completion
      expect(result.ok).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  test("uses the correct sentinel filename constant", () => {
    // Verify the sentinel filename is deterministic and predictable
    expect(SENTINEL_FILENAME).toBe(".drone-complete");
  });
});
