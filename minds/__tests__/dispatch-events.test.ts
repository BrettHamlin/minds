/**
 * dispatch-events.test.ts — Verify WAVE_STARTED, WAVE_COMPLETE, DRONE_SPAWNED
 * event emission in dispatch.ts.
 *
 * Strategy:
 *   - mock.module() intercepts mindsPublish before any import loads dispatch.ts
 *   - Bun.spawn is overridden per-test to return fake drone-pane + tmux-send output
 *   - dispatchWave is called with timeoutMs: 0 so waitForCompletion returns immediately
 *     (bus mode — no real bus needed)
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── Capture published events ─────────────────────────────────────────────────

type PublishCall = { busUrl: string; channel: string; type: string; payload: unknown };
const publishCalls: PublishCall[] = [];

mock.module("../../minds/transport/minds-publish.ts", () => ({
  mindsPublish: async (busUrl: string, channel: string, type: string, payload: unknown) => {
    publishCalls.push({ busUrl, channel, type, payload });
  },
  resolveBusUrl: () => undefined,
}));

// ─── Import dispatch after mock registration ──────────────────────────────────

const { dispatchWave } = await import("../../minds/dispatch.ts");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), "dispatch-events-tests");

function makeDronePaneOutput(paneId: string, worktree: string, branch: string): string {
  return JSON.stringify({ drone_pane: paneId, worktree, branch });
}

function makeFakeProcess(stdoutText: string, exitCode = 0) {
  const encoder = new TextEncoder();
  const stdout = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(stdoutText));
      controller.close();
    },
  });
  const stderr = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
  return { stdout, stderr, exited: Promise.resolve(exitCode) };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const FAKE_MINDS_JSON = JSON.stringify([
  {
    name: "signals",
    domain: "Signal emission",
    owns_files: ["minds/signals/"],
    capabilities: [],
    exposes: [],
    consumes: [],
  },
  {
    name: "pipeline_core",
    domain: "Pipeline core",
    owns_files: ["minds/pipeline_core/"],
    capabilities: [],
    exposes: [],
    consumes: [],
  },
]);

const BUS_URL = "http://localhost:7777";
const TICKET_ID = "TEST-001";
const CHANNEL = `minds-${TICKET_ID}`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("dispatchWave — event emission", () => {
  let repoRoot: string;
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    publishCalls.length = 0;
    repoRoot = join(TMP, `repo-${Date.now()}`);
    mkdirSync(join(repoRoot, ".collab"), { recursive: true });
    writeFileSync(join(repoRoot, ".collab", "minds.json"), FAKE_MINDS_JSON);

    // Save original spawn
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    // Restore Bun.spawn
    (Bun as Record<string, unknown>).spawn = originalSpawn;
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  });

  it("publishes WAVE_STARTED with waveId before dispatching", async () => {
    // Mock Bun.spawn: drone-pane returns JSON, tmux-send returns empty
    let spawnCall = 0;
    (Bun as Record<string, unknown>).spawn = (cmd: string[], _opts: unknown) => {
      spawnCall++;
      const cmdStr = cmd.join(" ");
      if (cmdStr.includes("drone-pane")) {
        return makeFakeProcess(makeDronePaneOutput("%test-pane-1", "/tmp/wt-1", "TEST-001-signals"));
      }
      // tmux-send or anything else
      return makeFakeProcess("");
    };

    await dispatchWave(["signals"], { signals: "brief text" }, {
      dispatch: { repoRoot, busUrl: BUS_URL, ticketId: TICKET_ID },
      // timeoutMs: 0 causes waitForCompletion (bus mode) to return immediately
      wait: { timeoutMs: 0, busUrl: BUS_URL, channel: CHANNEL },
      ticketId: TICKET_ID,
    });

    const waveStarted = publishCalls.find((c) => c.type === "WAVE_STARTED");
    expect(waveStarted).toBeDefined();
    expect((waveStarted!.payload as Record<string, unknown>).waveId).toMatch(/^wave-\d+$/);
    expect(waveStarted!.channel).toBe(CHANNEL);
    expect(waveStarted!.busUrl).toBe(BUS_URL);
  });

  it("publishes WAVE_COMPLETE with the same waveId as WAVE_STARTED", async () => {
    (Bun as Record<string, unknown>).spawn = (cmd: string[], _opts: unknown) => {
      const cmdStr = cmd.join(" ");
      if (cmdStr.includes("drone-pane")) {
        return makeFakeProcess(makeDronePaneOutput("%test-pane-2", "/tmp/wt-2", "TEST-001-signals"));
      }
      return makeFakeProcess("");
    };

    await dispatchWave(["signals"], { signals: "brief text" }, {
      dispatch: { repoRoot, busUrl: BUS_URL, ticketId: TICKET_ID },
      wait: { timeoutMs: 0, busUrl: BUS_URL, channel: CHANNEL },
      ticketId: TICKET_ID,
    });

    const waveStarted = publishCalls.find((c) => c.type === "WAVE_STARTED");
    const waveComplete = publishCalls.find((c) => c.type === "WAVE_COMPLETE");

    expect(waveStarted).toBeDefined();
    expect(waveComplete).toBeDefined();

    const startWaveId = (waveStarted!.payload as Record<string, unknown>).waveId;
    const completeWaveId = (waveComplete!.payload as Record<string, unknown>).waveId;
    expect(startWaveId).toBe(completeWaveId);
  });

  it("WAVE_STARTED is published before DRONE_SPAWNED", async () => {
    (Bun as Record<string, unknown>).spawn = (cmd: string[], _opts: unknown) => {
      const cmdStr = cmd.join(" ");
      if (cmdStr.includes("drone-pane")) {
        return makeFakeProcess(makeDronePaneOutput("%pane-3", "/tmp/wt-3", "TEST-001-signals"));
      }
      return makeFakeProcess("");
    };

    await dispatchWave(["signals"], { signals: "brief text" }, {
      dispatch: { repoRoot, busUrl: BUS_URL, ticketId: TICKET_ID },
      wait: { timeoutMs: 0, busUrl: BUS_URL, channel: CHANNEL },
      ticketId: TICKET_ID,
    });

    const indices = {
      WAVE_STARTED: publishCalls.findIndex((c) => c.type === "WAVE_STARTED"),
      DRONE_SPAWNED: publishCalls.findIndex((c) => c.type === "DRONE_SPAWNED"),
      WAVE_COMPLETE: publishCalls.findIndex((c) => c.type === "WAVE_COMPLETE"),
    };

    expect(indices.WAVE_STARTED).toBeGreaterThanOrEqual(0);
    expect(indices.DRONE_SPAWNED).toBeGreaterThan(indices.WAVE_STARTED);
    expect(indices.WAVE_COMPLETE).toBeGreaterThan(indices.DRONE_SPAWNED);
  });

  it("DRONE_SPAWNED payload contains waveId, paneId, worktree, branch — not brief", async () => {
    const fakePaneId = "%pane-signals-42";
    const fakeWorktree = "/tmp/collab-TEST-001-signals";
    const fakeBranch = "TEST-001-signals";

    (Bun as Record<string, unknown>).spawn = (cmd: string[], _opts: unknown) => {
      const cmdStr = cmd.join(" ");
      if (cmdStr.includes("drone-pane")) {
        return makeFakeProcess(makeDronePaneOutput(fakePaneId, fakeWorktree, fakeBranch));
      }
      return makeFakeProcess("");
    };

    await dispatchWave(["signals"], { signals: "this is the brief" }, {
      dispatch: { repoRoot, busUrl: BUS_URL, ticketId: TICKET_ID },
      wait: { timeoutMs: 0, busUrl: BUS_URL, channel: CHANNEL },
      ticketId: TICKET_ID,
    });

    const spawned = publishCalls.find((c) => c.type === "DRONE_SPAWNED");
    expect(spawned).toBeDefined();

    const payload = spawned!.payload as Record<string, unknown>;
    expect(payload.paneId).toBe(fakePaneId);
    expect(payload.worktree).toBe(fakeWorktree);
    expect(payload.branch).toBe(fakeBranch);
    expect(payload.waveId).toMatch(/^wave-\d+$/);
    // brief must NOT be in the payload
    expect(payload.brief).toBeUndefined();
  });

  it("DRONE_SPAWNED waveId matches WAVE_STARTED waveId", async () => {
    (Bun as Record<string, unknown>).spawn = (cmd: string[], _opts: unknown) => {
      const cmdStr = cmd.join(" ");
      if (cmdStr.includes("drone-pane")) {
        return makeFakeProcess(makeDronePaneOutput("%pane-4", "/tmp/wt-4", "TEST-001-signals"));
      }
      return makeFakeProcess("");
    };

    await dispatchWave(["signals"], { signals: "brief" }, {
      dispatch: { repoRoot, busUrl: BUS_URL, ticketId: TICKET_ID },
      wait: { timeoutMs: 0, busUrl: BUS_URL, channel: CHANNEL },
      ticketId: TICKET_ID,
    });

    const waveStarted = publishCalls.find((c) => c.type === "WAVE_STARTED");
    const spawned = publishCalls.find((c) => c.type === "DRONE_SPAWNED");

    const startWaveId = (waveStarted!.payload as Record<string, unknown>).waveId;
    const spawnedWaveId = (spawned!.payload as Record<string, unknown>).waveId;
    expect(spawnedWaveId).toBe(startWaveId);
  });
});
