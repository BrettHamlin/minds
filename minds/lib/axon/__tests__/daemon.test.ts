/**
 * daemon.test.ts -- Tests for DaemonManager.
 *
 * Tests constructor defaults, socket path configuration, and health checking.
 * Does NOT start a real daemon (unit tests only).
 */

import { describe, test, expect } from "bun:test";
import { DaemonManager } from "../daemon.ts";

describe("DaemonManager", () => {
  describe("constructor defaults", () => {
    test("uses default socket path when none provided", () => {
      const dm = new DaemonManager();
      expect(dm.socketPath).toBe("/tmp/axon.sock");
    });

    test("accepts custom socket path", () => {
      const dm = new DaemonManager({ socketPath: "/tmp/custom.sock" });
      expect(dm.socketPath).toBe("/tmp/custom.sock");
    });

    test("accepts all configuration options", () => {
      const dm = new DaemonManager({
        binaryPath: "/usr/local/bin/axon",
        socketPath: "/tmp/test.sock",
        maxProcesses: 128,
        bufferSize: 131072,
        workDir: "/tmp/work",
      });
      expect(dm.socketPath).toBe("/tmp/test.sock");
    });
  });

  describe("isHealthy", () => {
    test("returns false when no daemon is running", async () => {
      const dm = new DaemonManager({
        socketPath: "/tmp/axon-nonexistent-test-socket.sock",
      });
      const healthy = await dm.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe("shutdown", () => {
    test("resolves without error when no daemon was started", async () => {
      const dm = new DaemonManager();
      await expect(dm.shutdown()).resolves.toBeUndefined();
    });
  });
});
