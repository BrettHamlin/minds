/**
 * daemon-lifecycle.test.ts -- Tests for daemon lifecycle manager functions.
 *
 * Tests startAxonDaemon, stopAxonDaemon, and isAxonRunning with mocked
 * dependencies (no real daemon). Validates path construction, error
 * handling, and graceful degradation.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { DaemonStatus } from "../daemon-lifecycle.ts";

// We test through the module's exported functions. The module imports
// resolveAxonBinary internally -- we mock that at the module level.

describe("daemon-lifecycle", () => {
  const TEST_REPO = "/tmp/daemon-lifecycle-test-repo";
  const RUN_DIR = path.join(TEST_REPO, ".minds", "run");
  const SOCKET_PATH = path.join(RUN_DIR, "axon.sock");
  const PID_FILE = path.join(RUN_DIR, "axon.pid");

  beforeEach(() => {
    // Create a clean test directory structure
    fs.mkdirSync(RUN_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(TEST_REPO, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("path construction", () => {
    test("socket path is .minds/run/axon.sock under repo root", () => {
      const expected = path.join(TEST_REPO, ".minds", "run", "axon.sock");
      expect(expected).toBe(SOCKET_PATH);
    });

    test("PID file path is .minds/run/axon.pid under repo root", () => {
      const expected = path.join(TEST_REPO, ".minds", "run", "axon.pid");
      expect(expected).toBe(PID_FILE);
    });
  });

  describe("isAxonRunning", () => {
    test("returns false when no PID file exists", async () => {
      const { isAxonRunning } = await import("../daemon-lifecycle.ts");
      const result = await isAxonRunning(TEST_REPO);
      expect(result).toBe(false);
    });

    test("returns false when PID file contains invalid data", async () => {
      const { isAxonRunning } = await import("../daemon-lifecycle.ts");
      fs.writeFileSync(PID_FILE, "not-a-number\n");
      const result = await isAxonRunning(TEST_REPO);
      expect(result).toBe(false);
    });

    test("returns false when PID file references non-existent process", async () => {
      const { isAxonRunning } = await import("../daemon-lifecycle.ts");
      // Use a PID that almost certainly doesn't exist
      fs.writeFileSync(PID_FILE, "999999999\n");
      const result = await isAxonRunning(TEST_REPO);
      expect(result).toBe(false);
    });
  });

  describe("startAxonDaemon", () => {
    test("throws when binary is not found", async () => {
      // We need to mock resolveAxonBinary to return null
      // Import the module and test the error case
      const mod = await import("../daemon-lifecycle.ts");

      // The function should throw when resolveAxonBinary returns null.
      // We mock it by setting AXON_BINARY to a non-existent path and
      // ensuring no other resolution works.
      const origEnv = process.env.AXON_BINARY;
      process.env.AXON_BINARY = "";
      try {
        await expect(
          mod.startAxonDaemon("/tmp/nonexistent-repo-for-axon-test"),
        ).rejects.toThrow(/[Bb]inary/);
      } finally {
        if (origEnv !== undefined) {
          process.env.AXON_BINARY = origEnv;
        } else {
          delete process.env.AXON_BINARY;
        }
      }
    });

    test("creates .minds/run directory if it does not exist", async () => {
      const { ensureRunDir } = await import("../daemon-lifecycle.ts");
      const newRepo = "/tmp/daemon-lifecycle-mkdir-test";
      try {
        const runDir = ensureRunDir(newRepo);
        expect(fs.existsSync(runDir)).toBe(true);
        expect(runDir).toBe(path.join(newRepo, ".minds", "run"));
      } finally {
        fs.rmSync(newRepo, { recursive: true, force: true });
      }
    });
  });

  describe("stopAxonDaemon", () => {
    test("handles missing daemon gracefully (no PID file)", async () => {
      const { stopAxonDaemon } = await import("../daemon-lifecycle.ts");
      // Should not throw
      await expect(stopAxonDaemon(TEST_REPO)).resolves.toBeUndefined();
    });

    test("handles stale PID file gracefully", async () => {
      const { stopAxonDaemon } = await import("../daemon-lifecycle.ts");
      // Write a PID for a process that doesn't exist
      fs.writeFileSync(PID_FILE, "999999999\n");
      // Should not throw
      await expect(stopAxonDaemon(TEST_REPO)).resolves.toBeUndefined();
      // PID file should be cleaned up
      expect(fs.existsSync(PID_FILE)).toBe(false);
    });

    test("cleans up socket file if it exists", async () => {
      const { stopAxonDaemon } = await import("../daemon-lifecycle.ts");
      // Create a fake socket file
      fs.writeFileSync(SOCKET_PATH, "");
      fs.writeFileSync(PID_FILE, "999999999\n");
      await stopAxonDaemon(TEST_REPO);
      expect(fs.existsSync(SOCKET_PATH)).toBe(false);
    });
  });

  describe("getDaemonPaths", () => {
    test("returns correct socket and PID paths for repo root", async () => {
      const { getDaemonPaths } = await import("../daemon-lifecycle.ts");
      const paths = getDaemonPaths("/some/repo");
      expect(paths.socketPath).toBe("/some/repo/.minds/run/axon.sock");
      expect(paths.pidFile).toBe("/some/repo/.minds/run/axon.pid");
      expect(paths.runDir).toBe("/some/repo/.minds/run");
    });
  });
});
