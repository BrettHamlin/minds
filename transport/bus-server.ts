// bus-server.ts — SSE-based inter-agent message bus (BRE-345)
//
// Endpoints:
//   POST /publish              — route a message to a named channel
//   GET  /subscribe/:channel   — stream messages via SSE
//   GET  /status               — health check + stats
//
// Constraints:
//   - In-memory only; no disk writes except .collab/bus-port (port discovery)
//   - No authentication — local-only server
//   - Dynamic channels — any string is valid, no pre-registration
//   - Ring buffer of last 100 messages per channel for SSE reconnect

import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BusMessage {
  id: string;
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

// channel → set of active SSE subscriber controllers
type SseController = ReadableStreamDefaultController<Uint8Array>;
const subscribers = new Map<string, Set<SseController>>();

let messageCount = 0;
let startTime = Date.now();

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
  return new TextEncoder().encode(`data: ${data}\n\n`);
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

function handleSubscribe(channel: string): Response {
  const channelSubs = getSubscribers(channel);
  const buffered = getBuffer(channel).slice(); // snapshot of ring buffer

  let controller!: SseController;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      channelSubs.add(ctrl);

      // Replay ring buffer to new subscriber
      for (const msg of buffered) {
        ctrl.enqueue(sseEvent(msg));
      }
    },
    cancel() {
      channelSubs.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
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

export function createServer(port = 0) {
  // Reset all state for clean test isolation
  buffers.clear();
  subscribers.clear();
  messageCount = 0;
  startTime = Date.now();

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "POST" && path === "/publish") {
        return handlePublish(req);
      }

      if (req.method === "GET" && path === "/status") {
        return handleStatus();
      }

      const subMatch = path.match(SUBSCRIBE_RE);
      if (req.method === "GET" && subMatch) {
        const channel = decodeURIComponent(subMatch[1]);
        return handleSubscribe(channel);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return server;
}

// ── Standalone entry point ───────────────────────────────────────────────────
//
// When run directly (`bun transport/bus-server.ts`), starts the server and
// writes the chosen port to .collab/bus-port.

if (import.meta.main) {
  const server = createServer(0);
  const port = server.port;

  // Persist port for client discovery
  const collabDir = join(process.cwd(), ".collab");
  if (!existsSync(collabDir)) mkdirSync(collabDir, { recursive: true });
  writeFileSync(join(collabDir, "bus-port"), String(port), "utf8");

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
