import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import type { MindDescription } from "./mind.js";
import { dispatchToMind, waitForCompletion, dispatchWave, loadMindsRegistry } from "./dispatch.js";

// --- Fixtures ---

const mindA: MindDescription = {
  name: "signals",
  domain: "Signal emission and transport",
  keywords: ["signal", "emit"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals"],
};

const mindB: MindDescription = {
  name: "pipeline_core",
  domain: "Pipeline lifecycle management",
  keywords: ["pipeline", "lifecycle"],
  owns_files: ["minds/pipeline_core/"],
  capabilities: ["load pipeline config"],
};

const DEV_PANE_OUTPUT = JSON.stringify({
  mind_pane: "%0",
  drone_pane: "%1234",
  worktree: "/tmp/test-worktree",
  branch: "drone/test-branch",
  base: "main",
});

const MOCK_BUS_URL = "http://localhost:19999";
const MOCK_TICKET_ID = "BRE-444";
const MOCK_CHANNEL = `minds-${MOCK_TICKET_ID}`;

// --- Helpers ---

function makeTempRegistry(minds: MindDescription[]): { repoRoot: string; cleanup: () => void } {
  const repoRoot = mkdtempSync("/tmp/dispatch-test-");
  mkdirSync(join(repoRoot, ".collab"), { recursive: true });
  writeFileSync(join(repoRoot, ".collab/minds.json"), JSON.stringify(minds));
  return { repoRoot, cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

/** Create a minimal mock Subprocess for spyOn(Bun, "spawn") */
function makeProcess(exitCode: number, stdout: string, stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    pid: 99999,
    kill: () => {},
    stdin: null,
    readable: null,
    writable: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Build a mock fetch that:
 * - Returns 200 OK for /publish
 * - Returns an SSE stream with the given events for /subscribe/...
 */
function makeMockFetch(sseEvents: Array<Record<string, unknown>> = []) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);

    if (url.includes("/publish")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (url.includes("/subscribe/")) {
      const chunks = sseEvents.map(
        (evt) => `data: ${JSON.stringify(evt)}\n\n`
      );
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          // Keep stream open (SSE doesn't close immediately)
        },
      });
      return new Response(stream, { status: 200 });
    }

    return new Response("", { status: 200 });
  };
}

function makeDroneCompleteEvent(mindName: string) {
  return {
    id: "test-1",
    channel: MOCK_CHANNEL,
    from: "drone",
    type: "DRONE_COMPLETE",
    payload: { mindName },
    timestamp: Date.now(),
  };
}

// --- loadMindsRegistry ---

describe("loadMindsRegistry", () => {
  it("loads and parses a valid registry file", () => {
    const { repoRoot, cleanup } = makeTempRegistry([mindA, mindB]);
    try {
      const registry = loadMindsRegistry(join(repoRoot, ".collab/minds.json"));
      expect(registry).toHaveLength(2);
      expect(registry[0].name).toBe("signals");
      expect(registry[1].name).toBe("pipeline_core");
    } finally {
      cleanup();
    }
  });

  it("throws when registry file does not exist", () => {
    expect(() => loadMindsRegistry("/tmp/nonexistent-minds.json")).toThrow();
  });
});

// --- dispatchToMind ---

describe("dispatchToMind", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let repoRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = makeTempRegistry([mindA, mindB]);
    repoRoot = tmp.repoRoot;
    cleanup = tmp.cleanup;

    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) {
        return makeProcess(0, DEV_PANE_OUTPUT);
      }
      return makeProcess(0, "");
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch() as typeof globalThis.fetch
    );
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    fetchSpy.mockRestore();
    cleanup();
  });

  it("resolves with paneId, worktree, branch on success", async () => {
    const result = await dispatchToMind("signals", "Do the work", {
      repoRoot,
      busUrl: MOCK_BUS_URL,
      ticketId: MOCK_TICKET_ID,
    });
    expect(result.paneId).toBe("%1234");
    expect(result.worktree).toBe("/tmp/test-worktree");
    expect(result.branch).toBe("drone/test-branch");
  });

  it("throws for unknown mind name", async () => {
    await expect(
      dispatchToMind("nonexistent", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID })
    ).rejects.toThrow('Mind not found in registry: "nonexistent"');
  });

  it("does not throw for known mind name", async () => {
    await expect(
      dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID })
    ).resolves.toBeDefined();
  });

  it("also accepts pipeline_core (second mind in registry)", async () => {
    const result = await dispatchToMind("pipeline_core", "brief", {
      repoRoot,
      busUrl: MOCK_BUS_URL,
      ticketId: MOCK_TICKET_ID,
    });
    expect(result.paneId).toBe("%1234");
  });

  it("spawns drone-pane.ts with --mind and --ticket flags", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });
    const calls = spawnSpy.mock.calls;
    const dronePaneCall = calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("drone-pane.ts"))
    );
    expect(dronePaneCall).toBeDefined();
    const args = dronePaneCall![0] as string[];
    expect(args).toContain("--mind");
    expect(args).toContain("signals");
    expect(args).toContain("--ticket");
    expect(args).toContain(MOCK_TICKET_ID);
  });

  it("publishes DRONE_SPAWNED event via bus when busUrl and ticketId provided", async () => {
    await dispatchToMind("signals", "brief text", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });

    const publishCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes("/publish")
    );
    expect(publishCalls.length).toBeGreaterThan(0);
  });

  it("publishes to the correct channel for the ticketId", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });

    const publishCall = fetchSpy.mock.calls.find((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes("/publish")
    );
    expect(publishCall).toBeDefined();

    // The body should contain the correct channel
    const body = await (publishCall![1] as RequestInit).body;
    const parsed = JSON.parse(String(body));
    expect(parsed.channel).toBe(MOCK_CHANNEL);
    expect(parsed.type).toBe("DRONE_SPAWNED");
  });

  it("passes --branch option to drone-pane.ts", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, branch: "my-branch", busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });
    const dronePaneCall = spawnSpy.mock.calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("drone-pane.ts"))
    );
    expect(dronePaneCall).toBeDefined();
    const args = dronePaneCall![0] as string[];
    expect(args).toContain("--branch");
    expect(args).toContain("my-branch");
  });

  it("passes --base option to drone-pane.ts", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, base: "dev", busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });
    const dronePaneCall = spawnSpy.mock.calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("drone-pane.ts"))
    );
    const args = dronePaneCall![0] as string[];
    expect(args).toContain("--base");
    expect(args).toContain("dev");
  });

  it("passes --bus-url to drone-pane.ts when busUrl provided", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });
    const dronePaneCall = spawnSpy.mock.calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("drone-pane.ts"))
    );
    expect(dronePaneCall).toBeDefined();
    const args = dronePaneCall![0] as string[];
    expect(args).toContain("--bus-url");
    expect(args).toContain(MOCK_BUS_URL);
  });

  it("does not pass --bus-url to drone-pane.ts when busUrl not provided", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      return makeProcess(0, "");
    });

    await dispatchToMind("signals", "brief", { repoRoot });

    const dronePaneCall = spawnSpy.mock.calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("drone-pane.ts"))
    );
    const args = dronePaneCall![0] as string[];
    expect(args).not.toContain("--bus-url");
  });

  it("throws when drone-pane.ts exits non-zero", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) {
        return makeProcess(1, "", "pane creation failed");
      }
      return makeProcess(0, "");
    });
    await expect(
      dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID })
    ).rejects.toThrow("drone-pane.ts failed");
  });

  it("throws when drone-pane.ts returns invalid JSON", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) {
        return makeProcess(0, "not json at all");
      }
      return makeProcess(0, "");
    });
    await expect(
      dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID })
    ).rejects.toThrow("invalid JSON");
  });

  it("does not throw when DRONE_SPAWNED publish fails (non-critical notification)", async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/publish")) {
        return new Response("internal error", { status: 500 });
      }
      return new Response("", { status: 200 });
    });
    // Brief delivery (tmux-send) should succeed; DRONE_SPAWNED failure is swallowed
    await expect(
      dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID })
    ).resolves.toBeDefined();
  });

  it("always uses tmux-send.ts for brief delivery (with or without busUrl)", async () => {
    // With busUrl
    await dispatchToMind("signals", "brief", { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID });
    const callsWithBus = spawnSpy.mock.calls;
    const hasTmuxSendWithBus = callsWithBus.some((c) =>
      (c[0] as string[]).some((a) => a.includes("tmux-send.ts"))
    );
    expect(hasTmuxSendWithBus).toBe(true);
  });

  it("uses tmux-send.ts for brief delivery when no busUrl provided", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      if (args.some((a) => a.includes("tmux-send.ts"))) return makeProcess(0, "");
      return makeProcess(0, "");
    });

    await dispatchToMind("signals", "brief", { repoRoot });

    const calls = spawnSpy.mock.calls;
    const hasTmuxSend = calls.some((c) =>
      (c[0] as string[]).some((a) => a.includes("tmux-send.ts"))
    );
    expect(hasTmuxSend).toBe(true);
  });

  it("throws when legacy tmux-send.ts exits non-zero", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) {
        return makeProcess(0, DEV_PANE_OUTPUT);
      }
      if (args.some((a) => a.includes("tmux-send.ts"))) {
        return makeProcess(1, "", "send failed");
      }
      return makeProcess(0, "");
    });
    await expect(dispatchToMind("signals", "brief", { repoRoot })).rejects.toThrow(
      "tmux-send.ts failed"
    );
  });
});

// --- waitForCompletion ---

describe("waitForCompletion (bus mode)", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("returns success when DRONE_COMPLETE event arrives on bus for matching mind", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([makeDroneCompleteEvent("signals")]) as typeof globalThis.fetch
    );

    const result = await waitForCompletion("%1234", "signals", {
      busUrl: MOCK_BUS_URL,
      channel: MOCK_CHANNEL,
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
  });

  it("returns success with output containing the event payload", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([makeDroneCompleteEvent("signals")]) as typeof globalThis.fetch
    );

    const result = await waitForCompletion("%1234", "signals", {
      busUrl: MOCK_BUS_URL,
      channel: MOCK_CHANNEL,
      timeoutMs: 5000,
    });

    expect(result.output).toContain("signals");
  });

  it("returns failure on timeout (timeoutMs: 0) when bus is empty", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([]) as typeof globalThis.fetch
    );

    const result = await waitForCompletion("%1234", "signals", {
      busUrl: MOCK_BUS_URL,
      channel: MOCK_CHANNEL,
      timeoutMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
  });

  it("subscribes to the correct bus channel", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([makeDroneCompleteEvent("signals")]) as typeof globalThis.fetch
    );

    await waitForCompletion("%1234", "signals", {
      busUrl: MOCK_BUS_URL,
      channel: MOCK_CHANNEL,
      timeoutMs: 5000,
    });

    const subscribeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes("/subscribe/")
    );
    expect(subscribeCalls.length).toBeGreaterThan(0);
    const url = String(subscribeCalls[0][0] instanceof Request
      ? subscribeCalls[0][0].url
      : subscribeCalls[0][0]);
    expect(url).toContain(encodeURIComponent(MOCK_CHANNEL));
  });

  it("does not match a different mind's DRONE_COMPLETE event", async () => {
    // Event is for "signals" but we're waiting for "pipeline_core"
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([makeDroneCompleteEvent("signals")]) as typeof globalThis.fetch
    );

    const result = await waitForCompletion("%1234", "pipeline_core", {
      busUrl: MOCK_BUS_URL,
      channel: MOCK_CHANNEL,
      timeoutMs: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe("waitForCompletion (legacy tmux mode)", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  it("returns success when MIND_COMPLETE signal is in pane output", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "some output\nMIND_COMPLETE @signals\nmore lines")
    );

    const result = await waitForCompletion("%1234", "signals", {
      pollIntervalMs: 0,
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("MIND_COMPLETE @signals");
  });

  it("returns failure on timeout when signal is never found", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "still working... no signal here")
    );

    const result = await waitForCompletion("%1234", "signals", {
      pollIntervalMs: 0,
      timeoutMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
  });

  it("polls tmux capture-pane with the correct pane ID", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "MIND_COMPLETE @pipeline_core")
    );

    await waitForCompletion("%9999", "pipeline_core", { pollIntervalMs: 0, timeoutMs: 1000 });

    const firstCall = spawnSpy.mock.calls[0];
    const args = firstCall[0] as string[];
    expect(args).toEqual(["tmux", "capture-pane", "-t", "%9999", "-p"]);
  });

  it("does not match a different mind's MIND_COMPLETE signal", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "MIND_COMPLETE @signals")
    );

    const result = await waitForCompletion("%1234", "pipeline_core", {
      pollIntervalMs: 0,
      timeoutMs: 0,
    });

    expect(result.success).toBe(false);
  });

  it("returns output string on success", async () => {
    const paneContent = "line1\nline2\nMIND_COMPLETE @signals\nline3";
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => makeProcess(0, paneContent));

    const result = await waitForCompletion("%1234", "signals", {
      pollIntervalMs: 0,
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe(paneContent);
  });
});

// --- dispatchWave ---

describe("dispatchWave", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let repoRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = makeTempRegistry([mindA, mindB]);
    repoRoot = tmp.repoRoot;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    spawnSpy?.mockRestore();
    fetchSpy?.mockRestore();
    cleanup();
  });

  it("returns CompletionResult for each mind in the wave", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      return makeProcess(0, "");
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([
        makeDroneCompleteEvent("signals"),
        makeDroneCompleteEvent("pipeline_core"),
      ]) as typeof globalThis.fetch
    );

    const results = await dispatchWave(
      ["signals", "pipeline_core"],
      { signals: "signals brief", pipeline_core: "pipeline brief" },
      {
        dispatch: { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID },
        wait: { timeoutMs: 5000 },
        ticketId: MOCK_TICKET_ID,
      }
    );

    expect(results).toHaveProperty("signals");
    expect(results).toHaveProperty("pipeline_core");
    expect(results.signals.success).toBe(true);
    expect(results.pipeline_core.success).toBe(true);
  });

  it("dispatches all minds — dev-pane.ts called once per mind", async () => {
    let devPaneCallCount = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) {
        devPaneCallCount++;
        return makeProcess(0, DEV_PANE_OUTPUT);
      }
      return makeProcess(0, "");
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([
        makeDroneCompleteEvent("signals"),
        makeDroneCompleteEvent("pipeline_core"),
      ]) as typeof globalThis.fetch
    );

    await dispatchWave(
      ["signals", "pipeline_core"],
      { signals: "brief A", pipeline_core: "brief B" },
      {
        dispatch: { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID },
        wait: { timeoutMs: 5000 },
        ticketId: MOCK_TICKET_ID,
      }
    );

    expect(devPaneCallCount).toBe(2);
  });

  it("throws if brief is missing for a mind", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => makeProcess(0, ""));
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch() as typeof globalThis.fetch
    );

    await expect(
      dispatchWave(["signals"], {}, {
        dispatch: { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID },
        ticketId: MOCK_TICKET_ID,
      })
    ).rejects.toThrow('No brief provided for mind: "signals"');
  });

  it("handles single-mind wave", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      return makeProcess(0, "");
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([makeDroneCompleteEvent("signals")]) as typeof globalThis.fetch
    );

    const results = await dispatchWave(
      ["signals"],
      { signals: "brief" },
      {
        dispatch: { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID },
        wait: { timeoutMs: 5000 },
        ticketId: MOCK_TICKET_ID,
      }
    );

    expect(Object.keys(results)).toHaveLength(1);
    expect(results.signals.success).toBe(true);
  });

  it("returns failure for minds that time out", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      return makeProcess(0, "");
    });

    // No DRONE_COMPLETE events — timeout immediately
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([]) as typeof globalThis.fetch
    );

    const results = await dispatchWave(
      ["signals"],
      { signals: "brief" },
      {
        dispatch: { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID },
        wait: { timeoutMs: 0 },
        ticketId: MOCK_TICKET_ID,
      }
    );

    expect(results.signals.success).toBe(false);
  });

  it("propagates busUrl from dispatch options to dispatchToMind (publishes via bus)", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("drone-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      return makeProcess(0, "");
    });

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeMockFetch([makeDroneCompleteEvent("signals")]) as typeof globalThis.fetch
    );

    await dispatchWave(
      ["signals"],
      { signals: "brief" },
      {
        dispatch: { repoRoot, busUrl: MOCK_BUS_URL, ticketId: MOCK_TICKET_ID },
        wait: { timeoutMs: 5000 },
        ticketId: MOCK_TICKET_ID,
      }
    );

    // At least one publish call should have been made
    const publishCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes("/publish")
    );
    expect(publishCalls.length).toBeGreaterThan(0);
  });
});
