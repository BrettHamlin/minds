/**
 * multiplexer-factory.test.ts -- Tests for the multiplexer factory.
 *
 * Validates backend selection logic:
 * 1. Default (no axon binary) returns TmuxMultiplexer
 * 2. MINDS_MULTIPLEXER=tmux forces tmux
 * 3. MINDS_MULTIPLEXER=axon with no binary falls back to tmux with warning
 * 4. forceBackend overrides env var
 * 5. Happy path: returns AxonMultiplexer when binary, daemon, and client all succeed
 * 6. No-throw guarantee: unexpected errors fall back to tmux
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { createMultiplexer } from "../multiplexer-factory.ts";
import { TmuxMultiplexer } from "../tmux-multiplexer.ts";
import { AxonMultiplexer } from "../axon/multiplexer.ts";

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

  it("returns AxonMultiplexer when binary, daemon, and client all succeed (mocked)", async () => {
    // Mock resolveAxonBinary to return a fake path
    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockReturnValue("/fake/axon");

    // Mock startAxonDaemon to return a fake socket path
    const daemonMod = await import("../axon/daemon-lifecycle.ts");
    const daemonStub = spyOn(daemonMod, "startAxonDaemon").mockResolvedValue({
      socketPath: "/tmp/fake-axon.sock",
      pid: 12345,
      alreadyRunning: false,
    });

    // Mock AxonClient.connect to return a minimal fake client
    const clientMod = await import("../axon/client.ts");
    const fakeClient = {
      sessionId: "test-session",
      close: () => {},
      spawn: async () => {},
      kill: async () => {},
      info: async () => ({ state: "Running" }),
      readBuffer: async () => ({ data: "" }),
    } as unknown as InstanceType<typeof clientMod.AxonClient>;

    const connectStub = spyOn(clientMod.AxonClient, "connect").mockResolvedValue(fakeClient);

    const mux = await createMultiplexer({ repoRoot: "/fake/repo" });
    expect(mux).toBeInstanceOf(AxonMultiplexer);

    // Cleanup: close the multiplexer and restore mocks
    mux.close?.();
    resolveStub.mockRestore();
    daemonStub.mockRestore();
    connectStub.mockRestore();
  });

  it("never throws even if tryCreateAxonMultiplexer throws unexpectedly", async () => {
    // Force axon path, then make resolveAxonBinary throw
    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockImplementation(() => {
      throw new Error("Unexpected kaboom");
    });
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const mux = await createMultiplexer({
      repoRoot: "/fake/repo",
      forceBackend: "axon",
    });
    expect(mux).toBeInstanceOf(TmuxMultiplexer);

    // Verify the outer catch logged a warning
    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.some((m) => m.includes("Unexpected error"))).toBe(true);

    resolveStub.mockRestore();
    warnSpy.mockRestore();
  });

  it("close() method exists on returned TmuxMultiplexer", async () => {
    const mux = await createMultiplexer({ repoRoot: "/nonexistent/repo" });
    expect(typeof mux.close).toBe("function");
    // Should not throw
    mux.close?.();
  });
});
