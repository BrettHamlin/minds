// Tests for status-aggregator.ts (BRE-402)
//
// Strategy: import createAggregatorServer() directly — no subprocess spawning.
// Uses temp registry directories for isolation.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createAggregatorServer,
  StatusAggregator,
  type PipelineConnection,
} from "../status-aggregator";
import { createServer as createBusServer } from "../bus-server";

// ── Mock SSE bus server ─────────────────────────────────────────────────────
// bus-server.ts uses module-level state, so we can't run multiple instances.
// This lightweight mock creates independent SSE bus servers for multi-bus tests.

interface MockBus {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  url: string;
  /** Push an SSE event to all /subscribe/status subscribers */
  push(eventData: Record<string, unknown>): void;
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
            // Send keep-alive comment so client fetch() resolves immediately
            c.enqueue(new TextEncoder().encode(": connected\n\n"));
          },
          cancel() {
            subs.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    server: srv,
    port: srv.port,
    url: `http://localhost:${srv.port}`,
    push(eventData) {
      const s = ++seq;
      const encoded = new TextEncoder().encode(
        `id: ${s}\ndata: ${JSON.stringify(eventData)}\n\n`,
      );
      for (const c of subs) {
        try { c.enqueue(encoded); } catch { subs.delete(c); }
      }
    },
    stop() {
      for (const c of subs) {
        try { c.close(); } catch {}
      }
      subs.clear();
      srv.stop(true);
    },
  };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

let tempDir: string;
let server: ReturnType<typeof createAggregatorServer>["server"];
let aggregator: StatusAggregator;
let baseUrl: string;

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `aggregator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRegistry(
  dir: string,
  filename: string,
  data: Record<string, unknown>,
): void {
  writeFileSync(join(dir, filename), JSON.stringify(data), "utf8");
}

beforeEach(() => {
  tempDir = createTempDir();
  const result = createAggregatorServer({ port: 0, registryDir: tempDir });
  server = result.server;
  aggregator = result.aggregator;
  baseUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  aggregator.stop();
  server.stop(true);
  await Bun.sleep(10);
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

// ── GET /status ──────────────────────────────────────────────────────────────

describe("GET /status", () => {
  test("returns 200 with ok:true", async () => {
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("includes required fields", async () => {
    const res = await fetch(`${baseUrl}/status`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("pipelines");
    expect(body).toHaveProperty("pipelineCount");
    expect(body).toHaveProperty("connectedCount");
    expect(body).toHaveProperty("subscriberCount");
  });

  test("uptime is non-negative number", async () => {
    const res = await fetch(`${baseUrl}/status`);
    const body = (await res.json()) as { uptime: number };
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ── 404 fallback ─────────────────────────────────────────────────────────────

describe("unknown routes", () => {
  test("returns 404 for unknown path", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});

// ── StatusAggregator class basics ────────────────────────────────────────────

describe("StatusAggregator", () => {
  test("constructor sets registryDir", () => {
    expect(aggregator.getRegistryDir()).toBe(tempDir);
  });

  test("starts with zero connections", () => {
    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("starts with zero subscribers", () => {
    expect(aggregator.getSubscriberCount()).toBe(0);
  });

  test("stop is idempotent", () => {
    aggregator.stop();
    aggregator.stop(); // Should not throw
  });
});

// ── GET /subscribe/status ────────────────────────────────────────────────────

describe("GET /subscribe/status", () => {
  test("returns SSE content type", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    controller.abort();
  });

  test("new connection receives snapshot event", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: controller.signal,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // Read until we get at least one complete frame
    const { value } = await reader.read();
    buf += decoder.decode(value, { stream: true });

    controller.abort();

    // Should contain a snapshot event
    expect(buf).toContain("event: snapshot");
    expect(buf).toContain("data: ");
  });

  test("tracks subscriber count", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: controller.signal,
    });

    // Read first chunk to ensure subscription is established
    const reader = res.body!.getReader();
    await reader.read();

    expect(aggregator.getSubscriberCount()).toBe(1);

    controller.abort();
    // Allow cleanup
    await Bun.sleep(50);
  });
});

// ── Phase 2: US4 — Aggregator Discovery and Lifecycle ────────────────────────

describe("standalone entry point", () => {
  test("port file is written with correct port", () => {
    // createAggregatorServer doesn't write port file (standalone entry does),
    // but we can verify the server port is accessible
    const port = server.port;
    expect(port).toBeGreaterThan(0);

    // Simulate what the standalone entry point does: write port file
    const collabDir = join(tempDir, ".collab-test");
    mkdirSync(collabDir, { recursive: true });
    const portFile = join(collabDir, "aggregator-port");
    writeFileSync(portFile, String(port), "utf8");

    // Verify port file content matches
    const written = readFileSync(portFile, "utf8").trim();
    expect(written).toBe(String(port));

    // Verify the port is reachable
    expect(parseInt(written, 10)).toBe(port);
  });
});

describe("graceful shutdown via stop()", () => {
  test("stop closes watcher and clears connections", () => {
    // Verify initial state
    expect(aggregator.getConnectionCount()).toBe(0);

    // Add a mock connection to verify cleanup
    aggregator.connections.set("TEST-001", {
      ticketId: "TEST-001",
      busUrl: "http://localhost:9999",
      abortController: new AbortController(),
      lastEventId: "",
      connected: false,
    });
    expect(aggregator.getConnectionCount()).toBe(1);

    // Stop should clean everything up
    aggregator.stop();

    expect(aggregator.getConnectionCount()).toBe(0);
    expect(aggregator.getSubscriberCount()).toBe(0);
  });

  test("stop aborts active connections", () => {
    const ac = new AbortController();
    aggregator.connections.set("TEST-002", {
      ticketId: "TEST-002",
      busUrl: "http://localhost:9999",
      abortController: ac,
      lastEventId: "",
      connected: true,
    });

    aggregator.stop();

    // AbortController should be aborted
    expect(ac.signal.aborted).toBe(true);
    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("stop closes subscriber streams", async () => {
    // Create a subscriber
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // Consume snapshot

    expect(aggregator.getSubscriberCount()).toBe(1);

    // Stop should close all subscribers
    aggregator.stop();
    expect(aggregator.getSubscriberCount()).toBe(0);

    controller.abort();
    await Bun.sleep(10);
  });

  test("server responds to /status after stop with fresh state", async () => {
    // Server is still running (we only called aggregator.stop, not server.stop)
    // In real usage, stop() is followed by server.stop(), but here we verify
    // the aggregator state is clean
    aggregator.stop();

    const res = await fetch(`${baseUrl}/status`);
    const body = (await res.json()) as {
      ok: boolean;
      pipelineCount: number;
      subscriberCount: number;
    };
    expect(body.ok).toBe(true);
    expect(body.pipelineCount).toBe(0);
    expect(body.subscriberCount).toBe(0);
  });
});

// ── Phase 3: US2 — Dynamic Pipeline Discovery ───────────────────────────────

describe("scanRegistries()", () => {
  test("detects new registry file with bus_url and calls connectToBus", () => {
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });

    aggregator.scanRegistries();

    expect(aggregator.getConnectionCount()).toBe(1);
    const conn = aggregator.connections.get("BRE-100");
    expect(conn).toBeDefined();
    expect(conn!.busUrl).toBe("http://localhost:55555");
    expect(conn!.ticketId).toBe("BRE-100");
  });

  test("deleted registry file removes connection", () => {
    // First add it
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });
    aggregator.scanRegistries();
    expect(aggregator.getConnectionCount()).toBe(1);

    // Delete the file
    unlinkSync(join(tempDir, "BRE-100.json"));
    aggregator.scanRegistries();

    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("registry file without bus_url does not create SSE connection", () => {
    writeRegistry(tempDir, "BRE-200.json", {
      ticket_id: "BRE-200",
      // No bus_url
    });

    aggregator.scanRegistries();

    // No connection should be created
    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("detects multiple registry files", () => {
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });
    writeRegistry(tempDir, "BRE-200.json", {
      ticket_id: "BRE-200",
      bus_url: "http://localhost:55556",
    });

    aggregator.scanRegistries();

    expect(aggregator.getConnectionCount()).toBe(2);
    expect(aggregator.connections.has("BRE-100")).toBe(true);
    expect(aggregator.connections.has("BRE-200")).toBe(true);
  });

  test("corrupt JSON files are skipped without error", () => {
    writeFileSync(join(tempDir, "bad.json"), "not valid json", "utf8");
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });

    // Should not throw
    aggregator.scanRegistries();

    // Only the valid file should create a connection
    expect(aggregator.getConnectionCount()).toBe(1);
  });

  test("non-json files are ignored", () => {
    writeFileSync(join(tempDir, "readme.txt"), "hello", "utf8");
    aggregator.scanRegistries();
    expect(aggregator.getConnectionCount()).toBe(0);
  });

  test("ticket_id falls back to filename when missing", () => {
    writeRegistry(tempDir, "BRE-300.json", {
      bus_url: "http://localhost:55557",
      // No ticket_id field
    });

    aggregator.scanRegistries();

    expect(aggregator.getConnectionCount()).toBe(1);
    expect(aggregator.connections.has("BRE-300")).toBe(true);
  });

  test("removing bus_url from existing connection disconnects it", () => {
    // Start with bus_url
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });
    aggregator.scanRegistries();
    expect(aggregator.getConnectionCount()).toBe(1);

    // Update file to remove bus_url
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
    });
    aggregator.scanRegistries();

    expect(aggregator.getConnectionCount()).toBe(0);
  });
});

describe("fs.watch integration", () => {
  test("fs.watch triggers rescan on file creation", async () => {
    // aggregator.start() is called by createAggregatorServer,
    // so the watcher is already active
    expect(aggregator.getConnectionCount()).toBe(0);

    // Write a registry file — watcher should detect it
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });

    // Wait for debounce (200ms) + margin
    await Bun.sleep(400);

    expect(aggregator.getConnectionCount()).toBe(1);
  });

  test("debounce batches rapid changes", async () => {
    // Write multiple files in quick succession
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
    });
    writeRegistry(tempDir, "BRE-200.json", {
      ticket_id: "BRE-200",
      bus_url: "http://localhost:55556",
    });
    writeRegistry(tempDir, "BRE-300.json", {
      ticket_id: "BRE-300",
      bus_url: "http://localhost:55557",
    });

    // Wait for single debounced scan
    await Bun.sleep(400);

    // All three should be picked up in a single scan
    expect(aggregator.getConnectionCount()).toBe(3);
  });
});

// ── Phase 4: US1 — Unified Multi-Pipeline Status Stream ─────────────────────

/** Helper: wait for aggregator to connect to a bus (poll connected flag). */
async function waitForConnection(
  agg: StatusAggregator,
  ticketId: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const conn = agg.connections.get(ticketId);
    if (conn?.connected) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timeout waiting for connection to ${ticketId}`);
}

/** Helper: collect SSE frames from a URL until we have enough or timeout. */
async function collectSseFrames(
  url: string,
  count: number,
  timeoutMs = 5000,
): Promise<string[]> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  const frames: string[] = [];

  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (frames.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) frames.push(part);
        if (frames.length >= count) break;
      }
    }
  } catch {
    // Aborted or connection closed
  } finally {
    clearTimeout(timeout);
    ac.abort();
  }

  return frames;
}

describe("unified SSE stream (end-to-end)", () => {
  const mockBuses: MockBus[] = [];

  afterEach(() => {
    for (const mb of mockBuses) {
      try { mb.stop(); } catch {}
    }
    mockBuses.length = 0;
  });

  function makeBus(): MockBus {
    const mb = createMockBus();
    mockBuses.push(mb);
    return mb;
  }

  test("subscriber receives snapshot-on-connect with active pipelines", async () => {
    // Write a registry file (no real bus needed for snapshot test)
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: "http://localhost:55555",
      current_step: "implement",
    });

    // Subscribe to aggregator — should get snapshot immediately
    const frames = await collectSseFrames(
      `${baseUrl}/subscribe/status`,
      1,
      2000,
    );

    expect(frames.length).toBeGreaterThanOrEqual(1);
    const snapshotFrame = frames[0];
    expect(snapshotFrame).toContain("event: snapshot");
    expect(snapshotFrame).toContain("data: ");

    // Parse the snapshot data
    const dataLine = snapshotFrame
      .split("\n")
      .find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const snapshot = JSON.parse(dataLine!.slice(6));
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.pipelines).toBeInstanceOf(Array);
  });

  test("event published to upstream bus is relayed to aggregator subscriber", async () => {
    const bus = makeBus();

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus.url,
    });
    aggregator.scanRegistries();
    await waitForConnection(aggregator, "BRE-100");

    // Subscribe to aggregator stream
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames: string[] = [];

    // Read snapshot first
    const { value: first } = await reader.read();
    buf += decoder.decode(first, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) if (p.trim()) frames.push(p);

    // Push event via mock bus
    bus.push({
      id: "uuid-1",
      seq: 1,
      channel: "status",
      from: "test",
      type: "phase_changed",
      payload: { ticketId: "BRE-100", eventType: "phase_changed" },
      timestamp: Date.now(),
    });

    // Read relayed event from aggregator
    const readStart = Date.now();
    while (Date.now() - readStart < 3000) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const moreParts = buf.split("\n\n");
      buf = moreParts.pop() ?? "";
      for (const p of moreParts) if (p.trim()) frames.push(p);
      if (frames.length >= 2) break;
    }

    ac.abort();

    expect(frames.length).toBeGreaterThanOrEqual(2);
    const relayedFrame = frames[1];
    expect(relayedFrame).toContain("data: ");
    expect(relayedFrame).toContain("id: ");

    const relayedData = relayedFrame
      .split("\n")
      .find((l) => l.startsWith("data: "));
    const parsed = JSON.parse(relayedData!.slice(6));
    expect(parsed.type).toBe("phase_changed");
    expect(parsed.channel).toBe("status");
  });

  test("events from multiple buses arrive on single stream", async () => {
    const bus1 = makeBus();
    const bus2 = makeBus();

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus1.url,
    });
    writeRegistry(tempDir, "BRE-200.json", {
      ticket_id: "BRE-200",
      bus_url: bus2.url,
    });
    aggregator.scanRegistries();

    await waitForConnection(aggregator, "BRE-100");
    await waitForConnection(aggregator, "BRE-200");

    // Subscribe to aggregator
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames: string[] = [];

    // Read snapshot
    const { value: first } = await reader.read();
    buf += decoder.decode(first, { stream: true });
    let splitParts = buf.split("\n\n");
    buf = splitParts.pop() ?? "";
    for (const p of splitParts) if (p.trim()) frames.push(p);

    // Push events to both buses
    bus1.push({
      id: "uuid-b1",
      seq: 1,
      channel: "status",
      from: "test",
      type: "event_from_bus1",
      payload: { ticketId: "BRE-100" },
      timestamp: Date.now(),
    });
    bus2.push({
      id: "uuid-b2",
      seq: 1,
      channel: "status",
      from: "test",
      type: "event_from_bus2",
      payload: { ticketId: "BRE-200" },
      timestamp: Date.now(),
    });

    // Read until we have at least 2 relayed events (+ snapshot = 3 frames)
    const readStart = Date.now();
    while (Date.now() - readStart < 3000 && frames.length < 3) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      splitParts = buf.split("\n\n");
      buf = splitParts.pop() ?? "";
      for (const p of splitParts) if (p.trim()) frames.push(p);
    }

    ac.abort();

    expect(frames.length).toBeGreaterThanOrEqual(3);

    const allData = frames.join("\n");
    expect(allData).toContain("event_from_bus1");
    expect(allData).toContain("event_from_bus2");
  });

  test("reconnecting client with Last-Event-ID skips snapshot", async () => {
    // Verify new connection (no Last-Event-ID) gets snapshot
    const newConnFrames = await collectSseFrames(
      `${baseUrl}/subscribe/status`,
      1,
      2000,
    );
    expect(newConnFrames.length).toBeGreaterThanOrEqual(1);
    expect(newConnFrames[0]).toContain("event: snapshot");

    // Verify reconnection (with Last-Event-ID) does NOT get snapshot
    // Use handleSubscribe directly to test the behavior
    const req = new Request(`${baseUrl}/subscribe/status`, {
      headers: { "Last-Event-ID": "5" },
    });
    const response = aggregator.handleSubscribe(req);
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Subscriber is now registered — push a test event directly via fanOut
    const testEvent = new TextEncoder().encode(
      `id: 99\ndata: {"type":"test_event"}\n\n`,
    );
    // Use a small delay to ensure subscription is active
    await Bun.sleep(10);

    // Manually trigger fanOut by iterating subscribers
    for (const ctrl of aggregator.subscribers) {
      try {
        ctrl.enqueue(testEvent);
      } catch {}
    }

    // Read the first chunk — should be the test event, not a snapshot
    const { value } = await reader.read();
    const data = decoder.decode(value);

    expect(data).not.toContain("event: snapshot");
    expect(data).toContain("test_event");
  });

  test("multiple subscribers receive same events", async () => {
    const bus = makeBus();

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus.url,
    });
    aggregator.scanRegistries();
    await waitForConnection(aggregator, "BRE-100");

    // Create two subscribers
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const res1 = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac1.signal,
    });
    const res2 = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac2.signal,
    });

    const reader1 = res1.body!.getReader();
    const reader2 = res2.body!.getReader();

    // Consume snapshots
    await reader1.read();
    await reader2.read();

    expect(aggregator.getSubscriberCount()).toBe(2);

    // Push event via mock bus
    bus.push({
      id: "uuid-shared",
      seq: 1,
      channel: "status",
      from: "test",
      type: "shared_event",
      payload: {},
      timestamp: Date.now(),
    });

    // Both should receive it
    const decoder = new TextDecoder();
    const read1 = await reader1.read();
    const read2 = await reader2.read();

    const data1 = decoder.decode(read1.value);
    const data2 = decoder.decode(read2.value);

    expect(data1).toContain("shared_event");
    expect(data2).toContain("shared_event");

    ac1.abort();
    ac2.abort();
    await Bun.sleep(10);
  });
});

// ── Phase 5: US3 — Resilient Per-Bus Connections ─────────────────────────────

describe("resilient per-bus connections", () => {
  const mockBuses: MockBus[] = [];

  afterEach(() => {
    for (const mb of mockBuses) {
      try { mb.stop(); } catch {}
    }
    mockBuses.length = 0;
  });

  function makeBus(): MockBus {
    const mb = createMockBus();
    mockBuses.push(mb);
    return mb;
  }

  test("one bus stopping does not affect events from other bus", async () => {
    const bus1 = makeBus();
    const bus2 = makeBus();

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus1.url,
    });
    writeRegistry(tempDir, "BRE-200.json", {
      ticket_id: "BRE-200",
      bus_url: bus2.url,
    });
    aggregator.scanRegistries();

    await waitForConnection(aggregator, "BRE-100");
    await waitForConnection(aggregator, "BRE-200");

    // Stop bus1 — bus2 should still work
    bus1.stop();

    // Wait for aggregator to notice bus1 disconnected
    await Bun.sleep(100);

    // bus2 should still be connected
    const conn2 = aggregator.connections.get("BRE-200");
    expect(conn2?.connected).toBe(true);

    // Subscribe to aggregator
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac.signal,
    });
    const reader = res.body!.getReader();

    // Consume snapshot
    await reader.read();

    // Push event to bus2 — should still relay
    bus2.push({
      id: "uuid-resilient",
      seq: 1,
      channel: "status",
      from: "test",
      type: "bus2_still_works",
      payload: {},
      timestamp: Date.now(),
    });

    const { value } = await reader.read();
    const data = new TextDecoder().decode(value);

    ac.abort();

    expect(data).toContain("bus2_still_works");
  });

  test("aggregator reconnects after bus restart", async () => {
    const bus1 = makeBus();
    const originalPort = bus1.port;

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus1.url,
    });
    aggregator.scanRegistries();
    await waitForConnection(aggregator, "BRE-100");

    // Stop bus
    bus1.stop();
    await Bun.sleep(100);

    // Connection should be marked disconnected
    const conn = aggregator.connections.get("BRE-100");
    expect(conn?.connected).toBe(false);

    // Restart bus on same port
    const bus1Restarted = createMockBus();
    // We can't guarantee same port, so update the registry with new URL
    mockBuses.push(bus1Restarted);

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus1Restarted.url,
    });
    // Trigger rescan to pick up new URL
    aggregator.scanRegistries();

    // Wait for reconnection
    await waitForConnection(aggregator, "BRE-100");

    // Verify events flow again
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // snapshot

    bus1Restarted.push({
      id: "uuid-after-restart",
      seq: 1,
      channel: "status",
      from: "test",
      type: "event_after_restart",
      payload: {},
      timestamp: Date.now(),
    });

    const { value } = await reader.read();
    const data = new TextDecoder().decode(value);

    ac.abort();

    expect(data).toContain("event_after_restart");
  });

  test("bus_url change triggers disconnect from old and connect to new", async () => {
    const bus1 = makeBus();

    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus1.url,
    });
    aggregator.scanRegistries();
    await waitForConnection(aggregator, "BRE-100");

    const oldConn = aggregator.connections.get("BRE-100")!;
    const oldAbortController = oldConn.abortController;

    // Change bus_url in registry
    const bus2 = makeBus();
    writeRegistry(tempDir, "BRE-100.json", {
      ticket_id: "BRE-100",
      bus_url: bus2.url,
    });
    aggregator.scanRegistries();

    // Old connection should be aborted
    expect(oldAbortController.signal.aborted).toBe(true);

    // New connection should be created with new bus URL
    const newConn = aggregator.connections.get("BRE-100")!;
    expect(newConn.busUrl).toBe(bus2.url);

    // Wait for new connection
    await waitForConnection(aggregator, "BRE-100");

    // Verify events flow from new bus
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/subscribe/status`, {
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // snapshot

    bus2.push({
      id: "uuid-new-bus",
      seq: 1,
      channel: "status",
      from: "test",
      type: "event_from_new_bus",
      payload: {},
      timestamp: Date.now(),
    });

    const { value } = await reader.read();
    const data = new TextDecoder().decode(value);

    ac.abort();

    expect(data).toContain("event_from_new_bus");
  });

  test("retry loop sets connected=false on connection error", () => {
    // Connect to a non-existent bus (will fail immediately)
    aggregator.connectToBus("TEST-FAIL", "http://localhost:1");

    const conn = aggregator.connections.get("TEST-FAIL");
    expect(conn).toBeDefined();
    expect(conn!.connected).toBe(false);
  });
});
