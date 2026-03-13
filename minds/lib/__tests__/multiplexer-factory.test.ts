/**
 * multiplexer-factory.test.ts -- Tests for the multiplexer factory.
 *
 * Validates backend selection logic:
 * 1. Default (no axon binary) returns TmuxMultiplexer
 * 2. MINDS_MULTIPLEXER=tmux forces tmux
 * 3. MINDS_MULTIPLEXER=axon with no binary falls back to tmux with warning
 * 4. forceBackend overrides env var
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { createMultiplexer } from "../multiplexer-factory.ts";
import { TmuxMultiplexer } from "../tmux-multiplexer.ts";

// We cannot test AxonMultiplexer creation without a running daemon, so we focus
// on the selection logic and fallback behavior.

describe("createMultiplexer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.MINDS_MULTIPLEXER;
    delete process.env.AXON_BINARY;
  });

  afterEach(() => {
    // Restore env
    process.env.MINDS_MULTIPLEXER = originalEnv.MINDS_MULTIPLEXER;
    process.env.AXON_BINARY = originalEnv.AXON_BINARY;
    if (originalEnv.MINDS_MULTIPLEXER === undefined) delete process.env.MINDS_MULTIPLEXER;
    if (originalEnv.AXON_BINARY === undefined) delete process.env.AXON_BINARY;
  });

  it("returns TmuxMultiplexer when no axon binary is available (default)", async () => {
    const mux = await createMultiplexer({ repoRoot: "/nonexistent/repo" });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
  });

  it("returns TmuxMultiplexer when MINDS_MULTIPLEXER=tmux", async () => {
    process.env.MINDS_MULTIPLEXER = "tmux";
    const mux = await createMultiplexer({ repoRoot: "/nonexistent/repo" });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
  });

  it("falls back to TmuxMultiplexer when MINDS_MULTIPLEXER=axon but no binary exists", async () => {
    process.env.MINDS_MULTIPLEXER = "axon";
    // Spy on console.warn to verify fallback warning
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const mux = await createMultiplexer({ repoRoot: "/nonexistent/repo" });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
    expect(warnSpy).toHaveBeenCalled();

    // Verify the warning mentions fallback
    const warnMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(warnMessage).toContain("tmux");

    warnSpy.mockRestore();
  });

  it("forceBackend=tmux overrides MINDS_MULTIPLEXER=axon", async () => {
    process.env.MINDS_MULTIPLEXER = "axon";
    const mux = await createMultiplexer({
      repoRoot: "/nonexistent/repo",
      forceBackend: "tmux",
    });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
  });

  it("forceBackend=axon with no binary falls back to tmux", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const mux = await createMultiplexer({
      repoRoot: "/nonexistent/repo",
      forceBackend: "axon",
    });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("returns TmuxMultiplexer for unknown MINDS_MULTIPLEXER values", async () => {
    process.env.MINDS_MULTIPLEXER = "zellij";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const mux = await createMultiplexer({ repoRoot: "/nonexistent/repo" });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);

    warnSpy.mockRestore();
  });
});
