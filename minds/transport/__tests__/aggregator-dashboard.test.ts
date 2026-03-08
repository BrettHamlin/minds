// aggregator-dashboard.test.ts — Integration tests for dashboard routes mounted in aggregator (BRE-445 T015)
//
// Verifies:
//   1. Dashboard routes are mounted in createAggregatorServer
//   2. Minds events from the SSE loop feed the state tracker
//   3. /subscribe/minds-status SSE emits state updates when events arrive

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createAggregatorServer, type StatusAggregator } from "../status-aggregator";
import { MindsEventType, type MindsBusMessage } from "../minds-events";
import type { MindsStateTracker } from "../../dashboard/state-tracker";

// ── Mock SSE bus that emits arbitrary events ─────────────────────────────────

interface MockBus {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  push(data: Record<string, unknown>): void;
  stop(): void;
}

function createMockBus(): MockBus {
  let seq = 0;
  const subs = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const srv = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/subscribe/status") {
        let ctrl!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            subs.add(c);
            c.enqueue(new TextEncoder().encode(": connected\n\n"));
          },
          cancel() {
            subs.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    server: srv,
    url: `http://localhost:${srv.port}`,
    push(data) {
      const s = ++seq;
      const encoded = new TextEncoder().encode(`id: ${s}\ndata: ${JSON.stringify(data)}\n\n`);
      for (const c of subs) {
        try { c.enqueue(encoded); } catch { subs.delete(c); }
      }
    },
    stop() {
      for (const c of subs) { try { c.close(); } catch {} }
      subs.clear();
      srv.stop(true);
    },
  };
}

// ── Dashboard dist stub ───────────────────────────────────────────────────────
// The /minds route serves minds/dashboard/dist/index.html. In tests, the dashboard
// dist isn't built, so we create a minimal stub to prevent ECONNRESET errors.

const DASHBOARD_DIST_DIR = join(
  import.meta.dir,
  "../../dashboard/dist",
);
const DASHBOARD_INDEX = join(DASHBOARD_DIST_DIR, "index.html");
let createdDistDir = false;

beforeAll(() => {
  if (!existsSync(DASHBOARD_DIST_DIR)) {
    mkdirSync(DASHBOARD_DIST_DIR, { recursive: true });
    createdDistDir = true;
  }
  if (!existsSync(DASHBOARD_INDEX)) {
    writeFileSync(DASHBOARD_INDEX, "<!DOCTYPE html><html><body>Minds Dashboard</body></html>", "utf8");
  }
});

afterAll(() => {
  if (createdDistDir) {
    try { rmSync(DASHBOARD_DIST_DIR, { recursive: true, force: true }); } catch {}
  }
});

// ── Test setup ────────────────────────────────────────────────────────────────

let tempDir: string;
let server: ReturnType<typeof createAggregatorServer>["server"];
let aggregator: StatusAggregator;
let mindsTracker: MindsStateTracker;
let baseUrl: string;

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `aggdash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRegistry(dir: string, filename: string, data: Record<string, unknown>): void {
  writeFileSync(join(dir, filename), JSON.stringify(data), "utf8");
}

beforeEach(() => {
  tempDir = makeTempDir();
  const result = createAggregatorServer({ port: 0, registryDir: tempDir });
  server = result.server;
  aggregator = result.aggregator;
  mindsTracker = result.mindsTracker;
  baseUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  aggregator.stop();
  server.stop(true);
  await Bun.sleep(10);
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

// ── Dashboard routes are mounted ─────────────────────────────────────────────

describe("dashboard routes mounted", () => {
  test("GET /minds returns HTML content type", async () => {
    const res = await fetch(`${baseUrl}/minds`);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("GET /minds does not fall through to 404", async () => {
    const res = await fetch(`${baseUrl}/minds`);
    // Route is handled — response is not 404
    expect(res.status).not.toBe(404);
  });

  test("GET /api/minds/active returns 200 with JSON array", async () => {
    const res = await fetch(`${baseUrl}/api/minds/active`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /api/minds/active returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/minds/active`);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(0);
  });

  test("GET /subscribe/minds-status returns event-stream content type", async () => {
    const ac = new AbortController();
    // Start the fetch (don't await yet — stream won't flush headers until data arrives)
    const fetchPromise = fetch(`${baseUrl}/subscribe/minds-status`, { signal: ac.signal });
    // Wait for the server to register the subscriber, then trigger a flush
    await Bun.sleep(100);
    mindsTracker.applyEvent({
      channel: "minds-FLUSH-1",
      from: "@test",
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId: "w0" },
      ticketId: "FLUSH-1",
      mindName: "test",
    });
    const res = await fetchPromise;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    ac.abort();
    await Bun.sleep(10);
  });

  test("unknown path still returns 404 (not intercepted by minds handler)", async () => {
    const res = await fetch(`${baseUrl}/not-a-real-route`);
    expect(res.status).toBe(404);
  });
});

// ── State tracker integration via direct feed ─────────────────────────────────

describe("tracker integration via direct applyEvent", () => {
  function makeMsg(
    type: MindsEventType,
    payload: unknown,
    ticketId = "TEST-445",
  ): MindsBusMessage {
    return {
      channel: `minds-${ticketId}`,
      from: "@test",
      type,
      payload,
      ticketId,
      mindName: "test-mind",
    };
  }

  test("feeding WAVE_STARTED to tracker makes active state visible via API", async () => {
    mindsTracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "w1", ticketTitle: "My Feature" }));

    const res = await fetch(`${baseUrl}/api/minds/active`);
    const body = await res.json() as Array<{ ticketId: string; ticketTitle: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].ticketId).toBe("TEST-445");
    expect(body[0].ticketTitle).toBe("My Feature");
  });

  test("feeding DRONE_SPAWNED updates active drone count", async () => {
    mindsTracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "w1" }));
    mindsTracker.applyEvent(makeMsg(MindsEventType.DRONE_SPAWNED, { waveId: "w1", mindName: "transport" }));
    mindsTracker.applyEvent(makeMsg(MindsEventType.DRONE_SPAWNED, { waveId: "w1", mindName: "dashboard" }));

    const res = await fetch(`${baseUrl}/api/minds/active`);
    const body = await res.json() as Array<{ stats: { activeDrones: number } }>;
    expect(body[0].stats.activeDrones).toBe(2);
  });
});

// ── SSE loop feeds tracker ────────────────────────────────────────────────────

describe("SSE loop feeds tracker from upstream bus", () => {
  const mockBuses: MockBus[] = [];

  afterEach(() => {
    for (const mb of mockBuses) { try { mb.stop(); } catch {} }
    mockBuses.length = 0;
  });

  function makeBus(): MockBus {
    const mb = createMockBus();
    mockBuses.push(mb);
    return mb;
  }

  async function waitForConnection(ticketId: string, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (aggregator.connections.get(ticketId)?.connected) return;
      await Bun.sleep(50);
    }
    throw new Error(`Timeout waiting for connection to ${ticketId}`);
  }

  async function waitForState(ticketId: string, timeoutMs = 3000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (mindsTracker.getState(ticketId)) return true;
      await Bun.sleep(30);
    }
    return false;
  }

  test("minds event from upstream bus is routed to state tracker", async () => {
    const bus = makeBus();
    writeRegistry(tempDir, "BRE-445.json", { ticket_id: "BRE-445", bus_url: bus.url });
    aggregator.scanRegistries();
    await waitForConnection("BRE-445");

    const mindsMsg: MindsBusMessage = {
      channel: "minds-BRE-445",
      from: "@transport",
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId: "wave-1", ticketTitle: "BRE-445 Feature" },
      ticketId: "BRE-445",
      mindName: "transport",
    };
    bus.push(mindsMsg as unknown as Record<string, unknown>);

    const found = await waitForState("BRE-445");
    expect(found).toBe(true);

    const state = mindsTracker.getState("BRE-445");
    expect(state).toBeDefined();
    expect(state!.ticketTitle).toBe("BRE-445 Feature");
    expect(state!.waves).toHaveLength(1);
  });

  test("non-minds events are not routed to state tracker", async () => {
    const bus = makeBus();
    writeRegistry(tempDir, "BRE-445.json", { ticket_id: "BRE-445", bus_url: bus.url });
    aggregator.scanRegistries();
    await waitForConnection("BRE-445");

    // Push a pipeline event (channel: "pipeline-BRE-445"), not a minds event
    bus.push({
      channel: "pipeline-BRE-445",
      from: "@orchestrator",
      type: "phase_changed",
      payload: { phase: "implement" },
      ticketId: "BRE-445",
    });

    await Bun.sleep(150);
    expect(mindsTracker.getState("BRE-445")).toBeUndefined();
  });

  test("SSE /subscribe/minds-status emits update when minds event arrives via bus", async () => {
    const bus = makeBus();
    writeRegistry(tempDir, "BRE-445.json", { ticket_id: "BRE-445", bus_url: bus.url });
    aggregator.scanRegistries();
    await waitForConnection("BRE-445");

    const mindsMsg: MindsBusMessage = {
      channel: "minds-BRE-445",
      from: "@transport",
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId: "wave-1", ticketTitle: "SSE Test" },
      ticketId: "BRE-445",
      mindName: "transport",
    };

    // Start the SSE connection (don't await yet — stream won't flush until data arrives)
    const ac = new AbortController();
    const fetchPromise = fetch(`${baseUrl}/subscribe/minds-status`, { signal: ac.signal });

    // Wait for server to register the tracker subscriber, then push the minds event
    await Bun.sleep(100);
    bus.push(mindsMsg as unknown as Record<string, unknown>);

    const res = await fetchPromise;
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames: string[] = [];

    // Read until we get a frame or timeout
    const readStart = Date.now();
    while (Date.now() - readStart < 3000) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) { if (p.trim()) frames.push(p); }
      if (frames.length >= 1) break;
    }

    ac.abort();
    await Bun.sleep(10);

    expect(frames.length).toBeGreaterThanOrEqual(1);
    const frame = frames[0];
    expect(frame).toContain("data: ");

    const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const state = JSON.parse(dataLine!.slice(6)) as { ticketId: string; ticketTitle: string };
    expect(state.ticketId).toBe("BRE-445");
    expect(state.ticketTitle).toBe("SSE Test");
  });
});
