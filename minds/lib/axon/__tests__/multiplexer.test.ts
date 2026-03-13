/**
 * multiplexer.test.ts -- Tests for AxonMultiplexer.
 *
 * Uses a mock AxonClient to validate the multiplexer's pane lifecycle,
 * derived process IDs, and cleanup behavior.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { AxonMultiplexer } from "../multiplexer.ts";
import type { AxonClient } from "../client.ts";
import type { ProcessInfo, ProcessId } from "../types.ts";

/**
 * Create a mock AxonClient that tracks spawn/kill/info/readBuffer calls.
 */
function createMockClient(): AxonClient & {
  spawned: Array<{ id: string; command: string; args: string[] }>;
  killed: string[];
  runningProcesses: Set<string>;
  buffers: Map<string, string>;
} {
  const spawned: Array<{ id: string; command: string; args: string[] }> = [];
  const killed: string[] = [];
  const runningProcesses = new Set<string>();
  const buffers = new Map<string, string>();

  return {
    sessionId: "test-session",
    spawned,
    killed,
    runningProcesses,
    buffers,

    async spawn(id: string, command: string, args: string[] = []) {
      if (runningProcesses.has(id)) {
        throw new Error(`Process ${id} already exists`);
      }
      spawned.push({ id, command, args });
      runningProcesses.add(id);
      // Auto-populate buffer with a default output
      buffers.set(id, `output-${id}`);
      return id;
    },

    async kill(id: string) {
      killed.push(id);
      runningProcesses.delete(id);
    },

    async info(id: string): Promise<ProcessInfo> {
      if (runningProcesses.has(id)) {
        return {
          id: id as ProcessId,
          command: "sh",
          args: [],
          state: "Running",
          pid: 1234,
          started_at: Date.now(),
        };
      }
      throw new Error(`Process not found: ${id}`);
    },

    async readBuffer(id: string) {
      const data = buffers.get(id) ?? "";
      return { data, bytes_read: data.length, total_written: data.length };
    },

    async list(): Promise<ProcessInfo[]> {
      return [];
    },

    async subscribe() {
      return { id: 1 };
    },

    async unsubscribe() {},

    async shutdown() {},

    async readEvent(): Promise<never> {
      throw new Error("not implemented in mock");
    },

    close() {},
  } as unknown as AxonClient & {
    spawned: Array<{ id: string; command: string; args: string[] }>;
    killed: string[];
    runningProcesses: Set<string>;
    buffers: Map<string, string>;
  };
}

describe("AxonMultiplexer", () => {
  let client: ReturnType<typeof createMockClient>;
  let mux: AxonMultiplexer;

  beforeEach(() => {
    client = createMockClient();
    mux = new AxonMultiplexer(client as unknown as AxonClient);
  });

  describe("splitPane", () => {
    test("returns a unique pane ID", async () => {
      const pane1 = await mux.splitPane("source");
      const pane2 = await mux.splitPane("source");
      expect(pane1).not.toBe(pane2);
    });

    test("sanitizes tmux-style pane IDs with % character", async () => {
      const pane = await mux.splitPane("%42");
      // The pane ID should not contain % since it's invalid for Axon
      expect(pane).not.toContain("%");
    });

    test("produces valid Axon process ID format", async () => {
      const pane = await mux.splitPane("%42");
      // Should match [a-zA-Z0-9_-]{1,64}
      expect(pane).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    });
  });

  describe("sendKeys", () => {
    test("spawns a process with derived ID", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo hello");
      expect(client.spawned).toHaveLength(1);
      expect(client.spawned[0]!.command).toBe("/bin/sh");
      expect(client.spawned[0]!.args).toEqual(["-c", "echo hello"]);
    });

    test("calling sendKeys twice on same pane does NOT fail", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo first");
      await mux.sendKeys(pane, "echo second");
      expect(client.spawned).toHaveLength(2);
    });

    test("derives unique process IDs for each sendKeys call", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo first");
      await mux.sendKeys(pane, "echo second");

      const ids = client.spawned.map((s) => s.id);
      expect(ids[0]).not.toBe(ids[1]);
    });

    test("process IDs are valid Axon format", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo test");

      for (const spawn of client.spawned) {
        expect(spawn.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      }
    });
  });

  describe("killPane", () => {
    test("kills all processes associated with the pane", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo first");
      await mux.sendKeys(pane, "echo second");
      await mux.killPane(pane);
      // Should have killed both processes
      expect(client.killed).toHaveLength(2);
    });

    test("silently handles already-gone processes", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo test");
      // Manually remove the process from running set
      client.runningProcesses.clear();
      // killPane should not throw even if kill fails
      await expect(mux.killPane(pane)).resolves.toBeUndefined();
    });

    test("cleans up internal tracking state", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo test");
      await mux.killPane(pane);
      // After killing, isPaneAlive should return false
      const alive = await mux.isPaneAlive(pane);
      expect(alive).toBe(false);
    });
  });

  describe("isPaneAlive", () => {
    test("returns true when a process is running", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo test");
      const alive = await mux.isPaneAlive(pane);
      expect(alive).toBe(true);
    });

    test("returns false when no processes are running", async () => {
      const pane = await mux.splitPane("source");
      const alive = await mux.isPaneAlive(pane);
      expect(alive).toBe(false);
    });

    test("returns false when all processes have exited", async () => {
      const pane = await mux.splitPane("source");
      await mux.sendKeys(pane, "echo test");
      // Simulate process exit
      client.runningProcesses.clear();
      const alive = await mux.isPaneAlive(pane);
      expect(alive).toBe(false);
    });
  });

  describe("getCurrentPane", () => {
    test("returns client session ID", async () => {
      const pane = await mux.getCurrentPane();
      expect(pane).toBe("test-session");
    });
  });

  describe("capturePane", () => {
    test("returns empty string for pane with no processes", async () => {
      const paneId = await mux.splitPane("source");
      const result = await mux.capturePane(paneId);
      expect(result).toBe("");
    });

    test("returns output from the most recent process", async () => {
      const paneId = await mux.splitPane("source");
      await mux.sendKeys(paneId, "echo first");
      await mux.sendKeys(paneId, "echo second");
      const result = await mux.capturePane(paneId);
      // Should read from the last spawned process (cmd-1)
      expect(result).toContain("cmd-1");
    });

    test("returns empty string after killPane clears tracking", async () => {
      const paneId = await mux.splitPane("source");
      await mux.sendKeys(paneId, "echo test");
      await mux.killPane(paneId);
      const result = await mux.capturePane(paneId);
      expect(result).toBe("");
    });

    test("returns empty string for unknown pane ID", async () => {
      const result = await mux.capturePane("nonexistent-pane");
      expect(result).toBe("");
    });
  });

  describe("spawn failure", () => {
    test("sendKeys does not track process if spawn fails", async () => {
      const failClient = createMockClient();
      failClient.spawn = async () => {
        throw new Error("spawn failed");
      };
      const failMux = new AxonMultiplexer(
        failClient as unknown as AxonClient,
      );
      const paneId = await failMux.splitPane("source");

      await expect(failMux.sendKeys(paneId, "echo fail")).rejects.toThrow(
        "spawn failed",
      );
      // Pane should have no tracked processes since spawn failed before tracking
      expect(await failMux.isPaneAlive(paneId)).toBe(false);
    });
  });

  describe("multiple panes", () => {
    test("panes operate independently without cross-contamination", async () => {
      const pane1 = await mux.splitPane("source");
      const pane2 = await mux.splitPane("source");

      await mux.sendKeys(pane1, "echo pane1-cmd");
      await mux.sendKeys(pane2, "echo pane2-cmd");

      // Both panes alive
      expect(await mux.isPaneAlive(pane1)).toBe(true);
      expect(await mux.isPaneAlive(pane2)).toBe(true);

      // Kill only pane1
      await mux.killPane(pane1);

      // pane1 dead, pane2 still alive
      expect(await mux.isPaneAlive(pane1)).toBe(false);
      expect(await mux.isPaneAlive(pane2)).toBe(true);

      // capturePane on pane1 returns empty, pane2 still has output
      expect(await mux.capturePane(pane1)).toBe("");
      const pane2Output = await mux.capturePane(pane2);
      expect(pane2Output).not.toBe("");
    });

    test("process IDs are globally unique across panes", async () => {
      const pane1 = await mux.splitPane("source");
      const pane2 = await mux.splitPane("source");

      await mux.sendKeys(pane1, "echo a");
      await mux.sendKeys(pane2, "echo b");
      await mux.sendKeys(pane1, "echo c");

      const allIds = client.spawned.map((s) => s.id);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  describe("edge cases", () => {
    test("killPane on unknown pane does not throw", async () => {
      await expect(mux.killPane("never-split-pane")).resolves.toBeUndefined();
    });

    test("sendKeys on pane that was never split still works", async () => {
      // sendKeys should work even on a pane ID not created by splitPane,
      // since the multiplexer initializes tracking lazily via commandCounters
      await mux.sendKeys("ad-hoc-pane", "echo hello");
      expect(client.spawned).toHaveLength(1);
      expect(client.spawned[0]!.id).toBe("ad-hoc-pane-cmd-0");
    });

    test("isPaneAlive on unknown pane returns false", async () => {
      expect(await mux.isPaneAlive("nonexistent")).toBe(false);
    });

    test("splitPane with empty string source produces valid ID", async () => {
      const pane = await mux.splitPane("");
      // sanitizeProcessId("") returns "unnamed"
      expect(pane).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    });

    test("splitPane with very long source sanitizes the source portion", async () => {
      const longSource = "a".repeat(100);
      const pane = await mux.splitPane(longSource);
      // The sanitized source is truncated to 64 chars, then "-N" is appended
      // The pane ID is a logical grouping, not a ProcessId itself
      expect(pane).toMatch(/^[a-zA-Z0-9_-]+$/);
      // Source portion should be truncated (64 chars of 'a' + '-0' suffix)
      expect(pane).toBe("a".repeat(64) + "-0");
    });

    test("sendKeys produces processId within 64-char Axon limit even with long paneId", async () => {
      const longPane = "a".repeat(100);
      // Register the pane so sendKeys works
      (mux as any).paneProcesses.set(longPane, []);
      (mux as any).commandCounters.set(longPane, 0);
      await mux.sendKeys(longPane, "echo test");
      // The spawned process ID must fit within 64 chars
      expect(client.spawned[0]!.id.length).toBeLessThanOrEqual(64);
      expect(client.spawned[0]!.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    });
  });
});
