/**
 * multiplexer-factory-e2e.test.ts -- E2E tests for multiplexer factory backend selection.
 *
 * Validates full factory behavior including Axon binary resolution, daemon startup,
 * and environment variable overrides. Unlike the unit tests in multiplexer-factory.test.ts,
 * these scenarios exercise the real factory path with minimal mocking.
 *
 * 5 scenarios:
 * 1. Axon available -- binary exists and daemon starts -> AxonMultiplexer
 * 2. Binary missing -- no axon binary found -> TmuxMultiplexer
 * 3. Daemon start fails -- binary exists but daemon cannot start -> TmuxMultiplexer fallback
 * 4. Env override to tmux -- MINDS_MULTIPLEXER=tmux bypasses Axon entirely
 * 5. Env force axon -- MINDS_MULTIPLEXER=axon with no binary -> TmuxMultiplexer with warning
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMultiplexer } from "../multiplexer-factory.ts";
import { TmuxMultiplexer } from "../tmux-multiplexer.ts";
import { AxonMultiplexer } from "../axon/multiplexer.ts";

// Directory that definitely has no axon binary
const EMPTY_REPO = path.join(os.tmpdir(), "mux-factory-e2e-empty");

// Saved env vars for clean restore
let savedMindsMultiplexer: string | undefined;
let savedAxonBinary: string | undefined;

describe("multiplexer-factory e2e", () => {
  beforeEach(() => {
    // Snapshot current env
    savedMindsMultiplexer = process.env.MINDS_MULTIPLEXER;
    savedAxonBinary = process.env.AXON_BINARY;

    // Clear to prevent cross-test leakage
    delete process.env.MINDS_MULTIPLEXER;
    delete process.env.AXON_BINARY;

    // Ensure empty repo directory exists (no .minds/bin/axon inside it)
    fs.mkdirSync(EMPTY_REPO, { recursive: true });
  });

  afterEach(() => {
    // Restore env vars precisely
    if (savedMindsMultiplexer === undefined) {
      delete process.env.MINDS_MULTIPLEXER;
    } else {
      process.env.MINDS_MULTIPLEXER = savedMindsMultiplexer;
    }
    if (savedAxonBinary === undefined) {
      delete process.env.AXON_BINARY;
    } else {
      process.env.AXON_BINARY = savedAxonBinary;
    }

    // Clean up temp directory
    try {
      fs.rmSync(EMPTY_REPO, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Axon available -- binary exists, daemon starts, returns AxonMultiplexer
  // -------------------------------------------------------------------------
  test("returns AxonMultiplexer when axon binary exists and daemon starts", async () => {
    // Attempt to find a real axon binary. If none exists, skip gracefully.
    const possibleBinaries = [
      path.join(os.homedir(), "Code", "projects", "axon", "target", "release", "axon"),
      path.join(os.homedir(), "Code", "projects", "axon", "target", "debug", "axon"),
      path.join(os.homedir(), ".cargo", "bin", "axon"),
    ];

    let axonBinary: string | null = null;
    for (const bin of possibleBinaries) {
      try {
        fs.accessSync(bin, fs.constants.X_OK);
        axonBinary = bin;
        break;
      } catch {
        // Not found, try next
      }
    }

    // Also check PATH
    if (!axonBinary) {
      const which = Bun.which("axon");
      if (which) axonBinary = which;
    }

    if (!axonBinary) {
      console.log(
        "[SKIP] No axon binary available -- cannot test AxonMultiplexer creation. " +
        "Build the axon project (cargo build) to enable this test.",
      );
      return;
    }

    // Set up a temp repo with the binary discoverable via AXON_BINARY env
    process.env.AXON_BINARY = axonBinary;
    const testRepo = path.join(os.tmpdir(), "mux-factory-e2e-axon");
    fs.mkdirSync(path.join(testRepo, ".minds", "run"), { recursive: true });

    let mux: Awaited<ReturnType<typeof createMultiplexer>> | null = null;
    try {
      mux = await createMultiplexer({ repoRoot: testRepo });
      expect(mux).toBeInstanceOf(AxonMultiplexer);

      // AxonMultiplexer has getClient() -- verify it's callable
      const axonMux = mux as AxonMultiplexer;
      expect(typeof axonMux.getClient).toBe("function");
      expect(typeof axonMux.close).toBe("function");
    } finally {
      // Clean up: close the multiplexer and stop the daemon
      if (mux && mux instanceof AxonMultiplexer) {
        (mux as AxonMultiplexer).close();
      }
      // Stop daemon and clean up
      try {
        const { stopAxonDaemon } = await import("../axon/daemon-lifecycle.ts");
        await stopAxonDaemon(testRepo);
      } catch {
        // Ignore
      }
      try {
        fs.rmSync(testRepo, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }, 15_000);

  // -------------------------------------------------------------------------
  // Scenario 2: Binary missing -- no axon binary, returns TmuxMultiplexer
  // -------------------------------------------------------------------------
  test("returns TmuxMultiplexer when no axon binary is found", async () => {
    // EMPTY_REPO has no .minds/bin/axon, AXON_BINARY is unset, axon not on PATH
    // (PATH search might find axon if installed system-wide, so use a repo
    // that definitely doesn't have it and hope PATH doesn't have it either)
    const mux = await createMultiplexer({ repoRoot: EMPTY_REPO });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
  }, 10_000);

  // -------------------------------------------------------------------------
  // Scenario 3: Daemon start fails -- binary exists but daemon cannot start
  // -------------------------------------------------------------------------
  test("falls back to TmuxMultiplexer when binary exists but daemon fails to start", async () => {
    // Create a fake "axon" binary that exits immediately with an error.
    // This simulates the binary existing but the daemon refusing to start.
    const fakeRepo = path.join(os.tmpdir(), "mux-factory-e2e-fake-daemon");
    const fakeBinDir = path.join(fakeRepo, ".minds", "bin");
    fs.mkdirSync(fakeBinDir, { recursive: true });

    const fakeBin = path.join(fakeBinDir, "axon");
    fs.writeFileSync(fakeBin, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    // Point AXON_BINARY at the fake binary to ensure resolveAxonBinary finds it
    process.env.AXON_BINARY = fakeBin;

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const mux = await createMultiplexer({ repoRoot: fakeRepo });
      expect(mux).toBeInstanceOf(TmuxMultiplexer);

      // Factory should have logged a warning about daemon failure
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      const hasFallbackWarning = messages.some(
        (m) => m.includes("Failed to start Axon daemon") || m.includes("falling back to tmux"),
      );
      expect(hasFallbackWarning).toBe(true);
    } finally {
      warnSpy.mockRestore();
      try {
        fs.rmSync(fakeRepo, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }, 15_000);

  // -------------------------------------------------------------------------
  // Scenario 4: Env override to tmux -- MINDS_MULTIPLEXER=tmux bypasses Axon
  // -------------------------------------------------------------------------
  test("returns TmuxMultiplexer when MINDS_MULTIPLEXER=tmux regardless of axon availability", async () => {
    process.env.MINDS_MULTIPLEXER = "tmux";

    // Even if we pointed at a real binary, tmux env override should take priority
    const mux = await createMultiplexer({ repoRoot: EMPTY_REPO });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
  }, 5_000);

  // -------------------------------------------------------------------------
  // Scenario 5: Env force axon with no binary -- falls back to tmux with warning
  // -------------------------------------------------------------------------
  test("falls back to TmuxMultiplexer with warning when MINDS_MULTIPLEXER=axon but no binary exists", async () => {
    process.env.MINDS_MULTIPLEXER = "axon";

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const mux = await createMultiplexer({ repoRoot: EMPTY_REPO });
      expect(mux).toBeInstanceOf(TmuxMultiplexer);

      // Verify warning was logged about missing binary
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map((c) => String(c[0]));
      const hasWarning = messages.some(
        (m) => m.includes("MINDS_MULTIPLEXER=axon") && m.includes("no Axon binary found"),
      );
      expect(hasWarning).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  }, 5_000);
});
