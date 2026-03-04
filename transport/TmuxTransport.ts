// TmuxTransport — wraps existing tmux send-keys / capture-pane behavior
// behind the Transport interface (BRE-347).
//
// Mapping:
//   channel  → tmux pane ID (%N)
//   publish  → tmux send-keys (sends text to the pane)
//   subscribe → poll capture-pane every 250ms for [SIGNAL] lines
//   teardown → cancel all active subscriptions
//   agentPrompt → "[SIGNAL] SIGNAL_NAME" instructions

import type { Transport, Message, Unsubscribe } from "./Transport.ts";
import { tmux, sleepMs, sendToPane } from "../src/lib/pipeline/tmux-client.ts";

/** Matches the canonical pipelang signal format: [SIGNAL] SIGNAL_NAME */
const SIGNAL_RE = /\[SIGNAL\]\s+([A-Z][A-Z0-9_]+)/;

export class TmuxTransport implements Transport {
  private readonly activeUnsubs = new Set<() => void>();

  /**
   * @param session - tmux session name (used in agentPrompt context)
   * @param window  - tmux window name (used in agentPrompt context)
   */
  constructor(
    private readonly session: string = "",
    private readonly window: string = "main"
  ) {}

  /**
   * Send text to a tmux pane (identified by `channel` = pane ID).
   * The payload is sent as-is if a string; otherwise the message type is used.
   */
  async publish(channel: string, message: Omit<Message, "id" | "timestamp">): Promise<void> {
    const text =
      typeof message.payload === "string" ? message.payload : `[SIGNAL] ${message.type}`;
    await sendToPane(channel, text);
  }

  /**
   * Poll a tmux pane for [SIGNAL] lines every 250ms.
   * Each unique signal line triggers the handler exactly once.
   * Returns a function that stops polling.
   */
  async subscribe(channel: string, handler: (msg: Message) => void): Promise<Unsubscribe> {
    const seen = new Set<string>();
    let active = true;

    // Fire-and-forget polling loop — runs until unsubscribed
    void (async () => {
      while (active) {
        const { out, ok } = tmux("capture-pane", "-t", channel, "-p", "-S", "-500");
        if (ok) {
          for (const line of out.split("\n")) {
            const m = line.match(SIGNAL_RE);
            if (m) {
              const key = line.trim();
              if (!seen.has(key)) {
                seen.add(key);
                handler({
                  id: crypto.randomUUID(),
                  channel,
                  from: channel,
                  type: m[1],
                  payload: null,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }
        await sleepMs(250);
      }
    })();

    const unsubscribe: Unsubscribe = () => {
      active = false;
      this.activeUnsubs.delete(unsubscribe);
    };
    this.activeUnsubs.add(unsubscribe);
    return unsubscribe;
  }

  /** Stop all active subscriptions created by this transport instance. */
  async teardown(): Promise<void> {
    for (const unsub of this.activeUnsubs) {
      unsub();
    }
    this.activeUnsubs.clear();
  }

  /**
   * Returns the signal protocol instructions for an agent using this transport.
   * Agents emit signals by printing `[SIGNAL] SIGNAL_NAME` to stdout, which
   * TmuxTransport picks up via `capture-pane`.
   */
  agentPrompt(agentId: string, channel: string): string {
    const lines = [
      `Agent ID: ${agentId}`,
      `Tmux pane: ${channel}`,
      ...(this.session ? [`Session: ${this.session}  Window: ${this.window}`] : []),
      ``,
      `Emit completion signals by printing to stdout:`,
      `  [SIGNAL] SIGNAL_NAME`,
      ``,
      `Example: [SIGNAL] IMPLEMENT_COMPLETE`,
    ];
    return lines.join("\n");
  }
}
