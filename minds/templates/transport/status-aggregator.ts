// status-aggregator.ts — Unified status stream across concurrent pipeline instances (BRE-402)
//
// Watches the pipeline registry directory for active pipelines, subscribes to
// each pipeline's bus server SSE endpoint, merges all status events into a
// single unified SSE stream, and provides snapshot-on-connect for new subscribers.
//
// Endpoints:
//   GET /subscribe/status   — unified SSE stream (snapshot + live events)
//   GET /status             — health check + connection stats
//
// Constraints:
//   - In-memory only; writes .collab/aggregator-port for discovery
//   - No external dependencies — Bun built-ins only
//   - Singleton: checks for existing instance on startup
//   - Reuses buildSnapshot/formatSnapshotEvent from status-snapshot.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { watch, type FSWatcher } from "fs";
import { buildSnapshot, formatSnapshotEvent } from "./status-snapshot";
import { MindsStateTracker } from "../dashboard/state-tracker.js";
import { createMindsRouteHandler } from "../dashboard/route-handler.js";
import type { MindsBusMessage } from "./minds-events.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AggregatorConfig {
  port?: number;
  registryDir?: string;
}

export interface PipelineConnection {
  ticketId: string;
  busUrl: string;
  abortController: AbortController;
  lastEventId: string;
  connected: boolean;
}

// ── StatusAggregator ─────────────────────────────────────────────────────────

type SseController = ReadableStreamDefaultController<Uint8Array>;

const DEBOUNCE_MS = 200;
const RECONNECT_DELAY_MS = 2000;

export class StatusAggregator {
  readonly connections = new Map<string, PipelineConnection>();
  readonly subscribers = new Set<SseController>();
  private seqCounter = 0;
  private readonly registryDir: string;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly startTime = Date.now();
  mindsTracker: MindsStateTracker | null = null;

  constructor(registryDir: string) {
    this.registryDir = registryDir;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Begin watching registry directory and perform initial scan. */
  start(): void {
    // Create registry dir if missing
    if (!existsSync(this.registryDir)) {
      mkdirSync(this.registryDir, { recursive: true });
    }

    // Initial scan
    this.scanRegistries();

    // Watch for changes with debounce
    this.watcher = watch(this.registryDir, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.scanRegistries();
      }, DEBOUNCE_MS);
    });
  }

  /** Stop watching, abort all connections, close all subscribers. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Abort all bus connections
    for (const conn of this.connections.values()) {
      conn.abortController.abort();
    }
    this.connections.clear();

    // Close all subscriber streams
    for (const ctrl of this.subscribers) {
      try {
        ctrl.close();
      } catch {
        // Already closed
      }
    }
    this.subscribers.clear();
  }

  // ── Registry scanning ────────────────────────────────────────────────────

  /** Scan registry directory, connect to new buses, disconnect from removed ones. */
  scanRegistries(): void {
    let files: string[] = [];
    try {
      files = readdirSync(this.registryDir).filter((f) => f.endsWith(".json"));
    } catch {
      return; // Dir unreadable — no-op
    }

    const activeTickets = new Set<string>();

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.registryDir, file), "utf8");
        const reg = JSON.parse(raw) as Record<string, unknown>;
        const ticketId =
          (reg.ticket_id as string) || file.replace(".json", "");
        const busUrl = reg.bus_url as string | undefined;

        activeTickets.add(ticketId);

        if (busUrl && !this.connections.has(ticketId)) {
          // New pipeline with bus_url — connect
          this.connectToBus(ticketId, busUrl);
        } else if (busUrl && this.connections.has(ticketId)) {
          // Check if bus_url changed
          const existing = this.connections.get(ticketId)!;
          if (existing.busUrl !== busUrl) {
            existing.abortController.abort();
            this.connections.delete(ticketId);
            this.connectToBus(ticketId, busUrl);
          }
        } else if (!busUrl && this.connections.has(ticketId)) {
          // bus_url removed — drop SSE connection but keep ticket tracked
          const existing = this.connections.get(ticketId)!;
          existing.abortController.abort();
          this.connections.delete(ticketId);
        }
      } catch {
        // Corrupt or unparseable file — skip
      }
    }

    // Remove connections for deleted pipeline registry files
    for (const [ticketId, conn] of this.connections) {
      if (!activeTickets.has(ticketId)) {
        conn.abortController.abort();
        this.connections.delete(ticketId);
      }
    }
  }

  // ── Bus connection ───────────────────────────────────────────────────────

  /** Subscribe to a pipeline's bus server SSE stream. Stub — enhanced in Phase 4/5. */
  connectToBus(ticketId: string, busUrl: string): void {
    const abortController = new AbortController();
    const conn: PipelineConnection = {
      ticketId,
      busUrl,
      abortController,
      lastEventId: "",
      connected: false,
    };
    this.connections.set(ticketId, conn);

    // Start SSE read loop in background
    void this._sseLoop(conn).catch(() => {
      // Errors handled inside the loop
    });
  }

  /** SSE read loop with reconnection. */
  private async _sseLoop(conn: PipelineConnection): Promise<void> {
    while (!conn.abortController.signal.aborted) {
      try {
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
        };
        if (conn.lastEventId) {
          headers["Last-Event-ID"] = conn.lastEventId;
        }

        const res = await fetch(`${conn.busUrl}/subscribe/status`, {
          headers,
          signal: conn.abortController.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE stream failed: ${res.status}`);
        }

        conn.connected = true;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });

          // SSE frames separated by double newlines
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";

          for (const frame of frames) {
            if (!frame.trim()) continue;

            // Extract id and data lines
            let eventId = "";
            let dataLine = "";
            let eventType = "";

            for (const line of frame.split("\n")) {
              if (line.startsWith("id: ")) eventId = line.slice(4);
              else if (line.startsWith("data: ")) dataLine = line.slice(6);
              else if (line.startsWith("event: ")) eventType = line.slice(7);
            }

            if (eventId) conn.lastEventId = eventId;

            if (dataLine) {
              // Route minds events to the state tracker
              if (this.mindsTracker) {
                try {
                  const parsed = JSON.parse(dataLine) as Record<string, unknown>;
                  if (
                    typeof parsed.channel === "string" &&
                    parsed.channel.startsWith("minds-")
                  ) {
                    this.mindsTracker.applyEvent(parsed as unknown as MindsBusMessage);
                  }
                } catch {
                  // Not JSON or no channel field — not a minds event
                }
              }

              // Relay event to aggregator subscribers with our own sequence ID
              const seq = ++this.seqCounter;
              let encoded: Uint8Array;
              if (eventType) {
                encoded = new TextEncoder().encode(
                  `event: ${eventType}\nid: ${seq}\ndata: ${dataLine}\n\n`,
                );
              } else {
                encoded = new TextEncoder().encode(
                  `id: ${seq}\ndata: ${dataLine}\n\n`,
                );
              }
              this.fanOut(encoded);
            }
          }
        }
      } catch {
        conn.connected = false;
        if (!conn.abortController.signal.aborted) {
          await Bun.sleep(RECONNECT_DELAY_MS);
        }
      }
    }
    conn.connected = false;
  }

  // ── Subscriber management ────────────────────────────────────────────────

  /** Fan out an encoded SSE frame to all subscribers. */
  private fanOut(encoded: Uint8Array): void {
    for (const ctrl of this.subscribers) {
      try {
        ctrl.enqueue(encoded);
      } catch {
        this.subscribers.delete(ctrl);
      }
    }
  }

  /** Handle GET /subscribe/status — SSE endpoint. */
  handleSubscribe(req: Request): Response {
    const lastEventIdHeader = req.headers.get("Last-Event-ID");
    const isNewConnection = lastEventIdHeader === null;

    let controller!: SseController;

    const stream = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        controller = ctrl;

        // Snapshot-on-connect for new connections only
        if (isNewConnection) {
          const snapshot = buildSnapshot(this.registryDir);
          ctrl.enqueue(formatSnapshotEvent(snapshot, ++this.seqCounter));
        }

        this.subscribers.add(ctrl);
      },
      cancel: () => {
        this.subscribers.delete(controller);
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

  /** Handle GET /status — health endpoint. */
  handleStatus(): Response {
    const pipelines: Record<string, { busUrl: string; connected: boolean }> =
      {};
    for (const [ticketId, conn] of this.connections) {
      pipelines[ticketId] = {
        busUrl: conn.busUrl,
        connected: conn.connected,
      };
    }

    const body = {
      ok: true,
      uptime: Date.now() - this.startTime,
      pipelines,
      pipelineCount: this.connections.size,
      connectedCount: [...this.connections.values()].filter((c) => c.connected)
        .length,
      subscriberCount: this.subscribers.size,
    };

    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  getConnectionCount(): number {
    return this.connections.size;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getRegistryDir(): string {
    return this.registryDir;
  }
}

// ── Server factory ──────────────────────────────────────────────────────────

export function createAggregatorServer(opts: AggregatorConfig = {}): {
  server: ReturnType<typeof Bun.serve>;
  aggregator: StatusAggregator;
  mindsTracker: MindsStateTracker;
} {
  const port = opts.port ?? 0;
  const registryDir =
    opts.registryDir ??
    join(process.cwd(), ".collab/state/pipeline-registry");

  const mindsTracker = new MindsStateTracker();
  const mindsHandler = createMindsRouteHandler(mindsTracker);

  const aggregator = new StatusAggregator(registryDir);
  aggregator.mindsTracker = mindsTracker;
  aggregator.start();

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET" && path === "/subscribe/status") {
        return aggregator.handleSubscribe(req);
      }

      if (req.method === "GET" && path === "/status") {
        return aggregator.handleStatus();
      }

      const mindsResponse = mindsHandler(req);
      if (mindsResponse) return mindsResponse;

      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, aggregator, mindsTracker };
}

// ── Standalone entry point ──────────────────────────────────────────────────
//
// Usage: bun transport/status-aggregator.ts [--port PORT] [--registry-dir DIR]

if (import.meta.main) {
  const args = process.argv.slice(2);

  // Parse CLI args
  const portIdx = args.indexOf("--port");
  const cliPort =
    portIdx !== -1 && args[portIdx + 1]
      ? parseInt(args[portIdx + 1], 10)
      : 0;

  const regDirIdx = args.indexOf("--registry-dir");
  const cliRegistryDir =
    regDirIdx !== -1 && args[regDirIdx + 1] ? args[regDirIdx + 1] : undefined;

  // Singleton check — verify existing instance is alive
  const collabDir = join(process.cwd(), ".collab");
  const portFile = join(collabDir, "aggregator-port");

  if (existsSync(portFile)) {
    try {
      const existingPort = parseInt(readFileSync(portFile, "utf8").trim(), 10);
      if (!isNaN(existingPort)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
          const res = await fetch(
            `http://localhost:${existingPort}/status`,
            { signal: controller.signal },
          );
          clearTimeout(timeout);
          const body = (await res.json()) as { ok?: boolean };
          if (res.ok && body.ok) {
            process.stdout.write(
              `AGGREGATOR_EXISTING port=${existingPort}\n`,
            );
            process.exit(0);
          }
        } catch {
          clearTimeout(timeout);
          // Stale port file — proceed to start
        }
      }
    } catch {
      // Can't read port file — proceed to start
    }
  }

  // Start the server
  const { server, aggregator } = createAggregatorServer({
    port: cliPort,
    registryDir: cliRegistryDir,
  });

  // Write port for discovery
  if (!existsSync(collabDir)) mkdirSync(collabDir, { recursive: true });
  writeFileSync(portFile, String(server.port), "utf8");

  // Signal readiness
  process.stdout.write(`AGGREGATOR_READY port=${server.port}\n`);
  console.log(`Dashboard running on http://localhost:${server.port}/minds`);

  // Graceful shutdown
  const shutdown = () => {
    aggregator.stop();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
