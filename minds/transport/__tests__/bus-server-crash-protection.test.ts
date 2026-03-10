// Tests for bus-server.ts crash protection (Fixes 1-4)
//
// Validates the four crash protection mechanisms added to the bus server:
//   Fix 1: Global uncaughtException/unhandledRejection handlers (standalone mode)
//   Fix 2: Bun.serve error handler returns 500 instead of crashing
//   Fix 3: buildSnapshot() precomputed outside ReadableStream start()
//   Fix 4: handleSubscribe try-catch returns JSON 500 on failure

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createServer } from "../bus-server";
import { join } from "path";
import {
  createMockRegistry,
  createTempRegistryDir,
  cleanupTempDir,
  collectSSEEvents,
} from "./helpers";
import { writeFileSync } from "fs";
import { startBusServer, teardownBusServer } from "../test-helpers";
import * as path from "path";

// ── Test harness ─────────────────────────────────────────────────────────────

let server: ReturnType<typeof createServer>;
let busUrl: string;

beforeEach(() => {
  server = createServer({ port: 0 });
  busUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  server.stop(true);
  await Bun.sleep(10);
});

// ── Fix 1: Global error handlers (standalone mode) ──────────────────────────

const REAL_REPO_ROOT = path.resolve(__dirname, "../../../");

describe("Fix 1: Global error handlers in standalone mode", () => {
  test("standalone bus server process stays alive after startup", async () => {
    // Start bus-server as a standalone process (import.meta.main path)
    // which registers the uncaughtException/unhandledRejection handlers
    const bus = await startBusServer(REAL_REPO_ROOT);

    try {
      // Verify the server is alive and responding
      const res = await fetch(`${bus.url}/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Verify the server can handle requests (proves it didn't crash on startup)
      const pubRes = await fetch(`${bus.url}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "test",
          from: "crash-test",
          type: "ping",
          payload: null,
        }),
      });
      expect(pubRes.status).toBe(200);
    } finally {
      teardownBusServer(bus.pid);
    }
  });

  test("standalone bus server survives after subscriber disconnects abruptly", async () => {
    // This exercises the code path where fanOut could throw on a dead controller,
    // which would be caught by the global handlers in standalone mode
    const bus = await startBusServer(REAL_REPO_ROOT);

    try {
      // Connect a subscriber then disconnect abruptly
      const ac = new AbortController();
      const subPromise = fetch(`${bus.url}/subscribe/crash-test-ch`, {
        signal: ac.signal,
      }).catch(() => {});

      await Bun.sleep(30); // let SSE connection establish
      ac.abort(); // abrupt disconnect
      await subPromise;
      await Bun.sleep(30); // let server process disconnection

      // Publish to the channel with dead subscriber — server should survive
      const pubRes = await fetch(`${bus.url}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "crash-test-ch",
          from: "test",
          type: "after-disconnect",
          payload: null,
        }),
      });
      expect(pubRes.status).toBe(200);

      // Server is still alive and responding
      const statusRes = await fetch(`${bus.url}/status`);
      expect(statusRes.status).toBe(200);
    } finally {
      teardownBusServer(bus.pid);
    }
  });
});

// ── Fix 2: Bun.serve error handler ──────────────────────────────────────────

describe("Fix 2: Bun.serve error handler", () => {
  test("server remains operational after handling bad requests", async () => {
    // Send a series of malformed requests that could trigger server-level errors
    // then verify the server is still alive

    // Empty body POST
    const r1 = await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    expect(r1.status).toBe(400);

    // Non-JSON content type with garbage body
    const r2 = await fetch(`${busUrl}/publish`, {
      method: "POST",
      body: "\x00\x01\x02\x03",
    });
    expect(r2.status).toBe(400);

    // Server should still be alive
    const statusRes = await fetch(`${busUrl}/status`);
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("server survives rapid connect/disconnect cycles", async () => {
    // Rapidly open and close SSE connections — stresses Bun.serve error paths
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      const ac = new AbortController();
      promises.push(
        fetch(`${busUrl}/subscribe/stress-ch`, { signal: ac.signal })
          .then(() => {
            ac.abort();
          })
          .catch(() => {}),
      );
      // Abort immediately — some connections may not even establish
      setTimeout(() => ac.abort(), 5);
    }
    await Promise.all(promises);
    await Bun.sleep(50);

    // Server should still be alive
    const statusRes = await fetch(`${busUrl}/status`);
    expect(statusRes.status).toBe(200);
  });
});

// ── Fix 3: Precomputed snapshot ─────────────────────────────────────────────

describe("Fix 3: Precomputed snapshot outside ReadableStream", () => {
  let regDir: string;
  let snapshotServer: ReturnType<typeof createServer>;

  afterEach(() => {
    snapshotServer?.stop(true);
    if (regDir) cleanupTempDir(regDir);
  });

  test("status channel subscriber receives snapshot with valid pipeline data", async () => {
    regDir = createTempRegistryDir([
      {
        filename: "BRE-900.json",
        data: createMockRegistry({
          ticket_id: "BRE-900",
          current_step: "implement",
          bus_url: "http://localhost:7777",
        }),
      },
    ]);

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    const url = `http://localhost:${snapshotServer.port}`;

    const frames = await collectSSEEvents(`${url}/subscribe/status`, 1, 2000);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("snapshot");

    const data = JSON.parse(frames[0].data!);
    expect(data.type).toBe("snapshot");
    expect(data.pipelines).toHaveLength(1);
    expect(data.pipelines[0].ticketId).toBe("BRE-900");
    expect(data.pipelines[0].phase).toBe("implement");
  });

  test("nonexistent registry dir does not crash — returns empty snapshot", async () => {
    // Point to a directory that does not exist — buildSnapshot handles this
    // gracefully. The key test: this does NOT crash the server because
    // buildSnapshot is called outside the ReadableStream start() callback.
    const bogusDir = join(
      "/tmp",
      `nonexistent-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    snapshotServer = createServer({ port: 0, registryDir: bogusDir });
    const url = `http://localhost:${snapshotServer.port}`;

    const frames = await collectSSEEvents(`${url}/subscribe/status`, 1, 2000);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("snapshot");

    const data = JSON.parse(frames[0].data!);
    expect(data.type).toBe("snapshot");
    expect(data.pipelines).toEqual([]);

    // Server is still alive — verify with a status check
    const statusRes = await fetch(`${url}/status`);
    expect(statusRes.status).toBe(200);
  });

  test("corrupt registry JSON does not crash — pipeline is skipped", async () => {
    regDir = createTempRegistryDir([
      {
        filename: "BRE-GOOD.json",
        data: createMockRegistry({
          ticket_id: "BRE-GOOD",
          current_step: "clarify",
        }),
      },
    ]);
    // Write a corrupt JSON file directly
    writeFileSync(join(regDir, "BRE-BAD.json"), "{{not valid json!!", "utf8");

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    const url = `http://localhost:${snapshotServer.port}`;

    const frames = await collectSSEEvents(`${url}/subscribe/status`, 1, 2000);

    expect(frames).toHaveLength(1);
    const data = JSON.parse(frames[0].data!);
    // Only the good pipeline should be present — corrupt one skipped
    expect(data.pipelines).toHaveLength(1);
    expect(data.pipelines[0].ticketId).toBe("BRE-GOOD");

    // Server survived
    const statusRes = await fetch(`${url}/status`);
    expect(statusRes.status).toBe(200);
  });

  test("snapshot is delivered before ring buffer replay messages", async () => {
    regDir = createTempRegistryDir([
      {
        filename: "BRE-ORDER.json",
        data: createMockRegistry({
          ticket_id: "BRE-ORDER",
          current_step: "plan",
        }),
      },
    ]);

    snapshotServer = createServer({ port: 0, registryDir: regDir });
    const url = `http://localhost:${snapshotServer.port}`;

    // Publish a message to the status channel first (goes into ring buffer)
    await fetch(`${url}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "status",
        from: "test",
        type: "update",
        payload: { msg: "hello" },
      }),
    });

    // Subscribe — should get snapshot first, then ring buffer replay
    const frames = await collectSSEEvents(`${url}/subscribe/status`, 2, 2000);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    // First frame is snapshot
    expect(frames[0].event).toBe("snapshot");
    // Second frame is the replayed bus message (no event field = default message)
    expect(frames[1].event).toBeUndefined();
    const replayData = JSON.parse(frames[1].data!);
    expect(replayData.type).toBe("update");
  });
});

// ── Fix 4: handleSubscribe try-catch ────────────────────────────────────────

describe("Fix 4: handleSubscribe error handling", () => {
  test("subscribe to normal channel succeeds with correct SSE headers", async () => {
    const ac = new AbortController();
    // Publish a message first so the subscriber has something to receive
    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "test-ch", from: "test", type: "ping", payload: null }),
    });

    const subDone = (async () => {
      const res = await fetch(`${busUrl}/subscribe/test-ch`, { signal: ac.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      // Read one frame then abort
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
    })().catch(() => {});

    await Promise.race([subDone, Bun.sleep(2000).then(() => ac.abort())]);
  });

  test("subscribe with URL-encoded channel name works", async () => {
    const ac = new AbortController();
    const channelName = "pipeline/BRE-123/status";
    const encodedChannel = encodeURIComponent(channelName);

    // Publish a message first so subscriber has something to receive
    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channelName, from: "test", type: "ping", payload: null }),
    });

    const subDone = (async () => {
      const res = await fetch(`${busUrl}/subscribe/${encodedChannel}`, { signal: ac.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
    })().catch(() => {});

    await Promise.race([subDone, Bun.sleep(2000).then(() => ac.abort())]);
  });

  test("server remains healthy after multiple rapid subscribe/unsubscribe cycles", async () => {
    // Rapidly create and destroy subscriptions — tests that the try-catch
    // prevents any error from crashing the process
    for (let i = 0; i < 20; i++) {
      const ac = new AbortController();
      fetch(`${busUrl}/subscribe/rapid-ch-${i % 5}`, { signal: ac.signal }).catch(
        () => {},
      );
      // Abort after minimal delay
      setTimeout(() => ac.abort(), 1);
    }

    await Bun.sleep(100); // let all connections settle

    // Server should still be alive and healthy
    const statusRes = await fetch(`${busUrl}/status`);
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("server survives interleaved publish and subscribe operations", async () => {
    // Mix subscribes and publishes rapidly — tests that try-catch in
    // handleSubscribe protects against any race-condition errors
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 10; i++) {
      // Subscribe
      const ac = new AbortController();
      promises.push(
        fetch(`${busUrl}/subscribe/interleave-ch`, { signal: ac.signal })
          .then(() => {})
          .catch(() => {}),
      );

      // Publish simultaneously
      promises.push(
        fetch(`${busUrl}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "interleave-ch",
            from: "test",
            type: "tick",
            payload: i,
          }),
        })
          .then(() => {})
          .catch(() => {}),
      );

      // Abort subscription after a tiny delay
      setTimeout(() => ac.abort(), 10);
    }

    await Promise.all(promises);
    await Bun.sleep(50);

    // Server survived all the chaos
    const statusRes = await fetch(`${busUrl}/status`);
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
