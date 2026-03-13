/**
 * drone-backend-factory.test.ts -- Tests for the drone backend factory.
 *
 * Validates backend selection logic:
 * 1. forceBackend=tmux returns TmuxDroneBackend
 * 2. forceBackend=axon returns AxonDroneBackend (mocked)
 * 3. MINDS_DRONE_BACKEND=tmux env var returns TmuxDroneBackend
 * 4. MINDS_DRONE_BACKEND=axon env var returns AxonDroneBackend (mocked)
 * 5. Unknown env var value falls back to TmuxDroneBackend with warning
 * 6. Auto-detection with no Axon binary returns TmuxDroneBackend
 * 7. Auto-detection with Axon binary + daemon start failure returns TmuxDroneBackend
 * 8. Auto-detection with Axon binary + daemon success returns AxonDroneBackend
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createDroneBackend } from "../drone-backend-factory.ts";
import { TmuxDroneBackend } from "../tmux/drone-backend-tmux.ts";
import { AxonDroneBackend } from "../axon/drone-backend-axon.ts";

describe("createDroneBackend", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MINDS_DRONE_BACKEND;
    delete process.env.AXON_BINARY;
  });

  afterEach(() => {
    process.env.MINDS_DRONE_BACKEND = originalEnv.MINDS_DRONE_BACKEND;
    process.env.AXON_BINARY = originalEnv.AXON_BINARY;
    if (originalEnv.MINDS_DRONE_BACKEND === undefined) delete process.env.MINDS_DRONE_BACKEND;
    if (originalEnv.AXON_BINARY === undefined) delete process.env.AXON_BINARY;
  });

  it("returns TmuxDroneBackend when forceBackend=tmux", async () => {
    const backend = await createDroneBackend({
      repoRoot: "/nonexistent/repo",
      forceBackend: "tmux",
    });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);
    backend.close();
  });

  it("returns AxonDroneBackend when forceBackend=axon (mocked)", async () => {
    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockReturnValue("/fake/axon");

    const daemonMod = await import("../axon/daemon-lifecycle.ts");
    const daemonStub = spyOn(daemonMod, "startAxonDaemon").mockResolvedValue({
      running: true,
      pid: 12345,
      socketPath: "/tmp/fake-axon.sock",
    });

    const fakeClient = {
      sessionId: "test-session",
      close: () => {},
      spawn: async () => {},
      kill: async () => {},
      info: async () => ({ state: "Running" }),
      readBuffer: async () => ({ data: "" }),
    } as unknown as InstanceType<(typeof import("../axon/client.ts"))["AxonClient"]>;

    const clientMod = await import("../axon/client.ts");
    const connectStub = spyOn(clientMod.AxonClient, "connect").mockResolvedValue(fakeClient);

    const backend = await createDroneBackend({
      repoRoot: "/fake/repo",
      forceBackend: "axon",
    });
    expect(backend).toBeInstanceOf(AxonDroneBackend);

    backend.close();
    resolveStub.mockRestore();
    daemonStub.mockRestore();
    connectStub.mockRestore();
  });

  it("returns TmuxDroneBackend when MINDS_DRONE_BACKEND=tmux", async () => {
    process.env.MINDS_DRONE_BACKEND = "tmux";
    const backend = await createDroneBackend({ repoRoot: "/nonexistent/repo" });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);
    backend.close();
  });

  it("returns AxonDroneBackend when MINDS_DRONE_BACKEND=axon (mocked)", async () => {
    process.env.MINDS_DRONE_BACKEND = "axon";

    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockReturnValue("/fake/axon");

    const daemonMod = await import("../axon/daemon-lifecycle.ts");
    const daemonStub = spyOn(daemonMod, "startAxonDaemon").mockResolvedValue({
      running: true,
      pid: 12345,
      socketPath: "/tmp/fake-axon.sock",
    });

    const fakeClient = {
      sessionId: "test-session",
      close: () => {},
      spawn: async () => {},
      kill: async () => {},
      info: async () => ({ state: "Running" }),
      readBuffer: async () => ({ data: "" }),
    } as unknown as InstanceType<(typeof import("../axon/client.ts"))["AxonClient"]>;

    const clientMod = await import("../axon/client.ts");
    const connectStub = spyOn(clientMod.AxonClient, "connect").mockResolvedValue(fakeClient);

    const backend = await createDroneBackend({ repoRoot: "/fake/repo" });
    expect(backend).toBeInstanceOf(AxonDroneBackend);

    backend.close();
    resolveStub.mockRestore();
    daemonStub.mockRestore();
    connectStub.mockRestore();
  });

  it("falls back to TmuxDroneBackend for unknown MINDS_DRONE_BACKEND values", async () => {
    process.env.MINDS_DRONE_BACKEND = "zellij";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const backend = await createDroneBackend({ repoRoot: "/nonexistent/repo" });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.some((m) => m.includes("Unknown") && m.includes("zellij"))).toBe(true);

    warnSpy.mockRestore();
    backend.close();
  });

  it("auto-detection with no Axon binary returns TmuxDroneBackend", async () => {
    // No env var set, no binary at /nonexistent/repo
    const backend = await createDroneBackend({ repoRoot: "/nonexistent/repo" });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);
    backend.close();
  });

  it("auto-detection with Axon binary but daemon start failure returns TmuxDroneBackend", async () => {
    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockReturnValue("/fake/axon");

    const daemonMod = await import("../axon/daemon-lifecycle.ts");
    const daemonStub = spyOn(daemonMod, "startAxonDaemon").mockRejectedValue(
      new Error("Daemon start failed"),
    );

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const backend = await createDroneBackend({ repoRoot: "/fake/repo" });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.some((m) => m.includes("Failed to start Axon daemon"))).toBe(true);

    resolveStub.mockRestore();
    daemonStub.mockRestore();
    warnSpy.mockRestore();
    backend.close();
  });

  it("auto-detection with Axon binary + daemon success returns AxonDroneBackend", async () => {
    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockReturnValue("/fake/axon");

    const daemonMod = await import("../axon/daemon-lifecycle.ts");
    const daemonStub = spyOn(daemonMod, "startAxonDaemon").mockResolvedValue({
      running: true,
      pid: 12345,
      socketPath: "/tmp/fake-axon.sock",
    });

    const fakeClient = {
      sessionId: "test-session",
      close: () => {},
      spawn: async () => {},
      kill: async () => {},
      info: async () => ({ state: "Running" }),
      readBuffer: async () => ({ data: "" }),
    } as unknown as InstanceType<(typeof import("../axon/client.ts"))["AxonClient"]>;

    const clientMod = await import("../axon/client.ts");
    const connectStub = spyOn(clientMod.AxonClient, "connect").mockResolvedValue(fakeClient);

    const backend = await createDroneBackend({ repoRoot: "/fake/repo" });
    expect(backend).toBeInstanceOf(AxonDroneBackend);

    backend.close();
    resolveStub.mockRestore();
    daemonStub.mockRestore();
    connectStub.mockRestore();
  });

  it("never throws even if tryCreateAxonDroneBackend throws unexpectedly", async () => {
    const resolveMod = await import("../axon/resolve-binary.ts");
    const resolveStub = spyOn(resolveMod, "resolveAxonBinary").mockImplementation(() => {
      throw new Error("Unexpected kaboom");
    });
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const backend = await createDroneBackend({
      repoRoot: "/fake/repo",
      forceBackend: "axon",
    });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(warnMessages.some((m) => m.includes("Unexpected error"))).toBe(true);

    resolveStub.mockRestore();
    warnSpy.mockRestore();
    backend.close();
  });

  it("passes callerPane through to TmuxDroneBackend constructor context", async () => {
    const backend = await createDroneBackend({
      repoRoot: "/nonexistent/repo",
      forceBackend: "tmux",
      callerPane: "%42",
    });
    expect(backend).toBeInstanceOf(TmuxDroneBackend);
    backend.close();
  });

  it("close() method exists on returned backends", async () => {
    const backend = await createDroneBackend({ repoRoot: "/nonexistent/repo" });
    expect(typeof backend.close).toBe("function");
    backend.close();
  });
});
