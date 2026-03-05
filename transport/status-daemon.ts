// status-daemon.ts — Background daemon consuming aggregator SSE stream (BRE-398)
//
// Subscribes to StatusAggregator's /subscribe/status endpoint, maintains
// pipeline state in memory, and writes debounced cache file for the
// statusline reader (collab-statusline.ts).
//
// Dependencies:
//   - PipelineSnapshot, StatusSnapshot from ./status-snapshot
//   - deriveStatus, deriveDetail from ./status-derive (local transport module)

import * as fs from "fs";
import * as path from "path";
import type { PipelineSnapshot, StatusSnapshot } from "./status-snapshot";
import { deriveStatus, deriveDetail } from "./status-derive";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CachedStatus {
  pipelines: PipelineSnapshot[];
  lastUpdate: string;
  connected: boolean;
}

export interface StatusDaemonConfig {
  port?: number;
  aggregatorUrl?: string;
  cachePath?: string;
  registryDir?: string;
}

// ── Foundational Utilities ───────────────────────────────────────────────────

/**
 * Discover the aggregator URL by reading the .collab/aggregator-port file.
 * Returns null if the file doesn't exist or is unreadable.
 * Follows discoverBusUrl() pattern from status-emitter.ts.
 */
export function discoverAggregatorUrl(repoRoot?: string): string | null {
  try {
    const root = repoRoot || process.cwd();
    const portFile = path.join(root, ".collab", "aggregator-port");
    if (!fs.existsSync(portFile)) return null;
    const content = fs.readFileSync(portFile, "utf-8").trim();
    const port = parseInt(content, 10);
    if (isNaN(port)) return null;
    return `http://localhost:${port}`;
  } catch {
    return null;
  }
}

/**
 * Convert a raw registry object into a PipelineSnapshot.
 * Follows the exact mapping from status-snapshot.ts:60-87.
 */
export function registryToPipelineSnapshot(
  reg: Record<string, unknown>,
): PipelineSnapshot {
  const phasePlan = reg.implement_phase_plan as
    | { current_impl_phase: number; total_phases: number }
    | undefined;

  return {
    ticketId: (reg.ticket_id as string) || "unknown",
    phase: (reg.current_step as string) || "unknown",
    status: deriveStatus(reg),
    detail: deriveDetail(reg),
    busUrl: reg.bus_url as string | undefined,
    startedAt: reg.started_at as string | undefined,
    updatedAt: reg.updated_at as string | undefined,
    phaseHistory: reg.phase_history as
      | Array<{ phase: string; signal: string; ts: string }>
      | undefined,
    implProgress: phasePlan
      ? { current: phasePlan.current_impl_phase, total: phasePlan.total_phases }
      : undefined,
  };
}

/**
 * Atomically write the status cache file.
 * Uses writeFileSync(tmp) + renameSync(tmp, final) pattern from utils.ts.
 * Does NOT call emitStatusEvent to prevent feedback loops.
 */
export function writeCacheAtomic(
  pipelines: Map<string, PipelineSnapshot>,
  connected: boolean,
  cachePath: string,
): void {
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });

  const cache: CachedStatus = {
    pipelines: Array.from(pipelines.values()),
    lastUpdate: new Date().toISOString(),
    connected,
  };

  const tmp = `${cachePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n");
  fs.renameSync(tmp, cachePath);
}

// ── StatusDaemon Class ───────────────────────────────────────────────────────

const DEBOUNCE_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const RECONNECT_DELAY_MS = 2000;
const DEFAULT_CACHE_PATH = ".collab/state/status-cache.json";

export class StatusDaemon {
  private readonly pipelines = new Map<string, PipelineSnapshot>();
  private connected = false;
  private lastEventId: string | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cachePath: string;
  private readonly aggregatorUrl: string | null;
  private readonly startTime = Date.now();
  private abortController: AbortController | null = null;

  constructor(config: StatusDaemonConfig = {}) {
    this.cachePath = config.cachePath || DEFAULT_CACHE_PATH;
    this.aggregatorUrl = config.aggregatorUrl || null;
  }

  // ── Event Handling ──────────────────────────────────────────────────────

  handleEvent(eventType: string, data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (eventType === "snapshot") {
        // Full snapshot: replace all pipelines
        this.pipelines.clear();
        const snapshot = parsed as {
          type: string;
          pipelines: PipelineSnapshot[];
          timestamp: string;
        };
        for (const p of snapshot.pipelines) {
          this.pipelines.set(p.ticketId, p);
        }
        this.connected = true;
      } else {
        // Incremental event — may arrive as raw StatusEvent or wrapped in BusMessage
        // BusMessage format: { id, seq, channel, from, type, payload: StatusEvent, timestamp }
        // StatusEvent format: { ticketId, eventType, changedFields, snapshot, timestamp }
        const event = parsed.payload && parsed.payload.ticketId ? parsed.payload : parsed;
        const ticketId = event.ticketId as string;
        const snapshot = event.snapshot as Record<string, unknown> | undefined;
        const currentStep = snapshot?.current_step as string | undefined;

        if (
          event.eventType === "registry_updated" &&
          currentStep === "done"
        ) {
          // Pipeline completed — remove entry
          this.pipelines.delete(ticketId);
        } else if (snapshot) {
          // Update pipeline from full registry snapshot
          this.pipelines.set(ticketId, registryToPipelineSnapshot(snapshot));
        }
      }

      this.scheduleCacheWrite();
    } catch {
      // Malformed event data — ignore
    }
  }

  // ── Debounced Cache Write ───────────────────────────────────────────────

  private scheduleCacheWrite(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      writeCacheAtomic(this.pipelines, this.connected, this.cachePath);
    }, DEBOUNCE_MS);
  }

  // ── SSE Loop ────────────────────────────────────────────────────────────

  private async _sseLoop(): Promise<void> {
    let backoff = 1000;

    while (this.abortController && !this.abortController.signal.aborted) {
      // Discover aggregator URL
      const url = this.aggregatorUrl || discoverAggregatorUrl();
      if (!url) {
        await Bun.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }
      backoff = 1000; // Reset on successful discovery

      try {
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
        };
        if (this.lastEventId !== null) {
          headers["Last-Event-ID"] = this.lastEventId;
        }

        const res = await fetch(`${url}/subscribe/status`, {
          headers,
          signal: this.abortController.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE connect failed: ${res.status}`);
        }

        this.connected = true;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";

          for (const frame of frames) {
            if (!frame.trim()) continue;

            let frameEvent = "";
            let frameId = "";
            let frameData = "";

            for (const line of frame.split("\n")) {
              if (line.startsWith("event: ")) frameEvent = line.slice(7);
              else if (line.startsWith("id: ")) frameId = line.slice(4);
              else if (line.startsWith("data: ")) frameData = line.slice(6);
            }

            if (frameId) this.lastEventId = frameId;
            if (frameData) this.handleEvent(frameEvent, frameData);
          }
        }
      } catch {
        // Connection lost or aborted
      }

      this.connected = false;
      this.scheduleCacheWrite();

      if (this.abortController && !this.abortController.signal.aborted) {
        await Bun.sleep(RECONNECT_DELAY_MS);
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    this.abortController = new AbortController();
    this.connected = false;
    void this._sseLoop().catch(() => {
      // Errors handled inside the loop
    });
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Flush final cache write
    writeCacheAtomic(this.pipelines, false, this.cachePath);
  }

  // ── Accessors (for tests and health endpoint) ──────────────────────────

  getPipelineCount(): number {
    return this.pipelines.size;
  }

  getPipelines(): Map<string, PipelineSnapshot> {
    return this.pipelines;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStartTime(): number {
    return this.startTime;
  }

  // ── Health Endpoint ─────────────────────────────────────────────────────

  handleStatus(): Response {
    const body = {
      ok: true,
      uptime: Date.now() - this.startTime,
      connected: this.connected,
      lastUpdate: new Date().toISOString(),
      pipelineCount: this.pipelines.size,
    };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Server Factory ─────────────────────────────────────────────────────────

export function createStatusDaemonServer(config: StatusDaemonConfig = {}): {
  server: ReturnType<typeof Bun.serve>;
  daemon: StatusDaemon;
} {
  const daemon = new StatusDaemon(config);
  daemon.start();

  const server = Bun.serve({
    port: config.port ?? 0,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/status") {
        return daemon.handleStatus();
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, daemon };
}

// ── Standalone Entry Point ─────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);

  // Parse CLI args
  const portIdx = args.indexOf("--port");
  const cliPort =
    portIdx !== -1 && args[portIdx + 1]
      ? parseInt(args[portIdx + 1], 10)
      : 0;

  const aggUrlIdx = args.indexOf("--aggregator-url");
  const cliAggregatorUrl =
    aggUrlIdx !== -1 && args[aggUrlIdx + 1] ? args[aggUrlIdx + 1] : undefined;

  // Singleton check
  const collabDir = path.join(process.cwd(), ".collab");
  const portFile = path.join(collabDir, "status-daemon-port");

  if (fs.existsSync(portFile)) {
    try {
      const existingPort = parseInt(fs.readFileSync(portFile, "utf8").trim(), 10);
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
              `STATUS_DAEMON_EXISTING port=${existingPort}\n`,
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
  const { server, daemon } = createStatusDaemonServer({
    port: cliPort,
    aggregatorUrl: cliAggregatorUrl,
  });

  // Write port and pid files for discovery
  if (!fs.existsSync(collabDir)) fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(portFile, String(server.port), "utf8");
  fs.writeFileSync(
    path.join(collabDir, "status-daemon-pid"),
    String(process.pid),
    "utf8",
  );

  // Signal readiness
  process.stdout.write(`STATUS_DAEMON_READY port=${server.port}\n`);

  // Graceful shutdown
  const shutdown = () => {
    daemon.stop();
    server.stop();
    try { fs.unlinkSync(portFile); } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(collabDir, "status-daemon-pid")); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
