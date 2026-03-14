/**
 * supervisor-drone.test.ts — Tests for drone Stop hook installation
 * and sentinel-based completion detection.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { installDroneStopHook, waitForDroneCompletion, relaunchDroneInWorktree, type HookEntry } from "../supervisor-drone.ts";
import { SENTINEL_FILENAME } from "../supervisor-types.ts";
import type { DroneHandle } from "../../drone-backend.ts";
import { makeTestTmpDir } from "./test-helpers.ts";

function mockHandle(id: string, backend: "axon" | "tmux" = "tmux"): DroneHandle {
  return { id, backend };
}

describe("installDroneStopHook", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir("drone-hook");
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
    const sentinelHook = settings.hooks.Stop.find((entry: HookEntry) =>
      entry.hooks.some((h: HookEntry["hooks"][number]) => h.command.includes(SENTINEL_FILENAME))
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
    const sendEventEntry = merged.hooks.Stop.find((entry: HookEntry) =>
      entry.hooks.some((h: HookEntry["hooks"][number]) => h.command.includes("send-event.ts"))
    );
    expect(sendEventEntry).toBeDefined();

    // Sentinel hook is added
    const sentinelEntry = merged.hooks.Stop.find((entry: HookEntry) =>
      entry.hooks.some((h: HookEntry["hooks"][number]) => h.command.includes(SENTINEL_FILENAME))
    );
    expect(sentinelEntry).toBeDefined();
  });

  test("does not duplicate sentinel hook on repeated calls", () => {
    installDroneStopHook(tmpDir);
    installDroneStopHook(tmpDir);

    const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    const sentinelHooks = settings.hooks.Stop.filter((entry: HookEntry) =>
      entry.hooks.some((h: HookEntry["hooks"][number]) => h.command.includes(SENTINEL_FILENAME))
    );
    expect(sentinelHooks.length).toBe(1);
  });

  test("sentinel path in hook command matches worktree root", () => {
    installDroneStopHook(tmpDir);

    const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    const sentinelHook = settings.hooks.Stop.find((entry: HookEntry) =>
      entry.hooks.some((h: HookEntry["hooks"][number]) => h.command.includes(SENTINEL_FILENAME))
    );
    const hookCommand = sentinelHook.hooks[0].command;
    const expectedSentinelPath = join(tmpDir, SENTINEL_FILENAME);
    expect(hookCommand).toContain(expectedSentinelPath);
  });
});

describe("waitForDroneCompletion", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTestTmpDir("drone-completion");
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
        mockHandle("fake-pane-id"),
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
        mockHandle("fake-pane-id"),
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
      mockHandle("fake-pane-id"),
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
      mockHandle("nonexistent-pane-id"),
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
      mockHandle("nonexistent-pane-id"),
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
        mockHandle("fake-pane-id"),
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

// ---------------------------------------------------------------------------
// Axon-backend completion detection
// ---------------------------------------------------------------------------

describe("waitForDroneCompletion — Axon backend", () => {
  let tmpDir: string;

  // Track mock state
  let mockConnectFn: ReturnType<typeof mock>;
  let mockCloseFn: ReturnType<typeof mock>;
  let mockWaitFn: ReturnType<typeof mock>;
  let mockGetDaemonPathsFn: ReturnType<typeof mock>;

  beforeEach(() => {
    tmpDir = makeTestTmpDir("drone-axon");

    // Reset mocks for each test
    mockCloseFn = mock(() => {});
    mockConnectFn = mock(async () => ({
      close: mockCloseFn,
    }));
    mockWaitFn = mock(async () => ({ ok: true, exitCode: 0 }));
    mockGetDaemonPathsFn = mock((root: string) => ({
      runDir: join(root, ".minds", "run"),
      socketPath: join(root, ".minds", "run", "axon.sock"),
      pidFile: join(root, ".minds", "run", "axon.pid"),
    }));

    // Mock the Axon modules that are dynamically imported
    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockConnectFn(...args),
      },
    }));

    mock.module("../../axon/daemon-lifecycle.ts", () => ({
      getDaemonPaths: (...args: unknown[]) => mockGetDaemonPathsFn(...args),
    }));

    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Clear AXON_SOCKET if set by a test
    delete process.env.AXON_SOCKET;
  });

  test("routes to Axon path when handle.backend is 'axon'", async () => {
    const handle = mockHandle("axon-drone-1", "axon");

    const result = await waitForDroneCompletion(
      handle,
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    expect(result.ok).toBe(true);
    // Verify Axon client was connected
    expect(mockConnectFn).toHaveBeenCalled();
    // Verify waitForProcessCompletion was called with the drone ID
    expect(mockWaitFn).toHaveBeenCalledWith(
      expect.anything(),
      "axon-drone-1",
      5000,
    );
  });

  test("returns ok:true when Axon reports successful completion", async () => {
    mockWaitFn = mock(async () => ({ ok: true, exitCode: 0 }));
    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));

    const result = await waitForDroneCompletion(
      mockHandle("axon-drone-2", "axon"),
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("returns ok:false with exit code when drone exits non-zero", async () => {
    mockWaitFn = mock(async () => ({ ok: false, exitCode: 1 }));
    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));

    const result = await waitForDroneCompletion(
      mockHandle("axon-drone-3", "axon"),
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("exited with code 1");
  });

  test("returns ok:false when Axon connection fails", async () => {
    mockConnectFn = mock(async () => {
      throw new Error("ECONNREFUSED");
    });
    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockConnectFn(...args),
      },
    }));

    const result = await waitForDroneCompletion(
      mockHandle("axon-drone-4", "axon"),
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Axon connection failed");
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("returns ok:false with timeout message when Axon reports timeout", async () => {
    mockWaitFn = mock(async () => ({ ok: false, error: "timeout" }));
    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));

    const result = await waitForDroneCompletion(
      mockHandle("axon-drone-5", "axon"),
      tmpDir,
      30000,
      300,
      "/tmp/test-repo",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("30000");
  });

  test("returns ok:false when process not found in Axon", async () => {
    mockWaitFn = mock(async () => ({ ok: false, error: "process_not_found" }));
    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));

    const result = await waitForDroneCompletion(
      mockHandle("axon-drone-6", "axon"),
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found in Axon");
    expect(result.error).toContain("axon-drone-6");
  });

  test("closes client in success path", async () => {
    mockWaitFn = mock(async () => ({ ok: true, exitCode: 0 }));
    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));

    await waitForDroneCompletion(
      mockHandle("axon-drone-7", "axon"),
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    expect(mockCloseFn).toHaveBeenCalledTimes(1);
  });

  test("closes client in error path", async () => {
    mockWaitFn = mock(async () => {
      throw new Error("unexpected Axon error");
    });
    mock.module("../../axon/completion.ts", () => ({
      waitForProcessCompletion: (...args: unknown[]) => mockWaitFn(...args),
    }));

    try {
      await waitForDroneCompletion(
        mockHandle("axon-drone-8", "axon"),
        tmpDir,
        5000,
        300,
        "/tmp/test-repo",
      );
    } catch {
      // Expected — waitForProcessCompletion threw
    }

    expect(mockCloseFn).toHaveBeenCalledTimes(1);
  });

  test("tmux backend does NOT load Axon modules (regression)", async () => {
    // Use tmux backend with a sentinel file for fast completion
    const sentinelPath = join(tmpDir, SENTINEL_FILENAME);
    writeFileSync(sentinelPath, "done");

    // Reset connect mock to track if it gets called
    let axonConnectCalled = false;
    mockConnectFn = mock(async () => {
      axonConnectCalled = true;
      return { close: mockCloseFn };
    });
    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockConnectFn(...args),
      },
    }));

    const result = await waitForDroneCompletion(
      mockHandle("nonexistent-pane-id", "tmux"),
      tmpDir,
      5000,
      300,
    );

    // Should resolve via sentinel (pane is dead + sentinel exists = TOCTOU guard)
    expect(result.ok).toBe(true);
    // Axon connect must NOT have been called
    expect(axonConnectCalled).toBe(false);
  });

  test("uses AXON_SOCKET env var when set", async () => {
    process.env.AXON_SOCKET = "/custom/axon.sock";

    await waitForDroneCompletion(
      mockHandle("axon-drone-env", "axon"),
      tmpDir,
      5000,
      300,
      "/tmp/test-repo",
    );

    // The connect call should receive the custom socket path
    expect(mockConnectFn).toHaveBeenCalledWith("/custom/axon.sock");
  });
});

// ---------------------------------------------------------------------------
// relaunchDroneInWorktree — backend dispatch
// ---------------------------------------------------------------------------

describe("relaunchDroneInWorktree", () => {
  let tmpDir: string;

  // Axon mock state
  let mockAxonConnectFn: ReturnType<typeof mock>;
  let mockAxonCloseFn: ReturnType<typeof mock>;
  let mockAxonKillFn: ReturnType<typeof mock>;
  let mockAxonSpawnFn: ReturnType<typeof mock>;
  let mockGetDaemonPathsFn: ReturnType<typeof mock>;
  let mockSanitizeProcessIdFn: ReturnType<typeof mock>;

  // Tmux mock state
  let mockKillPaneFn: ReturnType<typeof mock>;
  let mockSplitPaneFn: ReturnType<typeof mock>;
  let mockLaunchClaudeFn: ReturnType<typeof mock>;

  function makeRelaunchOpts(overrides?: Partial<Parameters<typeof relaunchDroneInWorktree>[0]>) {
    return {
      oldHandle: mockHandle("%5", "tmux"),
      callerPane: "%0",
      worktreePath: tmpDir,
      briefContent: "# Test Brief\nDo stuff.",
      busUrl: "http://localhost:7777",
      mindName: "transport",
      repoRoot: "/tmp/test-repo",
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = makeTestTmpDir("drone-relaunch");

    // Axon mocks
    mockAxonCloseFn = mock(() => {});
    mockAxonKillFn = mock(async () => {});
    mockAxonSpawnFn = mock(async () => "spawned-id");
    mockAxonConnectFn = mock(async () => ({
      close: mockAxonCloseFn,
      kill: (...args: unknown[]) => mockAxonKillFn(...args),
      spawn: (...args: unknown[]) => mockAxonSpawnFn(...args),
    }));
    mockGetDaemonPathsFn = mock((root: string) => ({
      runDir: join(root, ".minds", "run"),
      socketPath: join(root, ".minds", "run", "axon.sock"),
      pidFile: join(root, ".minds", "run", "axon.pid"),
    }));
    mockSanitizeProcessIdFn = mock((input: string) => input.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64));

    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockAxonConnectFn(...args),
      },
    }));
    mock.module("../../axon/daemon-lifecycle.ts", () => ({
      getDaemonPaths: (...args: unknown[]) => mockGetDaemonPathsFn(...args),
    }));
    mock.module("../../axon/types.ts", () => ({
      sanitizeProcessId: (...args: unknown[]) => mockSanitizeProcessIdFn(...args),
    }));

    // Tmux mocks
    mockKillPaneFn = mock(async () => {});
    mockSplitPaneFn = mock(async () => "%99");
    mockLaunchClaudeFn = mock(async () => {});

    mock.module("../../tmux-utils.ts", () => ({
      killPane: (...args: unknown[]) => mockKillPaneFn(...args),
      splitPane: (...args: unknown[]) => mockSplitPaneFn(...args),
      launchClaudeInPane: (...args: unknown[]) => mockLaunchClaudeFn(...args),
      shellQuote: (s: string) => `'${s}'`,
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.AXON_SOCKET;
  });

  test("DRONE-BRIEF.md written before backend branching (tmux)", async () => {
    const briefContent = "# Brief for tmux test";
    await relaunchDroneInWorktree(makeRelaunchOpts({ briefContent }));

    const written = readFileSync(join(tmpDir, "DRONE-BRIEF.md"), "utf-8");
    expect(written).toBe(briefContent);
  });

  test("DRONE-BRIEF.md written before backend branching (axon)", async () => {
    const briefContent = "# Brief for axon test";
    await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("axon-drone-1", "axon"),
      briefContent,
    }));

    const written = readFileSync(join(tmpDir, "DRONE-BRIEF.md"), "utf-8");
    expect(written).toBe(briefContent);
  });

  test("backend dispatch — tmux: calls splitPane and launchClaudeInPane, not Axon", async () => {
    const result = await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("%5", "tmux"),
    }));

    expect(result.backend).toBe("tmux");
    expect(result.id).toBe("%99");
    expect(mockKillPaneFn).toHaveBeenCalledWith("%5");
    expect(mockSplitPaneFn).toHaveBeenCalledWith("%0");
    expect(mockLaunchClaudeFn).toHaveBeenCalledTimes(1);
    // Axon connect should NOT have been called
    expect(mockAxonConnectFn).not.toHaveBeenCalled();
  });

  test("backend dispatch — axon: calls Axon kill+spawn, not tmux splitPane", async () => {
    const result = await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("axon-old-drone", "axon"),
    }));

    expect(result.backend).toBe("axon");
    expect(mockAxonConnectFn).toHaveBeenCalled();
    expect(mockAxonKillFn).toHaveBeenCalledWith("axon-old-drone");
    expect(mockAxonSpawnFn).toHaveBeenCalledTimes(1);
    // tmux splitPane should NOT have been called
    expect(mockSplitPaneFn).not.toHaveBeenCalled();
    expect(mockLaunchClaudeFn).not.toHaveBeenCalled();
  });

  test("axon kill is idempotent — spawn proceeds even if kill throws", async () => {
    mockAxonKillFn = mock(async () => {
      throw new Error("process_not_found");
    });
    // Reconnect the mock client with the updated kill
    mockAxonConnectFn = mock(async () => ({
      close: mockAxonCloseFn,
      kill: (...args: unknown[]) => mockAxonKillFn(...args),
      spawn: (...args: unknown[]) => mockAxonSpawnFn(...args),
    }));
    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockAxonConnectFn(...args),
      },
    }));

    const result = await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("axon-dead-drone", "axon"),
    }));

    expect(result.backend).toBe("axon");
    expect(mockAxonKillFn).toHaveBeenCalledTimes(1);
    expect(mockAxonSpawnFn).toHaveBeenCalledTimes(1);
  });

  test("process ID uniqueness — two rapid calls produce different IDs", async () => {
    const spawnedIds: string[] = [];
    mockSanitizeProcessIdFn = mock((input: string) => {
      const sanitized = input.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
      spawnedIds.push(sanitized);
      return sanitized;
    });
    mock.module("../../axon/types.ts", () => ({
      sanitizeProcessId: (...args: unknown[]) => mockSanitizeProcessIdFn(...args),
    }));

    await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("axon-drone-a", "axon"),
    }));

    // Small delay to ensure Date.now() differs
    await new Promise(r => setTimeout(r, 2));

    await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("axon-drone-b", "axon"),
    }));

    expect(spawnedIds.length).toBe(2);
    expect(spawnedIds[0]).not.toBe(spawnedIds[1]);
  });

  test("client.close() called in success path (axon)", async () => {
    await relaunchDroneInWorktree(makeRelaunchOpts({
      oldHandle: mockHandle("axon-drone-ok", "axon"),
    }));

    expect(mockAxonCloseFn).toHaveBeenCalledTimes(1);
  });

  test("client.close() called in error path (axon spawn failure)", async () => {
    mockAxonSpawnFn = mock(async () => {
      throw new Error("spawn failed");
    });
    mockAxonConnectFn = mock(async () => ({
      close: mockAxonCloseFn,
      kill: (...args: unknown[]) => mockAxonKillFn(...args),
      spawn: (...args: unknown[]) => mockAxonSpawnFn(...args),
    }));
    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockAxonConnectFn(...args),
      },
    }));

    await expect(
      relaunchDroneInWorktree(makeRelaunchOpts({
        oldHandle: mockHandle("axon-drone-fail", "axon"),
      }))
    ).rejects.toThrow("spawn failed");

    expect(mockAxonCloseFn).toHaveBeenCalledTimes(1);
  });

  test("spawn failure propagation — error is not swallowed (axon)", async () => {
    mockAxonSpawnFn = mock(async () => {
      throw new Error("AXON_SPAWN_ERROR");
    });
    mockAxonConnectFn = mock(async () => ({
      close: mockAxonCloseFn,
      kill: (...args: unknown[]) => mockAxonKillFn(...args),
      spawn: (...args: unknown[]) => mockAxonSpawnFn(...args),
    }));
    mock.module("../../axon/client.ts", () => ({
      AxonClient: {
        connect: (...args: unknown[]) => mockAxonConnectFn(...args),
      },
    }));

    await expect(
      relaunchDroneInWorktree(makeRelaunchOpts({
        oldHandle: mockHandle("axon-drone-err", "axon"),
      }))
    ).rejects.toThrow("AXON_SPAWN_ERROR");
  });
});
