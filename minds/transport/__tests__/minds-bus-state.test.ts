// minds-bus-state.test.ts — Tests for MindsBusState helpers (BRE-446)
//
// Covers: writeBusState/readBusState round-trip, clearBusState removes file,
// orphan detection with dead PIDs, injectBusEnv, and teardown CLI reading state.

import { describe, test, expect, afterEach } from "bun:test";
import * as path from "path";
import * as os from "os";
import { promises as fs } from "fs";
import {
  writeBusState,
  readBusState,
  clearBusState,
  findOrphanedBusStates,
  injectBusEnv,
  teardownMindsBus,
  type MindsBusState,
} from "../minds-bus-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minds-bus-state-test-"));
  // Create .minds/state subdirectory structure
  await fs.mkdir(path.join(dir, ".minds", "state"), { recursive: true });
  return dir;
}

const SAMPLE_STATE: Omit<MindsBusState, "ticketId"> = {
  busUrl: "http://localhost:7788",
  busServerPid: 11111,
  bridgePid: 22222,
  startedAt: "2026-03-08T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// writeBusState / readBusState round-trip
// ---------------------------------------------------------------------------

describe("writeBusState and readBusState", () => {
  test("round-trips all fields correctly", async () => {
    const repoRoot = await makeTempDir();
    const state: MindsBusState = { ...SAMPLE_STATE, ticketId: "BRE-446" };

    await writeBusState(repoRoot, state);
    const result = await readBusState(repoRoot, "BRE-446");

    expect(result).not.toBeNull();
    expect(result!.busUrl).toBe(state.busUrl);
    expect(result!.busServerPid).toBe(state.busServerPid);
    expect(result!.bridgePid).toBe(state.bridgePid);
    expect(result!.ticketId).toBe(state.ticketId);
    expect(result!.startedAt).toBe(state.startedAt);

    await fs.rm(repoRoot, { recursive: true });
  });

  test("returns null when state file does not exist", async () => {
    const repoRoot = await makeTempDir();
    const result = await readBusState(repoRoot, "BRE-NONEXISTENT");
    expect(result).toBeNull();
    await fs.rm(repoRoot, { recursive: true });
  });

  test("creates .minds/state directory if missing", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "minds-bus-mkdir-test-"));
    // Do NOT pre-create .minds/state
    const state: MindsBusState = { ...SAMPLE_STATE, ticketId: "BRE-MKDIR" };

    await writeBusState(repoRoot, state);

    const statePath = path.join(repoRoot, ".minds", "state", "minds-bus-BRE-MKDIR.json");
    const exists = await fs.access(statePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await fs.rm(repoRoot, { recursive: true });
  });

  test("state file path is .minds/state/minds-bus-{ticketId}.json", async () => {
    const repoRoot = await makeTempDir();
    const state: MindsBusState = { ...SAMPLE_STATE, ticketId: "BRE-PATH-CHECK" };

    await writeBusState(repoRoot, state);

    const expectedPath = path.join(repoRoot, ".minds", "state", "minds-bus-BRE-PATH-CHECK.json");
    const raw = await fs.readFile(expectedPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.ticketId).toBe("BRE-PATH-CHECK");

    await fs.rm(repoRoot, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// clearBusState
// ---------------------------------------------------------------------------

describe("clearBusState", () => {
  test("removes the state file", async () => {
    const repoRoot = await makeTempDir();
    const state: MindsBusState = { ...SAMPLE_STATE, ticketId: "BRE-CLEAR" };

    await writeBusState(repoRoot, state);
    const beforeClear = await readBusState(repoRoot, "BRE-CLEAR");
    expect(beforeClear).not.toBeNull();

    await clearBusState(repoRoot, "BRE-CLEAR");

    const afterClear = await readBusState(repoRoot, "BRE-CLEAR");
    expect(afterClear).toBeNull();

    await fs.rm(repoRoot, { recursive: true });
  });

  test("does not throw if file does not exist", async () => {
    const repoRoot = await makeTempDir();
    await expect(clearBusState(repoRoot, "BRE-NEVER-EXISTED")).resolves.toBeUndefined();
    await fs.rm(repoRoot, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// findOrphanedBusStates
// ---------------------------------------------------------------------------

describe("findOrphanedBusStates", () => {
  test("returns entries whose PIDs are dead", async () => {
    const repoRoot = await makeTempDir();

    // Use PID 1 (always alive) and a definitely-dead PID
    const deadPid = 2147483647; // max i32, very unlikely to be alive

    const state: MindsBusState = {
      busUrl: "http://localhost:7799",
      busServerPid: deadPid,
      bridgePid: deadPid,
      ticketId: "BRE-ORPHAN",
      startedAt: "2026-01-01T00:00:00.000Z",
    };

    await writeBusState(repoRoot, state);

    const orphans = await findOrphanedBusStates(repoRoot);
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    const found = orphans.find((o) => o.ticketId === "BRE-ORPHAN");
    expect(found).toBeDefined();

    await fs.rm(repoRoot, { recursive: true });
  });

  test("does not include entries whose PIDs are alive", async () => {
    const repoRoot = await makeTempDir();

    // Use the current process PID — definitely alive
    const alivePid = process.pid;

    const state: MindsBusState = {
      busUrl: "http://localhost:7800",
      busServerPid: alivePid,
      bridgePid: alivePid,
      ticketId: "BRE-ALIVE",
      startedAt: "2026-01-01T00:00:00.000Z",
    };

    await writeBusState(repoRoot, state);

    const orphans = await findOrphanedBusStates(repoRoot);
    const found = orphans.find((o) => o.ticketId === "BRE-ALIVE");
    expect(found).toBeUndefined();

    await fs.rm(repoRoot, { recursive: true });
  });

  test("returns empty array when .minds/state does not exist", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "minds-bus-no-state-"));
    const orphans = await findOrphanedBusStates(repoRoot);
    expect(orphans).toEqual([]);
    await fs.rm(repoRoot, { recursive: true });
  });

  test("skips malformed JSON files without throwing", async () => {
    const repoRoot = await makeTempDir();
    const badFile = path.join(repoRoot, ".minds", "state", "minds-bus-BRE-BAD.json");
    await fs.writeFile(badFile, "not valid json");

    const orphans = await findOrphanedBusStates(repoRoot);
    // Should not throw; malformed file skipped
    expect(Array.isArray(orphans)).toBe(true);

    await fs.rm(repoRoot, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// injectBusEnv
// ---------------------------------------------------------------------------

describe("injectBusEnv", () => {
  test("injects BUS_URL before claude --dangerously-skip-permissions", () => {
    const cmd = "claude --dangerously-skip-permissions";
    const result = injectBusEnv(cmd, "http://localhost:9000");
    expect(result).toBe("BUS_URL=http://localhost:9000 claude --dangerously-skip-permissions");
  });

  test("replaces only the exact string, leaving surrounding text intact", () => {
    const cmd = 'SOME_VAR=foo claude --dangerously-skip-permissions --resume abc123';
    const result = injectBusEnv(cmd, "http://localhost:9001");
    expect(result).toBe("SOME_VAR=foo BUS_URL=http://localhost:9001 claude --dangerously-skip-permissions --resume abc123");
  });

  test("does not modify command if target string not present", () => {
    const cmd = "claude --some-other-flag";
    const result = injectBusEnv(cmd, "http://localhost:9002");
    expect(result).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// teardown CLI reads state and kills PIDs
// ---------------------------------------------------------------------------

describe("teardown via state file", () => {
  test("teardownMindsBus with repoRoot+ticketId clears state file after kill", async () => {
    const repoRoot = await makeTempDir();
    const state: MindsBusState = { ...SAMPLE_STATE, ticketId: "BRE-TEARDOWN-STATE" };

    await writeBusState(repoRoot, state);

    // Before teardown, state file exists
    const before = await readBusState(repoRoot, "BRE-TEARDOWN-STATE");
    expect(before).not.toBeNull();

    // Mock process.kill to avoid killing real processes
    const origKill = (process as unknown as Record<string, unknown>).kill;
    (process as unknown as Record<string, unknown>).kill = () => { /* no-op */ };

    try {
      await teardownMindsBus({
        busServerPid: state.busServerPid,
        bridgePid: state.bridgePid,
        repoRoot,
        ticketId: state.ticketId,
      });
    } finally {
      (process as unknown as Record<string, unknown>).kill = origKill;
    }

    // After teardown, state file is gone
    const after = await readBusState(repoRoot, "BRE-TEARDOWN-STATE");
    expect(after).toBeNull();

    await fs.rm(repoRoot, { recursive: true });
  });

  test("teardownMindsBus without repoRoot/ticketId does not clear state file", async () => {
    const repoRoot = await makeTempDir();
    const state: MindsBusState = { ...SAMPLE_STATE, ticketId: "BRE-TEARDOWN-NO-CLEAR" };

    await writeBusState(repoRoot, state);

    const origKill = (process as unknown as Record<string, unknown>).kill;
    (process as unknown as Record<string, unknown>).kill = () => { /* no-op */ };

    try {
      // No repoRoot/ticketId provided
      await teardownMindsBus({
        busServerPid: state.busServerPid,
        bridgePid: state.bridgePid,
      });
    } finally {
      (process as unknown as Record<string, unknown>).kill = origKill;
    }

    // State file should still exist since no repoRoot/ticketId given
    const after = await readBusState(repoRoot, "BRE-TEARDOWN-NO-CLEAR");
    expect(after).not.toBeNull();

    await fs.rm(repoRoot, { recursive: true });
  });
});
