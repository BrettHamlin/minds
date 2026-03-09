// minds-bus-aggregator.test.ts — Tests for Minds bus state file scanning (BRE-450)
//
// Verifies:
//   1. scanMindsBusStates() picks up minds-bus-*.json files and calls connectToBus()
//   2. Minds events routed through the connection reach the MindsStateTracker
//   3. Cleanup: connections removed when minds-bus state files are deleted
//   4. URL changes in state files reconnect to the new bus

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createAggregatorServer,
  StatusAggregator,
} from "../status-aggregator";
import { MindsEventType, type MindsBusMessage } from "../minds-events";
import type { MindsStateTracker } from "../../dashboard/state-tracker";

// ── Mock SSE bus ─────────────────────────────────────────────────────────────

interface MockBus {
  server: ReturnType<typeof Bun.serve>;
  port: number;
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
      if (url.pathname.startsWith("/subscribe/")) {
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
    port: srv.port,
    url: `http://localhost:${srv.port}`,
    push(data) {
      const s = ++seq;
      const encoded = new TextEncoder().encode(
        `id: ${s}\ndata: ${JSON.stringify(data)}\n\n`,
      );
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

// ── Directory helpers ─────────────────────────────────────────────────────────
//
// Production layout:
//   .collab/state/                    ← stateDir  (minds-bus-*.json live here)
//   .collab/state/pipeline-registry/  ← registryDir
//
// We mirror this in tests so join(registryDir, "..") == stateDir.

let stateDir: string;
let registryDir: string;
let server: ReturnType<typeof createAggregatorServer>["server"];
let aggregator: StatusAggregator;
let mindsTracker: MindsStateTracker;
let baseUrl: string;

function makeTempStateDir(): string {
  const dir = join(
    tmpdir(),
    `minds-bus-agg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMindsBusState(
  dir: string,
  ticketId: string,
  busUrl: string,
): void {
  const content = JSON.stringify({
    busUrl,
    busServerPid: 99999,
    bridgePid: 99998,
    ticketId,
    startedAt: new Date().toISOString(),
  });
  writeFileSync(join(dir, `minds-bus-${ticketId}.json`), content, "utf8");
}

async function waitForConnection(
  agg: StatusAggregator,
  key: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (agg.connections.get(key)?.connected) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timeout waiting for connection: ${key}`);
}

beforeEach(() => {
  stateDir = makeTempStateDir();
  registryDir = join(stateDir, "pipeline-registry");
  mkdirSync(registryDir, { recursive: true });

  const result = createAggregatorServer({ port: 0, registryDir });
  server = result.server;
  aggregator = result.aggregator;
  mindsTracker = result.mindsTracker;
  baseUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  aggregator.stop();
  server.stop(true);
  await Bun.sleep(10);
  try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
});

// ── scanMindsBusStates() unit tests ──────────────────────────────────────────

describe("scanMindsBusStates()", () => {
  test("detects a minds-bus-*.json file and creates a connection", () => {
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55560");

    aggregator.scanMindsBusStates();

    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);
    const conn = aggregator.connections.get("minds-BRE-450")!;
    expect(conn.busUrl).toBe("http://localhost:55560");
    expect(conn.ticketId).toBe("minds-BRE-450");
  });

  test("does not create duplicate connections on re-scan", () => {
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55560");

    aggregator.scanMindsBusStates();
    aggregator.scanMindsBusStates();

    expect(aggregator.getConnectionCount()).toBe(1);
  });

  test("detects multiple minds-bus state files", () => {
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55560");
    writeMindsBusState(stateDir, "BRE-451", "http://localhost:55561");

    aggregator.scanMindsBusStates();

    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);
    expect(aggregator.connections.has("minds-BRE-451")).toBe(true);
    expect(aggregator.getConnectionCount()).toBe(2);
  });

  test("removes connection when minds-bus state file is deleted", () => {
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55560");
    aggregator.scanMindsBusStates();
    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);

    unlinkSync(join(stateDir, "minds-bus-BRE-450.json"));
    aggregator.scanMindsBusStates();

    expect(aggregator.connections.has("minds-BRE-450")).toBe(false);
  });

  test("reconnects when busUrl changes in state file", () => {
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55560");
    aggregator.scanMindsBusStates();
    const oldConn = aggregator.connections.get("minds-BRE-450")!;
    const oldAbort = oldConn.abortController;

    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55570");
    aggregator.scanMindsBusStates();

    expect(oldAbort.signal.aborted).toBe(true);
    const newConn = aggregator.connections.get("minds-BRE-450")!;
    expect(newConn.busUrl).toBe("http://localhost:55570");
  });

  test("skips state files with missing busUrl or ticketId", () => {
    writeFileSync(
      join(stateDir, "minds-bus-BAD.json"),
      JSON.stringify({ busServerPid: 123 }), // no busUrl, no ticketId
      "utf8",
    );

    aggregator.scanMindsBusStates();

    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("skips corrupt JSON files without throwing", () => {
    writeFileSync(join(stateDir, "minds-bus-CORRUPT.json"), "not json", "utf8");

    expect(() => aggregator.scanMindsBusStates()).not.toThrow();
    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("minds connections do not interfere with pipeline registry connections", () => {
    // Add a pipeline registry entry
    writeFileSync(
      join(registryDir, "BRE-450.json"),
      JSON.stringify({ ticket_id: "BRE-450", bus_url: "http://localhost:55580" }),
      "utf8",
    );
    aggregator.scanRegistries();
    expect(aggregator.connections.has("BRE-450")).toBe(true);

    // Add a Minds bus state for the same ticket
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55590");
    aggregator.scanMindsBusStates();

    // Both connections should exist under different keys
    expect(aggregator.connections.has("BRE-450")).toBe(true);
    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);
    expect(aggregator.getConnectionCount()).toBe(2);
  });

  test("scanRegistries() cleanup does not remove minds-prefixed connections", () => {
    writeMindsBusState(stateDir, "BRE-450", "http://localhost:55560");
    aggregator.scanMindsBusStates();
    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);

    // Run pipeline registry scan — no pipeline registry files exist
    aggregator.scanRegistries();

    // Minds connection should still be present
    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);
  });
});

// ── End-to-end: Minds events routed to MindsStateTracker ─────────────────────

describe("Minds bus events reach the MindsStateTracker", () => {
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

  async function waitForState(ticketId: string, timeoutMs = 3000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (mindsTracker.getState(ticketId)) return true;
      await Bun.sleep(30);
    }
    return false;
  }

  test("WAVE_STARTED event via Minds bus reaches state tracker", async () => {
    const bus = makeBus();
    writeMindsBusState(stateDir, "BRE-450", bus.url);
    aggregator.scanMindsBusStates();
    await waitForConnection(aggregator, "minds-BRE-450");

    const mindsMsg: MindsBusMessage = {
      channel: "minds-BRE-450",
      from: "@transport",
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId: "wave-1", ticketTitle: "BRE-450 Signals" },
      ticketId: "BRE-450",
      mindName: "transport",
    };
    bus.push(mindsMsg as unknown as Record<string, unknown>);

    const found = await waitForState("BRE-450");
    expect(found).toBe(true);

    const state = mindsTracker.getState("BRE-450");
    expect(state).toBeDefined();
    expect(state!.ticketTitle).toBe("BRE-450 Signals");
    expect(state!.waves).toHaveLength(1);
  });

  test("DRONE_SPAWNED event updates active drone count in state tracker", async () => {
    const bus = makeBus();
    writeMindsBusState(stateDir, "BRE-450", bus.url);
    aggregator.scanMindsBusStates();
    await waitForConnection(aggregator, "minds-BRE-450");

    bus.push({
      channel: "minds-BRE-450",
      from: "@transport",
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId: "w1" },
      ticketId: "BRE-450",
      mindName: "transport",
    } as unknown as Record<string, unknown>);

    bus.push({
      channel: "minds-BRE-450",
      from: "@transport",
      type: MindsEventType.DRONE_SPAWNED,
      payload: { waveId: "w1", mindName: "signals" },
      ticketId: "BRE-450",
      mindName: "transport",
    } as unknown as Record<string, unknown>);

    bus.push({
      channel: "minds-BRE-450",
      from: "@signals",
      type: MindsEventType.DRONE_SPAWNED,
      payload: { waveId: "w1", mindName: "dashboard" },
      ticketId: "BRE-450",
      mindName: "signals",
    } as unknown as Record<string, unknown>);

    await waitForState("BRE-450");

    // Poll until we see 2 drones
    const start = Date.now();
    let stats = { activeDrones: 0 };
    while (Date.now() - start < 3000) {
      const s = mindsTracker.getState("BRE-450");
      if (s && s.stats.activeDrones === 2) {
        stats = s.stats;
        break;
      }
      await Bun.sleep(30);
    }
    expect(stats.activeDrones).toBe(2);
  });

  test("fs.watch on state dir triggers scan when minds-bus file is created", async () => {
    const bus = makeBus();

    // Don't write the file yet — let the watcher detect it
    expect(aggregator.connections.has("minds-BRE-450")).toBe(false);

    writeMindsBusState(stateDir, "BRE-450", bus.url);

    // Wait for debounce (200ms) + margin
    await Bun.sleep(400);

    expect(aggregator.connections.has("minds-BRE-450")).toBe(true);
  });
});
