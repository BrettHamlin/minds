/**
 * drone-backend-tmux.test.ts — Unit tests for TmuxDroneBackend.
 *
 * Uses a stubbed TmuxMultiplexer to avoid requiring a live tmux session.
 * Tests verify that the backend correctly delegates to the multiplexer
 * and implements the DroneBackend contract.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { TmuxDroneBackend } from "../drone-backend-tmux.ts";
import type { DroneHandle, DroneSpawnOpts } from "../../drone-backend.ts";
import type { TmuxMultiplexer } from "../../tmux-multiplexer.ts";

// ---------------------------------------------------------------------------
// Stub TmuxMultiplexer
// ---------------------------------------------------------------------------

function createMockMux(): TmuxMultiplexer & {
  _splitPaneCalls: Array<[string]>;
  _sendKeysCalls: Array<[string, string]>;
  _killPaneCalls: Array<[string]>;
  _isPaneAliveCalls: Array<[string]>;
  _capturedPanes: Map<string, string>;
  _aliveResult: boolean;
} {
  const stub = {
    _splitPaneCalls: [] as Array<[string]>,
    _sendKeysCalls: [] as Array<[string, string]>,
    _killPaneCalls: [] as Array<[string]>,
    _isPaneAliveCalls: [] as Array<[string]>,
    _capturedPanes: new Map<string, string>(),
    _aliveResult: true,

    async splitPane(source: string): Promise<string> {
      stub._splitPaneCalls.push([source]);
      return `%${10 + stub._splitPaneCalls.length}`;
    },
    async sendKeys(paneId: string, command: string): Promise<void> {
      stub._sendKeysCalls.push([paneId, command]);
    },
    async killPane(paneId: string): Promise<void> {
      stub._killPaneCalls.push([paneId]);
    },
    async isPaneAlive(paneId: string): Promise<boolean> {
      stub._isPaneAliveCalls.push([paneId]);
      return stub._aliveResult;
    },
    async getCurrentPane(): Promise<string> {
      return "%0";
    },
    async capturePane(paneId: string): Promise<string> {
      return stub._capturedPanes.get(paneId) ?? "";
    },
    close(): void {},
  };
  return stub as unknown as TmuxMultiplexer & typeof stub;
}

// ---------------------------------------------------------------------------
// spawn()
// ---------------------------------------------------------------------------

describe("TmuxDroneBackend", () => {
  describe("spawn()", () => {
    test("splits pane from callerPane and sends command", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);

      const opts: DroneSpawnOpts = {
        processId: "drone-1",
        cwd: "/tmp/worktree",
        command: "claude",
        args: ["--model", "sonnet", "do stuff"],
        callerPane: "%5",
      };

      const handle = await backend.spawn(opts);

      // Should have split from callerPane
      expect(mux._splitPaneCalls).toEqual([["%5"]]);

      // Handle should be tmux-backed with the new pane ID
      expect(handle.backend).toBe("tmux");
      expect(handle.id).toBe("%11");

      // Should have sent keys with cd + command
      expect(mux._sendKeysCalls.length).toBe(1);
      const [paneId, cmd] = mux._sendKeysCalls[0];
      expect(paneId).toBe("%11");
      expect(cmd).toContain("cd '/tmp/worktree'");
      expect(cmd).toContain("claude --model sonnet do stuff");
    });

    test("injects env vars as prefix", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);

      const opts: DroneSpawnOpts = {
        processId: "drone-2",
        cwd: "/tmp/wt",
        command: "claude",
        args: ["--model", "sonnet"],
        env: { BUS_URL: "http://localhost:9999", DRONE_ID: "d2" },
        callerPane: "%1",
      };

      await backend.spawn(opts);

      const cmd = mux._sendKeysCalls[0][1];
      expect(cmd).toContain("BUS_URL=http://localhost:9999");
      expect(cmd).toContain("DRONE_ID=d2");
    });

    test("works without callerPane (uses empty string)", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);

      const opts: DroneSpawnOpts = {
        processId: "drone-3",
        cwd: "/tmp/wt",
        command: "claude",
        args: [],
      };

      await backend.spawn(opts);
      // callerPane defaults to "" — splitPane is called with ""
      expect(mux._splitPaneCalls).toEqual([[""]]);
    });

    test("args are joined with spaces", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);

      const opts: DroneSpawnOpts = {
        processId: "drone-4",
        cwd: "/tmp/wt",
        command: "claude",
        args: ["--dangerously-skip-permissions", "--model", "sonnet", "do things"],
        callerPane: "%0",
      };

      await backend.spawn(opts);
      const cmd = mux._sendKeysCalls[0][1];
      expect(cmd).toContain("claude --dangerously-skip-permissions --model sonnet do things");
    });
  });

  // ---------------------------------------------------------------------------
  // kill()
  // ---------------------------------------------------------------------------

  describe("kill()", () => {
    test("delegates to mux.killPane", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%42", backend: "tmux" };

      await backend.kill(handle);

      expect(mux._killPaneCalls).toEqual([["%42"]]);
    });

    test("is idempotent — does not throw if pane already dead", async () => {
      const mux = createMockMux();
      // Make killPane throw
      mux.killPane = async () => { throw new Error("pane gone"); };
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%99", backend: "tmux" };

      // Should not throw
      await expect(backend.kill(handle)).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // isAlive()
  // ---------------------------------------------------------------------------

  describe("isAlive()", () => {
    test("returns true when pane is alive", async () => {
      const mux = createMockMux();
      mux._aliveResult = true;
      const backend = new TmuxDroneBackend(mux);

      const alive = await backend.isAlive({ id: "%10", backend: "tmux" });
      expect(alive).toBe(true);
      expect(mux._isPaneAliveCalls).toEqual([["%10"]]);
    });

    test("returns false when pane is dead", async () => {
      const mux = createMockMux();
      mux._aliveResult = false;
      const backend = new TmuxDroneBackend(mux);

      const alive = await backend.isAlive({ id: "%10", backend: "tmux" });
      expect(alive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // captureOutput()
  // ---------------------------------------------------------------------------

  describe("captureOutput()", () => {
    test("delegates to mux.capturePane", async () => {
      const mux = createMockMux();
      mux._capturedPanes.set("%20", "some terminal output\n");
      const backend = new TmuxDroneBackend(mux);

      const output = await backend.captureOutput({ id: "%20", backend: "tmux" });
      expect(output).toBe("some terminal output\n");
    });

    test("returns empty string when capture fails", async () => {
      const mux = createMockMux();
      mux.capturePane = async () => { throw new Error("no pane"); };
      const backend = new TmuxDroneBackend(mux);

      const output = await backend.captureOutput({ id: "%99", backend: "tmux" });
      expect(output).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // waitForCompletion()
  // ---------------------------------------------------------------------------

  describe("waitForCompletion()", () => {
    test("returns ok:true when sentinel file appears", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%10", backend: "tmux" };

      // Use a temp dir with a sentinel file
      const tmpDir = await createTmpWithSentinel("0");

      const result = await backend.waitForCompletion(handle, tmpDir, 5000);
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    test("returns ok:false with non-zero exit code from sentinel", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%10", backend: "tmux" };

      const tmpDir = await createTmpWithSentinel("1");

      const result = await backend.waitForCompletion(handle, tmpDir, 5000);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    test("returns ok:true when sentinel has no content (touch)", async () => {
      const mux = createMockMux();
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%10", backend: "tmux" };

      // The sentinel file created by `touch` is empty — this should be treated as success
      const tmpDir = await createTmpWithSentinel("");

      const result = await backend.waitForCompletion(handle, tmpDir, 5000);
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBeUndefined();
    });

    test("returns error when pane dies without sentinel", async () => {
      const mux = createMockMux();
      mux._aliveResult = false; // pane is dead
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%10", backend: "tmux" };

      const { mkdtempSync } = await import("fs");
      const { join } = await import("path");
      const tmpDir = mkdtempSync(join(await import("os").then(o => o.tmpdir()), "tmux-test-"));

      const result = await backend.waitForCompletion(handle, tmpDir, 5000);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("pane exited without sentinel");
    });

    test("returns timeout error when neither sentinel nor pane death occurs", async () => {
      const mux = createMockMux();
      mux._aliveResult = true; // pane stays alive
      const backend = new TmuxDroneBackend(mux);
      const handle: DroneHandle = { id: "%10", backend: "tmux" };

      const { mkdtempSync } = await import("fs");
      const { join } = await import("path");
      const tmpDir = mkdtempSync(join(await import("os").then(o => o.tmpdir()), "tmux-test-"));

      // Use a very short timeout so the test doesn't hang
      const result = await backend.waitForCompletion(handle, tmpDir, 100, 50);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("timeout");
    });
  });

  // ---------------------------------------------------------------------------
  // close()
  // ---------------------------------------------------------------------------

  describe("close()", () => {
    test("calls mux.close", () => {
      const mux = createMockMux();
      const closeSpy = mock(() => {});
      mux.close = closeSpy;
      const backend = new TmuxDroneBackend(mux);

      backend.close();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTmpWithSentinel(content: string): Promise<string> {
  const { mkdtempSync, writeFileSync } = await import("fs");
  const { join } = await import("path");
  const os = await import("os");
  const tmpDir = mkdtempSync(join(os.tmpdir(), "tmux-test-"));
  writeFileSync(join(tmpDir, ".drone-complete"), content);
  return tmpDir;
}
