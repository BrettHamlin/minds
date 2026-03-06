// BusTransport — SSE-based message bus transport (BRE-345).
//
// Publishes messages by POSTing to the bus server's /publish endpoint.
// Subscribes by opening a streaming GET to /subscribe/:channel and
// parsing SSE frames.
//
// Lifecycle (BRE-391): BusTransport can also own the bus server and bridge
// processes. Call start() to spawn them, then startCommandBridge() once the
// agent pane is known, and teardown() to shut everything down.

import type { Transport, Message, Unsubscribe } from "./Transport.ts";
import { generateAgentPrompt } from "./bus-agent.ts";
import * as path from "path";
import { spawn } from "child_process";

// ---------------------------------------------------------------------------
// Lifecycle helpers (bus server + bridge spawning)
// ---------------------------------------------------------------------------

/**
 * Start bus-server.ts as a detached background process.
 * Resolves with { pid, url } once BUS_READY is printed to stdout.
 */
function spawnBusServer(serverPath: string, cwd: string): Promise<{ pid: number; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", [serverPath], {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      detached: true,
    });

    proc.unref();

    const timeout = setTimeout(() => {
      try { process.kill(proc.pid!, "SIGTERM"); } catch { /* ignore */ }
      reject(new Error("Bus server startup timeout (5s)"));
    }, 5000);

    proc.stdout!.on("data", (data: Buffer) => {
      const match = data.toString().match(/BUS_READY port=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        resolve({ pid: proc.pid!, url: `http://localhost:${port}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Bus server spawn error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bus server exited unexpectedly (code ${code})`));
    });
  });
}

/**
 * Start a bridge daemon as a detached background process.
 */
function spawnBridge(scriptPath: string, args: string[], cwd: string): number {
  const proc = spawn("bun", [scriptPath, ...args], {
    cwd,
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return proc.pid!;
}

// ---------------------------------------------------------------------------
// BusTransport
// ---------------------------------------------------------------------------

export class BusTransport implements Transport {
  // Track active AbortControllers so teardown() can close all SSE streams.
  private readonly subscriptions = new Set<AbortController>();

  // Lifecycle state (populated by start() / startCommandBridge())
  private busServerPid?: number;
  private bridgePid?: number;
  private commandBridgePid?: number;

  /**
   * @param busUrl - URL of the running bus server (e.g. "http://localhost:7777").
   *   Pass "" when using lifecycle mode (start() will update this).
   * @param pids - Optional PIDs for teardown-only usage (when bus was started
   *   externally and PIDs are read from registry).
   */
  constructor(
    private busUrl: string,
    pids?: { busServerPid?: number; bridgePid?: number; commandBridgePid?: number }
  ) {
    if (pids) {
      this.busServerPid = pids.busServerPid;
      this.bridgePid = pids.bridgePid;
      this.commandBridgePid = pids.commandBridgePid;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the bus server and signal bridge.
   * Call this before spawning the agent pane.
   * Sets this.busUrl to the started server's URL.
   *
   * @param repoRoot       - Absolute path to the repo (script discovery)
   * @param orchestratorPane - tmux pane ID for last-mile signal delivery
   * @param ticketId       - Pipeline ticket ID (used as bus channel)
   */
  async start(repoRoot: string, orchestratorPane: string, ticketId: string): Promise<void> {
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    const serverPath = path.join(thisDir, "bus-server.ts");
    const bridgePath = path.join(thisDir, "bus-signal-bridge.ts");

    const { pid: serverPid, url } = await spawnBusServer(serverPath, repoRoot);
    this.busServerPid = serverPid;
    this.busUrl = url;

    const bridgePid = spawnBridge(
      bridgePath,
      [url, `pipeline-${ticketId}`, orchestratorPane],
      repoRoot
    );
    this.bridgePid = bridgePid;
  }

  /**
   * Start the bus command bridge (last-mile delivery from bus to agent pane).
   * Call this after the agent pane is spawned.
   *
   * @param repoRoot  - Absolute path to the repo (script discovery)
   * @param agentPane - tmux pane ID of the agent
   * @param ticketId  - Pipeline ticket ID (used as bus channel)
   */
  startCommandBridge(repoRoot: string, agentPane: string, ticketId: string): void {
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    const bridgePath = path.join(thisDir, "bus-command-bridge.ts");

    const pid = spawnBridge(
      bridgePath,
      [this.busUrl, `pipeline-${ticketId}`, agentPane],
      repoRoot
    );
    this.commandBridgePid = pid;
  }

  /**
   * Returns the PIDs and URL needed to store lifecycle info in the registry,
   * and to reconstruct this transport for teardown.
   */
  getLifecycleInfo(): {
    busUrl: string;
    busServerPid?: number;
    bridgePid?: number;
    commandBridgePid?: number;
  } {
    return {
      busUrl: this.busUrl,
      busServerPid: this.busServerPid,
      bridgePid: this.bridgePid,
      commandBridgePid: this.commandBridgePid,
    };
  }

  /**
   * Inject COLLAB_TRANSPORT and BUS_URL env vars into an agent spawn command,
   * positioned immediately before the `claude` invocation.
   */
  injectAgentEnv(spawnCmd: string): string {
    return spawnCmd.replace(
      "claude --dangerously-skip-permissions",
      `COLLAB_TRANSPORT=bus BUS_URL=${this.busUrl} claude --dangerously-skip-permissions`
    );
  }

  // ── publish ────────────────────────────────────────────────────────────────

  async publish(
    channel: string,
    message: Omit<Message, "id" | "timestamp">
  ): Promise<void> {
    const body = JSON.stringify({
      channel,
      from: message.from,
      type: message.type,
      payload: message.payload,
    });

    const res = await fetch(`${this.busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      throw new Error(`BusTransport.publish failed: ${res.status} ${await res.text()}`);
    }
  }

  // ── subscribe ──────────────────────────────────────────────────────────────

  async subscribe(
    channel: string,
    handler: (msg: Message) => void
  ): Promise<Unsubscribe> {
    const ac = new AbortController();
    this.subscriptions.add(ac);

    const url = `${this.busUrl}/subscribe/${encodeURIComponent(channel)}`;

    // Start the SSE loop in the background — fire-and-forget
    void this._sseLoop(url, handler, ac.signal).catch(() => {
      // Ignore errors after abort (expected on teardown)
    });

    const unsubscribe: Unsubscribe = () => {
      ac.abort();
      this.subscriptions.delete(ac);
    };

    return unsubscribe;
  }

  private async _sseLoop(
    url: string,
    handler: (msg: Message) => void,
    signal: AbortSignal
  ): Promise<void> {
    const res = await fetch(url, { signal });

    if (!res.ok || !res.body) {
      throw new Error(`SSE stream failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      // SSE frames are separated by double newlines
      const frames = buf.split("\n\n");
      // Last element is the incomplete frame (keep it in buffer)
      buf = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.trim()) continue;
        for (const line of frame.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6)) as Message;
              handler(msg);
            } catch {
              // Ignore malformed frames
            }
          }
        }
      }
    }
  }

  // ── teardown ───────────────────────────────────────────────────────────────

  /**
   * Release all resources:
   *   1. Close all active SSE subscriptions.
   *   2. Kill bus server, signal bridge, and command bridge processes (if known).
   */
  async teardown(): Promise<void> {
    // Close SSE streams
    for (const ac of this.subscriptions) {
      ac.abort();
    }
    this.subscriptions.clear();

    // Kill lifecycle processes
    const targets: [string, number | undefined][] = [
      ["bus server", this.busServerPid],
      ["signal bridge", this.bridgePid],
      ["command bridge", this.commandBridgePid],
    ];

    for (const [label, pid] of targets) {
      if (pid === undefined) continue;
      try {
        process.kill(pid, "SIGTERM");
        console.error(`Killed ${label} (pid ${pid})`);
      } catch {
        console.error(`${label} (pid ${pid}) already dead or not found`);
      }
    }
  }

  // ── agentPrompt ────────────────────────────────────────────────────────────

  agentPrompt(agentId: string, channel: string): string {
    return generateAgentPrompt(agentId, this.busUrl, channel);
  }
}
