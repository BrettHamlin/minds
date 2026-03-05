// Tests for StatusDaemon (BRE-398)
//
// Covers: registryToPipelineSnapshot, writeCacheAtomic, SSE event handling,
// and StatusDaemon lifecycle.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createMockRegistry } from "./helpers";
import {
  registryToPipelineSnapshot,
  writeCacheAtomic,
  discoverAggregatorUrl,
  StatusDaemon,
  createStatusDaemonServer,
  type CachedStatus,
} from "../status-daemon";
import type { PipelineSnapshot } from "../status-snapshot";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `test-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Creates a minimal mock aggregator that sends SSE events */
function createMockAggregator(
  events: Array<{ event?: string; id?: string; data: string }>,
  opts?: { delayMs?: number },
): { server: ReturnType<typeof Bun.serve>; url: string } {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/subscribe/status") {
        const stream = new ReadableStream({
          async start(ctrl) {
            for (const ev of events) {
              let frame = "";
              if (ev.event) frame += `event: ${ev.event}\n`;
              if (ev.id) frame += `id: ${ev.id}\n`;
              frame += `data: ${ev.data}\n\n`;
              ctrl.enqueue(new TextEncoder().encode(frame));
              if (opts?.delayMs) await Bun.sleep(opts.delayMs);
            }
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
  return { server, url: `http://localhost:${server.port}` };
}

// ── T007: registryToPipelineSnapshot ─────────────────────────────────────────

describe("registryToPipelineSnapshot", () => {
  test("maps standard registry fields correctly", () => {
    const reg = createMockRegistry({
      ticket_id: "BRE-100",
      current_step: "implement",
      bus_url: "http://localhost:9999",
      started_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T11:00:00Z",
    });
    const snap = registryToPipelineSnapshot(reg);
    expect(snap.ticketId).toBe("BRE-100");
    expect(snap.phase).toBe("implement");
    expect(snap.busUrl).toBe("http://localhost:9999");
    expect(snap.startedAt).toBe("2026-03-04T10:00:00Z");
    expect(snap.updatedAt).toBe("2026-03-04T11:00:00Z");
    expect(snap.status).toBe("running");
    expect(typeof snap.detail).toBe("string");
  });

  test("handles registry with implement_phase_plan", () => {
    const reg = createMockRegistry({
      current_step: "implement",
      implement_phase_plan: { current_impl_phase: 2, total_phases: 5 },
    });
    const snap = registryToPipelineSnapshot(reg);
    expect(snap.implProgress).toEqual({ current: 2, total: 5 });
  });

  test("handles registry with phase_history", () => {
    const history = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-03-04T10:00:00Z" },
    ];
    const reg = createMockRegistry({ phase_history: history });
    const snap = registryToPipelineSnapshot(reg);
    expect(snap.phaseHistory).toEqual(history);
  });

  test("gracefully handles missing fields", () => {
    const snap = registryToPipelineSnapshot({});
    expect(snap.ticketId).toBe("unknown");
    expect(snap.phase).toBe("unknown");
    expect(snap.busUrl).toBeUndefined();
    expect(snap.implProgress).toBeUndefined();
  });

  test("derives status from last_signal", () => {
    const reg = createMockRegistry({
      last_signal: "IMPLEMENT_ERROR",
      last_signal_at: "2026-03-04T12:00:00Z",
    });
    const snap = registryToPipelineSnapshot(reg);
    expect(snap.status).toBe("error");
  });
});

// ── T008: writeCacheAtomic ───────────────────────────────────────────────────

describe("writeCacheAtomic", () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    cachePath = join(tempDir, "state", "status-cache.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes valid JSON cache file", () => {
    const pipelines = new Map<string, PipelineSnapshot>();
    pipelines.set("BRE-100", {
      ticketId: "BRE-100",
      phase: "implement",
      status: "running",
      detail: "Working on implement phase",
    });

    writeCacheAtomic(pipelines, true, cachePath);

    expect(existsSync(cachePath)).toBe(true);
    const cache: CachedStatus = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cache.pipelines).toHaveLength(1);
    expect(cache.pipelines[0].ticketId).toBe("BRE-100");
    expect(cache.connected).toBe(true);
    expect(typeof cache.lastUpdate).toBe("string");
  });

  test("writes connected=false state", () => {
    const pipelines = new Map<string, PipelineSnapshot>();
    writeCacheAtomic(pipelines, false, cachePath);

    const cache: CachedStatus = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cache.connected).toBe(false);
    expect(cache.pipelines).toHaveLength(0);
  });

  test("creates parent directory when missing", () => {
    const deepPath = join(tempDir, "deep", "nested", "cache.json");
    writeCacheAtomic(new Map(), true, deepPath);
    expect(existsSync(deepPath)).toBe(true);
  });

  test("no .tmp file remains after write", () => {
    writeCacheAtomic(new Map(), true, cachePath);
    expect(existsSync(`${cachePath}.tmp`)).toBe(false);
  });
});

// ── T009: SSE event handling integration ─────────────────────────────────────

describe("StatusDaemon SSE event handling", () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    cachePath = join(tempDir, "status-cache.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("snapshot event replaces all pipelines", () => {
    const daemon = new StatusDaemon({ cachePath });

    const snapshotData = {
      type: "snapshot",
      pipelines: [
        {
          ticketId: "BRE-100",
          phase: "implement",
          status: "running",
          detail: "Working on implement phase",
        },
        {
          ticketId: "BRE-200",
          phase: "plan",
          status: "running",
          detail: "Working on plan phase",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    daemon.handleEvent("snapshot", JSON.stringify(snapshotData));

    expect(daemon.getPipelineCount()).toBe(2);
    expect(daemon.isConnected()).toBe(true);
  });

  test("incremental event replaces single pipeline entry", () => {
    const daemon = new StatusDaemon({ cachePath });

    // First load a snapshot
    daemon.handleEvent(
      "snapshot",
      JSON.stringify({
        type: "snapshot",
        pipelines: [
          { ticketId: "BRE-100", phase: "plan", status: "running", detail: "Working on plan phase" },
        ],
        timestamp: new Date().toISOString(),
      }),
    );

    // Send incremental update
    const statusEvent = {
      ticketId: "BRE-100",
      eventType: "phase_changed",
      changedFields: { current_step: { old: "plan", new: "implement" } },
      snapshot: createMockRegistry({
        ticket_id: "BRE-100",
        current_step: "implement",
      }),
      timestamp: new Date().toISOString(),
    };
    daemon.handleEvent("", JSON.stringify(statusEvent));

    expect(daemon.getPipelineCount()).toBe(1);
    const pipelines = daemon.getPipelines();
    expect(pipelines.get("BRE-100")?.phase).toBe("implement");
  });

  test("registry_updated with current_step=done removes pipeline", () => {
    const daemon = new StatusDaemon({ cachePath });

    // Load initial state
    daemon.handleEvent(
      "snapshot",
      JSON.stringify({
        type: "snapshot",
        pipelines: [
          { ticketId: "BRE-100", phase: "implement", status: "running", detail: "test" },
        ],
        timestamp: new Date().toISOString(),
      }),
    );
    expect(daemon.getPipelineCount()).toBe(1);

    // Send done event
    const doneEvent = {
      ticketId: "BRE-100",
      eventType: "registry_updated",
      changedFields: { current_step: { old: "implement", new: "done" } },
      snapshot: createMockRegistry({
        ticket_id: "BRE-100",
        current_step: "done",
      }),
      timestamp: new Date().toISOString(),
    };
    daemon.handleEvent("", JSON.stringify(doneEvent));

    expect(daemon.getPipelineCount()).toBe(0);
  });

  test("SSE loop connects and processes snapshot from mock aggregator", async () => {
    const snapshotData = {
      type: "snapshot",
      pipelines: [
        {
          ticketId: "BRE-300",
          phase: "implement",
          status: "running",
          detail: "Working on implement phase",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const { server, url } = createMockAggregator([
      { event: "snapshot", id: "1", data: JSON.stringify(snapshotData) },
    ]);

    try {
      const daemon = new StatusDaemon({ cachePath, aggregatorUrl: url });
      daemon.start();

      // Wait for the daemon to process the snapshot
      await Bun.sleep(500);

      expect(daemon.getPipelineCount()).toBe(1);
      expect(daemon.isConnected()).toBe(true);

      daemon.stop();
    } finally {
      server.stop();
    }
  });

  test("daemon writes cache file after receiving events", async () => {
    const snapshotData = {
      type: "snapshot",
      pipelines: [
        {
          ticketId: "BRE-400",
          phase: "plan",
          status: "running",
          detail: "Working on plan phase",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const { server, url } = createMockAggregator([
      { event: "snapshot", id: "1", data: JSON.stringify(snapshotData) },
    ]);

    try {
      const daemon = new StatusDaemon({ cachePath, aggregatorUrl: url });
      daemon.start();

      // Wait for debounce (500ms) + processing time
      await Bun.sleep(1200);

      expect(existsSync(cachePath)).toBe(true);
      const cache: CachedStatus = JSON.parse(readFileSync(cachePath, "utf8"));
      expect(cache.pipelines).toHaveLength(1);
      expect(cache.pipelines[0].ticketId).toBe("BRE-400");

      daemon.stop();
    } finally {
      server.stop();
    }
  });
});

// ── T017: Singleton lifecycle & health endpoint ──────────────────────────────

describe("StatusDaemon server lifecycle", () => {
  test("health endpoint returns correct shape", async () => {
    const tempDir = makeTempDir();
    const cachePath = join(tempDir, "cache.json");

    try {
      const { server, daemon } = createStatusDaemonServer({
        port: 0,
        cachePath,
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/status`);
        expect(res.ok).toBe(true);

        const body = (await res.json()) as Record<string, unknown>;
        expect(body.ok).toBe(true);
        expect(typeof body.uptime).toBe("number");
        expect(typeof body.connected).toBe("boolean");
        expect(typeof body.lastUpdate).toBe("string");
        expect(typeof body.pipelineCount).toBe("number");
      } finally {
        daemon.stop();
        server.stop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("server returns 404 for unknown routes", async () => {
    const tempDir = makeTempDir();
    const cachePath = join(tempDir, "cache.json");

    try {
      const { server, daemon } = createStatusDaemonServer({
        port: 0,
        cachePath,
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/unknown`);
        expect(res.status).toBe(404);
      } finally {
        daemon.stop();
        server.stop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("daemon stop flushes cache with connected=false", () => {
    const tempDir = makeTempDir();
    const cachePath = join(tempDir, "cache.json");

    try {
      const daemon = new StatusDaemon({ cachePath });

      // Add a pipeline to memory
      daemon.handleEvent(
        "snapshot",
        JSON.stringify({
          type: "snapshot",
          pipelines: [
            { ticketId: "BRE-500", phase: "plan", status: "running", detail: "test" },
          ],
          timestamp: new Date().toISOString(),
        }),
      );

      // Stop should flush with connected=false
      daemon.stop();

      expect(existsSync(cachePath)).toBe(true);
      const cache: CachedStatus = JSON.parse(readFileSync(cachePath, "utf8"));
      expect(cache.connected).toBe(false);
      expect(cache.pipelines).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
