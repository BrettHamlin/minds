/**
 * supervisor-drone.test.ts — Tests for bus-based drone completion detection
 * and drone re-launch backend dispatch.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { waitForDroneCompletion, relaunchDroneInWorktree } from "../supervisor-drone.ts";
import type { DroneHandle } from "../../drone-backend.ts";
import { makeTestTmpDir } from "./test-helpers.ts";

function mockHandle(id: string, backend: "axon" | "tmux" = "tmux"): DroneHandle {
  return { id, backend };
}

// ---------------------------------------------------------------------------
// Bus-based completion detection (sole mechanism)
// ---------------------------------------------------------------------------

describe("waitForDroneCompletion — bus-based", () => {
  let tmpDir: string;
  let busServer: ReturnType<typeof import("../../../transport/bus-server.ts").createServer>;
  let busUrl: string;

  beforeEach(async () => {
    tmpDir = makeTestTmpDir("drone-bus");
    const { createServer } = await import("../../../transport/bus-server.ts");
    busServer = createServer({ port: 0 });
    busUrl = `http://localhost:${busServer.port}`;
  });

  afterEach(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    busServer.stop(true);
  });

  async function publishHookStop(channel: string, source: string): Promise<void> {
    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, from: "minds", type: "HOOK_Stop", payload: { source } }),
    });
  }

  test("resolves ok:true when HOOK_Stop received from matching drone", async () => {
    const channel = "minds-BRE-668";
    setTimeout(() => publishHookStop(channel, "drone:transport"), 50);

    const result = await waitForDroneCompletion(
      mockHandle("pane-1"),
      tmpDir,
      10_000,
      undefined,
      undefined,
      busUrl,
      channel,
      "transport",
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("resolves ok:false on timeout when no HOOK_Stop arrives", async () => {
    const channel = "minds-BRE-668";
    const result = await waitForDroneCompletion(
      mockHandle("pane-1"),
      tmpDir,
      300, // short timeout
      undefined,
      undefined,
      busUrl,
      channel,
      "transport",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  test("ignores HOOK_Stop from a different drone (mindName filter)", async () => {
    const channel = "minds-BRE-668";
    // Publish HOOK_Stop from a different drone — should not trigger completion
    await publishHookStop(channel, "drone:other-mind");
    await new Promise(r => setTimeout(r, 20));

    const result = await waitForDroneCompletion(
      mockHandle("pane-1"),
      tmpDir,
      300, // short timeout — we expect this to time out
      undefined,
      undefined,
      busUrl,
      channel,
      "transport", // waiting for "transport", not "other-mind"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  test("resolves ok:true when HOOK_Stop already in ring buffer (fast drone)", async () => {
    const channel = "minds-BRE-668";
    // Publish BEFORE subscribing — simulates drone completing before we start waiting
    await publishHookStop(channel, "drone:transport");
    await new Promise(r => setTimeout(r, 10)); // let buffer settle

    const result = await waitForDroneCompletion(
      mockHandle("pane-1"),
      tmpDir,
      5_000,
      undefined,
      undefined,
      busUrl,
      channel,
      "transport",
    );

    expect(result.ok).toBe(true);
  });

  test("accepts HOOK_Stop without mindName filter when mindName is empty", async () => {
    const channel = "minds-BRE-668";
    setTimeout(() => publishHookStop(channel, "drone:any-mind"), 50);

    const result = await waitForDroneCompletion(
      mockHandle("pane-1"),
      tmpDir,
      5_000,
      undefined,
      undefined,
      busUrl,
      channel,
      "", // no mindName filter
    );

    expect(result.ok).toBe(true);
  });

  test("returns error when busUrl not provided", async () => {
    const result = await waitForDroneCompletion(
      mockHandle("pane-1"),
      tmpDir,
      5_000,
      300,
      // no busUrl/channel — should return error
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Bus URL and channel are required");
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
    // killPane is NOT called — the pane is already dead (tmux display-message fails in test env)
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
