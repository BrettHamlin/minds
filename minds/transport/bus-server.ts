// bus-server.ts — SSE-based inter-agent message bus (BRE-345)
//
// Endpoints:
//   POST /publish              — route a message to a named channel
//   GET  /subscribe/:channel   — stream messages via SSE
//   GET  /status               — health check + stats
//   GET  /dashboard            — minimal HTML pipeline status page (BRE-399)
//
// Constraints:
//   - In-memory only; no disk writes except .minds/bus-port (port discovery)
//   - No authentication — local-only server
//   - Dynamic channels — any string is valid, no pre-registration
//   - Ring buffer of last 100 messages per channel for SSE reconnect

import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { buildSnapshot, formatSnapshotEvent } from "./status-snapshot";
import { mindsRoot } from "../shared/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServerConfig {
  port?: number;
  registryDir?: string;
}

export interface BusMessage {
  id: string;
  seq: number;
  channel: string;
  from: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

// ── State ────────────────────────────────────────────────────────────────────

const RING_BUFFER_SIZE = 100;

// channel → ring buffer of recent messages
const buffers = new Map<string, BusMessage[]>();

let seqCounter = 0;

// channel → set of active SSE subscriber controllers
type SseController = ReadableStreamDefaultController<Uint8Array>;
const subscribers = new Map<string, Set<SseController>>();

let messageCount = 0;
let startTime = Date.now();

// Registry directory for snapshot-on-connect (BRE-397)
// Set by createServer(); used by handleSubscribe() for snapshot injection
let registryDir: string | undefined;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getBuffer(channel: string): BusMessage[] {
  if (!buffers.has(channel)) buffers.set(channel, []);
  return buffers.get(channel)!;
}

function getSubscribers(channel: string): Set<SseController> {
  if (!subscribers.has(channel)) subscribers.set(channel, new Set());
  return subscribers.get(channel)!;
}

function pushToBuffer(channel: string, msg: BusMessage): void {
  const buf = getBuffer(channel);
  buf.push(msg);
  if (buf.length > RING_BUFFER_SIZE) buf.shift();
}

function sseEvent(msg: BusMessage): Uint8Array {
  const data = JSON.stringify(msg);
  return new TextEncoder().encode(`id: ${msg.seq}\ndata: ${data}\n\n`);
}

function fanOut(channel: string, msg: BusMessage): void {
  const subs = subscribers.get(channel);
  if (!subs || subs.size === 0) return;
  const encoded = sseEvent(msg);
  for (const ctrl of subs) {
    try {
      ctrl.enqueue(encoded);
    } catch {
      // Subscriber disconnected — remove it
      subs.delete(ctrl);
    }
  }
}

// ── Request handlers ─────────────────────────────────────────────────────────

function handlePublish(req: Request): Response {
  return req
    .json()
    .then((body: unknown) => {
      if (!body || typeof body !== "object") {
        return new Response("Bad Request: expected JSON object", { status: 400 });
      }
      const b = body as Record<string, unknown>;
      const channel = typeof b["channel"] === "string" ? b["channel"] : null;
      const from = typeof b["from"] === "string" ? b["from"] : "unknown";
      const type = typeof b["type"] === "string" ? b["type"] : "message";

      if (!channel) {
        return new Response("Bad Request: channel is required", { status: 400 });
      }

      const msg: BusMessage = {
        id: crypto.randomUUID(),
        seq: ++seqCounter,
        channel,
        from,
        type,
        payload: b["payload"] ?? null,
        timestamp: Date.now(),
      };

      pushToBuffer(channel, msg);
      fanOut(channel, msg);
      messageCount++;

      return new Response(JSON.stringify({ ok: true, id: msg.id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
    .catch(() => new Response("Bad Request: invalid JSON", { status: 400 }));
}

function handleSubscribe(channel: string, req: Request): Response {
  // Fix 4: Wrap entire subscribe handler in try-catch
  try {
    const lastEventIdHeader = req.headers.get("Last-Event-ID");
    const lastSeq = lastEventIdHeader !== null ? parseInt(lastEventIdHeader, 10) : -1;

    const channelSubs = getSubscribers(channel);
    const buffered = getBuffer(channel)
      .filter((m) => isNaN(lastSeq) || m.seq > lastSeq)
      .slice(); // snapshot of ring buffer, filtered for resume

    let controller!: SseController;

    const isNewConnection = lastSeq === -1;

    // Fix 3: Precompute snapshot BEFORE creating ReadableStream
    // If buildSnapshot() throws, we catch it here instead of inside the stream
    let snapshotEvent: Uint8Array | null = null;
    if (channel === "status" && isNewConnection) {
      const dir = registryDir ?? join(mindsRoot(), "state/pipeline-registry");
      const snapshot = buildSnapshot(dir);
      snapshotEvent = formatSnapshotEvent(snapshot, ++seqCounter);
    }

    // SSE keepalive: send a comment every 30s to prevent client-side
    // body timeouts (Bun's fetch drops idle SSE streams after ~5 min).
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const HEARTBEAT_INTERVAL_MS = 30_000;
    const heartbeatPayload = new TextEncoder().encode(": keepalive\n\n");

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;

        // Snapshot-on-connect for status channel — new connections only (BRE-397)
        // Injected BEFORE channelSubs.add() so live events cannot interleave
        if (snapshotEvent) {
          ctrl.enqueue(snapshotEvent);
        }

        channelSubs.add(ctrl);

        // Replay ring buffer to new subscriber
        for (const msg of buffered) {
          ctrl.enqueue(sseEvent(msg));
        }

        // Start heartbeat timer to keep connection alive
        heartbeatTimer = setInterval(() => {
          try {
            ctrl.enqueue(heartbeatPayload);
          } catch {
            // Stream closed — timer will be cleaned up by cancel()
          }
        }, HEARTBEAT_INTERVAL_MS);
      },
      cancel() {
        channelSubs.delete(controller);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bus-server] handleSubscribe: failed for channel "${channel}" — ${msg}`);
    return new Response(
      JSON.stringify({ ok: false, error: `handleSubscribe: ${msg}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

function handleStatus(): Response {
  const channelStats: Record<string, { buffered: number; subscribers: number }> = {};
  for (const [ch, buf] of buffers) {
    channelStats[ch] = {
      buffered: buf.length,
      subscribers: subscribers.get(ch)?.size ?? 0,
    };
  }
  const body = {
    ok: true,
    uptime: Date.now() - startTime,
    messageCount,
    channels: channelStats,
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

const SUBSCRIBE_RE = /^\/subscribe\/(.+)$/;

export function createServer(opts: ServerConfig = {}) {
  const port = opts.port ?? 0;

  // Reset all state for clean test isolation
  buffers.clear();
  subscribers.clear();
  messageCount = 0;
  seqCounter = 0;
  startTime = Date.now();
  registryDir = opts.registryDir;

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    // Fix 2: Bun.serve error handler — catch server-level errors
    error(err) {
      console.error(
        `[bus-server] Bun.serve error: ${err?.message ?? err}`,
      );
      return new Response("Internal Server Error", { status: 500 });
    },
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "POST" && path === "/publish") {
        return handlePublish(req);
      }

      if (req.method === "GET" && path === "/status") {
        return handleStatus();
      }

      // Dashboard — serve self-contained HTML page (BRE-399)
      if (req.method === "GET" && path === "/dashboard") {
        const html = await Bun.file(join(import.meta.dir, "dashboard.html")).text();
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      const subMatch = path.match(SUBSCRIBE_RE);
      if (req.method === "GET" && subMatch) {
        const channel = decodeURIComponent(subMatch[1]);
        return handleSubscribe(channel, req);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return server;
}

// ── Standalone entry point ───────────────────────────────────────────────────
//
// When run directly (`bun transport/bus-server.ts`), starts the server and
// writes the chosen port to .minds/bus-port.

if (import.meta.main) {
  // Fix 1: Global error handlers — keep the bus alive on unhandled errors
  process.on("uncaughtException", (err) => {
    console.error(
      `[bus-server] uncaughtException — bus staying alive: ${err?.message ?? err}`,
    );
    if (err?.stack) console.error(err.stack);
  });
  process.on("unhandledRejection", (reason) => {
    const msg =
      reason instanceof Error ? reason.message : String(reason ?? "unknown");
    console.error(
      `[bus-server] unhandledRejection — bus staying alive: ${msg}`,
    );
    if (reason instanceof Error && reason.stack) console.error(reason.stack);
  });

  // Parse --registry-dir CLI flag for snapshot-on-connect (FR-010)
  const args = process.argv.slice(2);
  const regDirIdx = args.indexOf("--registry-dir");
  const cliRegistryDir =
    regDirIdx !== -1 && args[regDirIdx + 1]
      ? args[regDirIdx + 1]
      : undefined;

  const server = createServer({ registryDir: cliRegistryDir });
  const port = server.port;

  // Persist port for client discovery
  const mindsDir = mindsRoot();
  if (!existsSync(mindsDir)) mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "bus-port"), String(port), "utf8");

  // Signal readiness to parent process / any watcher
  process.stdout.write(`BUS_READY port=${port}\n`);

  // Keep alive
  process.on("SIGINT", () => {
    server.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}
