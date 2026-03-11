#!/usr/bin/env bun
/**
 * bus-command-bridge.ts — Subscribes to bus SSE, delivers commands to agent pane
 *
 * Started by orchestrator-init when transport is "bus". Sits between the bus
 * server and the agent tmux pane — last-mile command delivery.
 *
 * Flow:
 *   Orchestrator publishes command via HTTP POST → bus server → SSE stream → this bridge
 *   → tmux send-keys → agent pane receives typed command
 *   → bridge publishes command_received ack back to bus
 *
 * Usage:
 *   bun transport/bus-command-bridge.ts <BUS_URL> <CHANNEL> <AGENT_PANE>
 */

// ── Message handler (exported for testing) ────────────────────────────────

/**
 * Handles a bus message delivered via SSE.
 *
 * - "command" messages: types the command into the agent pane via tmux send-keys
 *   (double C-m pattern for Claude Code), then publishes a command_received ack.
 * - "question_response" messages: navigates AskUserQuestion UI with Down key(s) + Enter.
 * - All other types: silently ignored.
 *
 * Accepts busUrl/channel as parameters so it can be tested without the CLI loop.
 */
export async function handleCommandMessage(
  msg: unknown,
  agentPane: string,
  busUrl: string,
  channel: string
): Promise<void> {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;

  if (m.type === "command") {
    const payload = m.payload as Record<string, unknown> | undefined;
    const command = payload?.command as string | undefined;
    if (!command) return;

    console.error(`[CmdBridge] Delivering: ${command}`);

    // NOTE: These raw tmux calls intentionally do NOT use TerminalMultiplexer.sendKeys().
    // The multiplexer's sendKeys sends text + Enter atomically in a single call, but
    // Claude Code panes require the two-step pattern (send text, then send C-m separately)
    // with a delay between them. Same rationale as tmux-send.ts.
    Bun.spawnSync(["tmux", "send-keys", "-t", agentPane, command]);
    Bun.spawnSync(["tmux", "send-keys", "-t", agentPane, "C-m"]);

    // Wait 1s then send C-m again — ensures Claude Code processes the command
    await Bun.sleep(1000);
    Bun.spawnSync(["tmux", "send-keys", "-t", agentPane, "C-m"]);

    // Publish command_received ack back to bus
    try {
      await fetch(`${busUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          from: "bus-command-bridge",
          type: "command_received",
          payload: { command, agent_pane: agentPane },
        }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Bus unavailable — ignore
    }
  } else if (m.type === "question_response") {
    // Navigate AskUserQuestion UI: press Down N times (based on steps) then Enter.
    // NOTE: Raw tmux calls — same two-step/delay rationale as above. Individual
    // keystrokes with delays between them are incompatible with the atomic sendKeys interface.
    const payload = m.payload as Record<string, unknown> | undefined;
    const steps = typeof payload?.steps === "number" ? payload.steps : 1;
    for (let i = 0; i < steps; i++) {
      Bun.spawnSync(["tmux", "send-keys", "-t", agentPane, "Down"]);
      await Bun.sleep(100);
    }
    Bun.spawnSync(["tmux", "send-keys", "-t", agentPane, "Enter"]);
  }
  // All other types: silently ignored
}

// ── SSE subscription loop ──────────────────────────────────────────────────

// Persists across reconnects so the server can skip already-delivered messages
let lastEventId: string | null = null;

async function subscribeSSE(busUrl: string, channel: string, agentPane: string): Promise<void> {
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
            await handleCommandMessage(msg, agentPane, busUrl, channel);
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
  const [busUrl, channel, agentPane] = process.argv.slice(2);

  if (!busUrl || !channel || !agentPane) {
    console.error("[CmdBridge] Usage: bus-command-bridge.ts <BUS_URL> <CHANNEL> <AGENT_PANE>");
    process.exit(1);
  }

  console.error(`[CmdBridge] Listening on ${busUrl}/subscribe/${channel} → pane ${agentPane}`);

  // Main loop with reconnect
  while (true) {
    try {
      await subscribeSSE(busUrl, channel, agentPane);
      console.error("[CmdBridge] SSE stream ended. Reconnecting...");
    } catch (err) {
      console.error(`[CmdBridge] Error: ${err}. Reconnecting in 1s...`);
      await Bun.sleep(1000);
    }
  }
}
