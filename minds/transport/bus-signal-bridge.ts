#!/usr/bin/env bun
/**
 * bus-signal-bridge.ts — Subscribes to bus SSE, delivers signals to orchestrator pane
 *
 * Started by orchestrator-init when transport is "bus". Sits between the bus
 * server and the orchestrator tmux pane — last-mile signal delivery.
 *
 * Flow:
 *   Agent emits signal via HTTP POST → bus server → SSE stream → this bridge
 *   → tmux send-keys → orchestrator pane receives typed signal
 *
 * The bridge is an accelerator only. Signals are always written to the
 * signal-queue by the emitter; the bridge delivers faster pickup.
 *
 * Usage:
 *   bun transport/bus-signal-bridge.ts <BUS_URL> <CHANNEL> <ORCHESTRATOR_PANE>
 */

// ── Message handler (exported for testing) ────────────────────────────────

/**
 * Handles a bus message. If it's a "signal" type, delivers the signal string
 * to the given orchestrator pane via tmux send-keys.
 *
 * Accepts the pane as a parameter so it can be tested without running the CLI.
 */
export async function handleBusMessage(msg: unknown, orchestratorPane: string): Promise<void> {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;

  let deliveryText: string | undefined;

  if (m.type === "signal") {
    // Collab pipeline signal: { type: "signal", payload: { signal: "[SIGNAL:...]" } }
    const payload = m.payload as Record<string, unknown> | undefined;
    deliveryText = payload?.signal as string | undefined;
  }
  // Minds events (DRONE_COMPLETE, WAVE_STARTED, etc.) are handled by the
  // deterministic CLI bus-listener — no need to echo them to the orchestrator pane.

  if (!deliveryText) return;

  console.error(`[BusBridge] Delivering: ${deliveryText}`);

  // Send text then C-m separately (Tmux.ts pattern for Claude Code panes).
  Bun.spawnSync(["tmux", "send-keys", "-t", orchestratorPane, deliveryText]);
  Bun.spawnSync(["tmux", "send-keys", "-t", orchestratorPane, "C-m"]);
}

// ── SSE subscription loop ──────────────────────────────────────────────────

// Persists across reconnects so the server can skip already-delivered messages
let lastEventId: string | null = null;

async function subscribeSSE(busUrl: string, channel: string, orchestratorPane: string): Promise<void> {
  const url = `${busUrl}/subscribe/${encodeURIComponent(channel)}`;
  const headers: HeadersInit = {};
  if (lastEventId !== null) {
    headers["Last-Event-ID"] = lastEventId;
  }
  const res = await fetch(url, { headers });

  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: ${res.status}`);
  }

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
      let frameId: string | null = null;
      for (const line of frame.split("\n")) {
        if (line.startsWith("id: ")) {
          frameId = line.slice(4).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const msg = JSON.parse(line.slice(6));
            await handleBusMessage(msg, orchestratorPane);
          } catch {
            // Ignore malformed frames
          }
        }
      }
      if (frameId !== null) lastEventId = frameId;
    }
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

if (import.meta.main) {
  const [busUrl, channel, orchestratorPane] = process.argv.slice(2);

  if (!busUrl || !channel || !orchestratorPane) {
    console.error("[BusBridge] Usage: bus-signal-bridge.ts <BUS_URL> <CHANNEL> <ORCHESTRATOR_PANE>");
    process.exit(1);
  }

  console.error(`[BusBridge] Listening on ${busUrl}/subscribe/${channel} → pane ${orchestratorPane}`);

  // Main loop with reconnect
  while (true) {
    try {
      await subscribeSSE(busUrl, channel, orchestratorPane);
      console.error("[BusBridge] SSE stream ended. Reconnecting...");
    } catch (err) {
      console.error(`[BusBridge] Error: ${err}. Reconnecting in 1s...`);
      await Bun.sleep(1000);
    }
  }
}
