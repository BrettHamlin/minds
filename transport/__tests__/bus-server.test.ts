// Tests for bus-server.ts + BusTransport (BRE-345)
//
// Strategy: import createServer() directly — no subprocess spawning needed.
// This avoids flaky process lifecycle and is faster.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createServer } from "../bus-server.ts";
import { BusTransport } from "../BusTransport.ts";
import type { BusMessage } from "../bus-server.ts";

// ── Test harness ─────────────────────────────────────────────────────────────

let server: ReturnType<typeof createServer>;
let busUrl: string;

beforeEach(() => {
  server = createServer(0); // port 0 = OS-assigned
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
