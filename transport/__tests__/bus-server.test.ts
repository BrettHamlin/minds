// Tests for bus-server.ts + BusTransport (BRE-345)
//
// Strategy: import createServer() directly — no subprocess spawning needed.
// This avoids flaky process lifecycle and is faster.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createServer } from "../bus-server.ts";
import { BusTransport } from "../BusTransport.ts";
import type { BusMessage } from "../bus-server.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Test harness ─────────────────────────────────────────────────────────────

let server: ReturnType<typeof createServer>;
let busUrl: string;

beforeEach(() => {
  server = createServer({ port: 0 }); // port 0 = OS-assigned
  busUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  server.stop(true);
  // Give connections a moment to drain
  await Bun.sleep(10);
});

// ── /status ───────────────────────────────────────────────────────────────────

describe("GET /status", () => {
  test("returns 200 with ok:true", async () => {
    const res = await fetch(`${busUrl}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("includes uptime and messageCount fields", async () => {
    const res = await fetch(`${busUrl}/status`);
    const body = await res.json() as { uptime: number; messageCount: number };
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.messageCount).toBe("number");
  });
});

// ── /publish ──────────────────────────────────────────────────────────────────

describe("POST /publish", () => {
  test("returns 200 with ok:true and a UUID id", async () => {
    const res = await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "test", from: "tester", type: "ping", payload: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("string");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("returns 400 when channel is missing", async () => {
    const res = await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "tester", type: "ping" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid JSON", async () => {
    const res = await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("increments messageCount in /status", async () => {
    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "ch1", from: "a", type: "t", payload: null }),
    });
    const res = await fetch(`${busUrl}/status`);
    const body = await res.json() as { messageCount: number };
    expect(body.messageCount).toBe(1);
  });
});

// ── /subscribe SSE ────────────────────────────────────────────────────────────

describe("GET /subscribe/:channel — live delivery", () => {
  test("delivers published message to subscriber", async () => {
    const received: BusMessage[] = [];
    const ac = new AbortController();

    // Start subscription in background
    const subDone = (async () => {
      const res = await fetch(`${busUrl}/subscribe/live-ch`, { signal: ac.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              received.push(JSON.parse(line.slice(6)) as BusMessage);
              // Got one message — abort
              if (received.length >= 1) ac.abort();
            }
          }
        }
      }
    })().catch(() => {}); // abort throws — ignore

    // Small delay to ensure subscriber is connected
    await Bun.sleep(20);

    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "live-ch", from: "agent1", type: "done", payload: { x: 1 } }),
    });

    await subDone;

    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe("live-ch");
    expect(received[0].from).toBe("agent1");
    expect(received[0].type).toBe("done");
    expect((received[0].payload as { x: number }).x).toBe(1);
    expect(typeof received[0].id).toBe("string");
    expect(typeof received[0].timestamp).toBe("number");
  });

  test("delivers messages to multiple subscribers on same channel", async () => {
    const msgs1: BusMessage[] = [];
    const msgs2: BusMessage[] = [];
    const ac1 = new AbortController();
    const ac2 = new AbortController();

    async function collectOne(channel: string, out: BusMessage[], ac: AbortController) {
      const res = await fetch(`${busUrl}/subscribe/${channel}`, { signal: ac.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              out.push(JSON.parse(line.slice(6)) as BusMessage);
              if (out.length >= 1) ac.abort();
            }
          }
        }
      }
    }

    const p1 = collectOne("multi-ch", msgs1, ac1).catch(() => {});
    const p2 = collectOne("multi-ch", msgs2, ac2).catch(() => {});

    await Bun.sleep(30);

    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "multi-ch", from: "agent1", type: "hello", payload: null }),
    });

    await Promise.all([p1, p2]);

    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);
    expect(msgs1[0].id).toBe(msgs2[0].id); // same message object
  });
});

// ── Ring buffer replay ────────────────────────────────────────────────────────

describe("Ring buffer: SSE reconnect replay", () => {
  test("new subscriber receives previously published messages", async () => {
    // Publish 3 messages BEFORE any subscriber connects
    for (let i = 0; i < 3; i++) {
      await fetch(`${busUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "replay-ch", from: "src", type: "msg", payload: i }),
      });
    }

    // Now subscribe — should get all 3 replayed immediately
    const received: BusMessage[] = [];
    const ac = new AbortController();

    const subDone = (async () => {
      const res = await fetch(`${busUrl}/subscribe/replay-ch`, { signal: ac.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              received.push(JSON.parse(line.slice(6)) as BusMessage);
              if (received.length >= 3) ac.abort();
            }
          }
        }
      }
    })().catch(() => {});

    await subDone;

    expect(received).toHaveLength(3);
    expect(received.map((m) => m.payload)).toEqual([0, 1, 2]);
  });

  test("ring buffer caps at 100 messages, dropping oldest", async () => {
    // Publish 105 messages
    for (let i = 0; i < 105; i++) {
      await fetch(`${busUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "cap-ch", from: "src", type: "n", payload: i }),
      });
    }

    // Subscribe and collect all replayed messages
    const received: BusMessage[] = [];
    const ac = new AbortController();

    const subDone = (async () => {
      const res = await fetch(`${busUrl}/subscribe/cap-ch`, { signal: ac.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let collecting = true;
      while (collecting) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              received.push(JSON.parse(line.slice(6)) as BusMessage);
              if (received.length >= 100) {
                collecting = false;
                ac.abort();
              }
            }
          }
        }
      }
    })().catch(() => {});

    // Give time for replay to stream
    await Promise.race([subDone, Bun.sleep(500)]);
    ac.abort();

    expect(received.length).toBe(100);
    // The first replayed message should have payload=5 (oldest 5 were dropped)
    expect(received[0].payload).toBe(5);
    expect(received[99].payload).toBe(104);
  });
});

// ── BusTransport integration ──────────────────────────────────────────────────

describe("BusTransport integration with live server", () => {
  test("publish() sends message that subscriber receives", async () => {
    const transport = new BusTransport(busUrl);
    const received: import("../Transport.ts").Message[] = [];

    const unsub = await transport.subscribe("bt-ch", (msg) => {
      received.push(msg);
    });

    await Bun.sleep(20); // let SSE connection establish

    await transport.publish("bt-ch", { channel: "bt-ch", from: "bt-test", type: "hello", payload: "world" });

    // Wait for delivery
    await Bun.sleep(50);

    unsub();
    await transport.teardown();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].type).toBe("hello");
    expect(received[0].from).toBe("bt-test");
    expect(received[0].payload).toBe("world");
  });

  test("teardown() stops all subscriptions", async () => {
    const transport = new BusTransport(busUrl);
    const received: import("../Transport.ts").Message[] = [];

    await transport.subscribe("teardown-ch", (msg) => received.push(msg));
    await Bun.sleep(20);

    await transport.teardown();

    // Publish after teardown — should not be received
    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "teardown-ch", from: "x", type: "late", payload: null }),
    });

    await Bun.sleep(50);
    expect(received).toHaveLength(0);
  });

  test("dynamic channels — subscribe to channel with special characters", async () => {
    const transport = new BusTransport(busUrl);
    const received: import("../Transport.ts").Message[] = [];

    const unsub = await transport.subscribe("my/special-channel.v2", (msg) => {
      received.push(msg);
    });

    await Bun.sleep(20);

    await transport.publish("my/special-channel.v2", {
      channel: "my/special-channel.v2",
      from: "agent",
      type: "tick",
      payload: 42,
    });

    await Bun.sleep(50);
    unsub();
    await transport.teardown();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].channel).toBe("my/special-channel.v2");
  });
});

// ── 404 handling ──────────────────────────────────────────────────────────────

describe("404 for unknown routes", () => {
  test("returns 404 for unknown path", async () => {
    const res = await fetch(`${busUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});

// ── Snapshot-on-connect (BRE-397) ────────────────────────────────────────────

// Helper to parse SSE frames from a ReadableStream
async function collectSseFrames(
  url: string,
  opts: { maxFrames: number; timeoutMs?: number; headers?: Record<string, string> },
): Promise<Array<{ event?: string; id?: string; data?: string }>> {
  const frames: Array<{ event?: string; id?: string; data?: string }> = [];
  const ac = new AbortController();
  const timeout = opts.timeoutMs ?? 2000;

  const done = (async () => {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: opts.headers,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const rawFrames = buf.split("\n\n");
      buf = rawFrames.pop() ?? "";
      for (const raw of rawFrames) {
        const frame: { event?: string; id?: string; data?: string } = {};
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) frame.event = line.slice(7);
          else if (line.startsWith("id: ")) frame.id = line.slice(4);
          else if (line.startsWith("data: ")) frame.data = line.slice(6);
        }
        frames.push(frame);
        if (frames.length >= opts.maxFrames) {
          ac.abort();
          return;
        }
      }
    }
  })().catch(() => {});

  await Promise.race([done, Bun.sleep(timeout).then(() => ac.abort())]);
  return frames;
}

function createRegistryDir(): string {
  const dir = join(tmpdir(), `bus-snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Snapshot-on-connect for /subscribe/status", () => {
  let regDir: string;
  let snapshotServer: ReturnType<typeof createServer>;
  let snapshotUrl: string;

  beforeEach(() => {
    regDir = createRegistryDir();
  });

  afterEach(() => {
    snapshotServer?.stop(true);
    rmSync(regDir, { recursive: true, force: true });
  });

  test("new status subscriber receives snapshot event as first message", async () => {
    // Write a mock registry file
    writeFileSync(
      join(regDir, "BRE-500.json"),
      JSON.stringify({
        ticket_id: "BRE-500",
        current_step: "implement",
        bus_url: "http://localhost:9999",
        started_at: "2026-03-04T10:00:00Z",
      }),
      "utf8",
    );

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    snapshotUrl = `http://localhost:${snapshotServer.port}`;

    const frames = await collectSseFrames(`${snapshotUrl}/subscribe/status`, {
      maxFrames: 1,
      timeoutMs: 2000,
    });

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("snapshot");
    expect(frames[0].id).toBeDefined();

    const data = JSON.parse(frames[0].data!);
    expect(data.type).toBe("snapshot");
    expect(data.pipelines).toHaveLength(1);
    expect(data.pipelines[0].ticketId).toBe("BRE-500");
    expect(data.pipelines[0].phase).toBe("implement");
    expect(data.pipelines[0].status).toBe("running");
    expect(data.pipelines[0].busUrl).toBe("http://localhost:9999");
  });

  test("empty registry returns snapshot with empty pipelines array", async () => {
    // regDir is empty — no registry files
    snapshotServer = createServer({ port: 0, registryDir: regDir });
    snapshotUrl = `http://localhost:${snapshotServer.port}`;

    const frames = await collectSseFrames(`${snapshotUrl}/subscribe/status`, {
      maxFrames: 1,
      timeoutMs: 2000,
    });

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("snapshot");

    const data = JSON.parse(frames[0].data!);
    expect(data.type).toBe("snapshot");
    expect(data.pipelines).toEqual([]);
  });

  test("snapshot contains all active pipelines with accurate data", async () => {
    // Write 3 mock registry files with different phases/statuses
    writeFileSync(
      join(regDir, "BRE-601.json"),
      JSON.stringify({
        ticket_id: "BRE-601",
        current_step: "clarify",
      }),
      "utf8",
    );
    writeFileSync(
      join(regDir, "BRE-602.json"),
      JSON.stringify({
        ticket_id: "BRE-602",
        current_step: "implement",
        implement_phase_plan: { current_impl_phase: 3, total_phases: 7 },
      }),
      "utf8",
    );
    writeFileSync(
      join(regDir, "BRE-603.json"),
      JSON.stringify({
        ticket_id: "BRE-603",
        current_step: "done",
        last_signal: "IMPLEMENT_COMPLETE",
        last_signal_at: "2026-03-04T12:00:00Z",
      }),
      "utf8",
    );

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    snapshotUrl = `http://localhost:${snapshotServer.port}`;

    const frames = await collectSseFrames(`${snapshotUrl}/subscribe/status`, {
      maxFrames: 1,
      timeoutMs: 2000,
    });

    expect(frames).toHaveLength(1);
    const data = JSON.parse(frames[0].data!);
    expect(data.pipelines).toHaveLength(3);

    const ids = data.pipelines.map((p: { ticketId: string }) => p.ticketId).sort();
    expect(ids).toEqual(["BRE-601", "BRE-602", "BRE-603"]);

    // Verify derived statuses
    const p602 = data.pipelines.find((p: { ticketId: string }) => p.ticketId === "BRE-602");
    expect(p602.implProgress).toEqual({ current: 3, total: 7 });

    const p603 = data.pipelines.find((p: { ticketId: string }) => p.ticketId === "BRE-603");
    expect(p603.status).toBe("completed");
  });

  test("reconnecting client with Last-Event-ID receives replay only, no snapshot", async () => {
    // Write mock registry so snapshot would have data if sent
    writeFileSync(
      join(regDir, "BRE-700.json"),
      JSON.stringify({ ticket_id: "BRE-700", current_step: "plan" }),
      "utf8",
    );

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    snapshotUrl = `http://localhost:${snapshotServer.port}`;

    // 1. First connection — receives snapshot as first frame
    const firstFrames = await collectSseFrames(`${snapshotUrl}/subscribe/status`, {
      maxFrames: 1,
      timeoutMs: 2000,
    });
    expect(firstFrames).toHaveLength(1);
    expect(firstFrames[0].event).toBe("snapshot");
    const snapshotSeq = firstFrames[0].id!;

    // 2. Publish a status message so ring buffer has something to replay
    await fetch(`${snapshotUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "status",
        from: "test",
        type: "status_update",
        payload: { ticketId: "BRE-700", phase: "implement" },
      }),
    });

    // 3. Reconnect with Last-Event-ID = snapshot's seq (simulating reconnect)
    const reconnectFrames = await collectSseFrames(`${snapshotUrl}/subscribe/status`, {
      maxFrames: 2,
      timeoutMs: 1000,
      headers: { "Last-Event-ID": snapshotSeq },
    });

    // Should receive only the published message (ring buffer replay), NOT a snapshot
    expect(reconnectFrames.length).toBeGreaterThanOrEqual(1);
    for (const frame of reconnectFrames) {
      expect(frame.event).not.toBe("snapshot");
    }
    // Verify the replayed message is the published one
    const replayData = JSON.parse(reconnectFrames[0].data!);
    expect(replayData.channel).toBe("status");
    expect(replayData.type).toBe("status_update");
  });

  test("non-status channel receives no snapshot event", async () => {
    // Write mock registry so snapshot would have data if incorrectly sent
    writeFileSync(
      join(regDir, "BRE-800.json"),
      JSON.stringify({ ticket_id: "BRE-800", current_step: "implement" }),
      "utf8",
    );

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    snapshotUrl = `http://localhost:${snapshotServer.port}`;

    // Publish a message on "signals" channel first so subscriber has something to receive
    await fetch(`${snapshotUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "signals",
        from: "test",
        type: "CLARIFY_COMPLETE",
        payload: { ticketId: "BRE-800" },
      }),
    });

    // Subscribe to "signals" (non-status channel) — should NOT get snapshot
    const frames = await collectSseFrames(`${snapshotUrl}/subscribe/signals`, {
      maxFrames: 2,
      timeoutMs: 1000,
    });

    // Should receive the published message via ring buffer replay, no snapshot
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const frame of frames) {
      expect(frame.event).not.toBe("snapshot");
    }
    const msgData = JSON.parse(frames[0].data!);
    expect(msgData.channel).toBe("signals");
    expect(msgData.type).toBe("CLARIFY_COMPLETE");
  });
});
