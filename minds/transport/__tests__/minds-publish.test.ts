// minds-publish.test.ts — Tests for minds-publish.ts (BRE-444)
//
// Strategy: import createServer() directly for a live bus server in-process.
// Tests cover:
//   - resolveBusUrl: env var priority, bus-port file fallback
//   - mindsPublish: POST body construction, error on non-ok response
//   - CLI arg parsing: channel, type, payload variants

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createServer } from "../bus-server.ts";
import { mindsPublish, resolveBusUrl } from "../minds-publish.ts";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let server: ReturnType<typeof createServer>;
let busUrl: string;

beforeEach(() => {
  server = createServer({ port: 0 });
  busUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  server.stop(true);
  await Bun.sleep(10);
  // Clean up BUS_URL if set
  delete process.env.BUS_URL;
});

// ---------------------------------------------------------------------------
// resolveBusUrl — env var
// ---------------------------------------------------------------------------

describe("resolveBusUrl — env var", () => {
  test("returns BUS_URL env var when set", () => {
    process.env.BUS_URL = "http://localhost:9876";
    const result = resolveBusUrl();
    expect(result).toBe("http://localhost:9876");
    delete process.env.BUS_URL;
  });

  test("returns undefined when neither env nor file present", () => {
    const tempDir = join(tmpdir(), `no-bus-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    try {
      const result = resolveBusUrl(tempDir);
      expect(result).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// resolveBusUrl — .minds/bus-port file
// ---------------------------------------------------------------------------

describe("resolveBusUrl — bus-port file", () => {
  test("reads port from .minds/bus-port and returns http URL", () => {
    const tempDir = join(tmpdir(), `bus-port-test-${Date.now()}`);
    const mindsDir = join(tempDir, ".minds");
    mkdirSync(mindsDir, { recursive: true });
    writeFileSync(join(mindsDir, "bus-port"), "7777", "utf8");

    try {
      const result = resolveBusUrl(tempDir);
      expect(result).toBe("http://localhost:7777");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("ignores non-numeric content in bus-port file", () => {
    const tempDir = join(tmpdir(), `bus-port-bad-${Date.now()}`);
    const mindsDir = join(tempDir, ".minds");
    mkdirSync(mindsDir, { recursive: true });
    writeFileSync(join(mindsDir, "bus-port"), "not-a-port", "utf8");

    try {
      const result = resolveBusUrl(tempDir);
      expect(result).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("env var takes priority over bus-port file", () => {
    process.env.BUS_URL = "http://localhost:9999";
    const tempDir = join(tmpdir(), `bus-port-priority-${Date.now()}`);
    const mindsDir = join(tempDir, ".minds");
    mkdirSync(mindsDir, { recursive: true });
    writeFileSync(join(mindsDir, "bus-port"), "8888", "utf8");

    try {
      const result = resolveBusUrl(tempDir);
      expect(result).toBe("http://localhost:9999");
    } finally {
      delete process.env.BUS_URL;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// mindsPublish — POST body construction
// ---------------------------------------------------------------------------

describe("mindsPublish — POST body construction", () => {
  test("publishes to the correct endpoint with channel, type, payload", async () => {
    await mindsPublish(busUrl, "minds-BRE-444", "MIND_COMPLETE", { mindName: "transport" });

    // Verify message landed on the bus by checking /status
    const statusRes = await fetch(`${busUrl}/status`);
    const status = await statusRes.json() as { messageCount: number };
    expect(status.messageCount).toBe(1);
  });

  test("published message has correct channel and type", async () => {
    const events: unknown[] = [];

    // Subscribe before publishing
    const subAc = new AbortController();
    const subUrl = `${busUrl}/subscribe/minds-BRE-TEST`;
    const subPromise = (async () => {
      const res = await fetch(subUrl, { signal: subAc.signal });
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
              try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
            }
          }
        }
        if (events.length >= 1) break;
      }
    })().catch(() => { /* ignore abort */ });

    await Bun.sleep(50); // Let subscriber connect
    await mindsPublish(busUrl, "minds-BRE-TEST", "WAVE_STARTED", { wave: 1 });
    await Bun.sleep(100); // Let message propagate

    subAc.abort();
    await subPromise;

    expect(events.length).toBeGreaterThanOrEqual(1);
    const msg = events[0] as Record<string, unknown>;
    expect(msg.channel).toBe("minds-BRE-TEST");
    expect(msg.type).toBe("WAVE_STARTED");
    expect((msg.payload as Record<string, unknown>).wave).toBe(1);
  });

  test("defaults payload to null when not provided", async () => {
    const events: unknown[] = [];
    const subAc = new AbortController();
    const subUrl = `${busUrl}/subscribe/minds-null-test`;
    const subPromise = (async () => {
      const res = await fetch(subUrl, { signal: subAc.signal });
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
              try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
            }
          }
        }
        if (events.length >= 1) break;
      }
    })().catch(() => { /* ignore abort */ });

    await Bun.sleep(50);
    await mindsPublish(busUrl, "minds-null-test", "DRONE_SPAWNED");
    await Bun.sleep(100);

    subAc.abort();
    await subPromise;

    expect(events.length).toBeGreaterThanOrEqual(1);
    const msg = events[0] as Record<string, unknown>;
    expect(msg.payload).toBeNull();
  });

  test("throws error with context when server returns non-ok status", async () => {
    // Publish to a non-existent path on the live server → 404 Not Found (non-ok status)
    await expect(
      mindsPublish(`${busUrl}/bad-endpoint`, "minds-BRE-444", "MIND_COMPLETE", null),
    ).rejects.toThrow("mindsPublish failed");
  });
});
