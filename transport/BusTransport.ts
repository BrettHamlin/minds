// BusTransport — SSE-based message bus transport (BRE-345).
//
// Publishes messages by POSTing to the bus server's /publish endpoint.
// Subscribes by opening a streaming GET to /subscribe/:channel and
// parsing SSE frames.

import type { Transport, Message, Unsubscribe } from "./Transport.ts";
import { generateAgentPrompt } from "./bus-agent.ts";

export class BusTransport implements Transport {
  // Track active AbortControllers so teardown() can close all SSE streams.
  private readonly subscriptions = new Set<AbortController>();

  constructor(private readonly busUrl: string) {}

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

  async teardown(): Promise<void> {
    for (const ac of this.subscriptions) {
      ac.abort();
    }
    this.subscriptions.clear();
  }

  // ── agentPrompt ────────────────────────────────────────────────────────────

  agentPrompt(agentId: string, channel: string): string {
    return generateAgentPrompt(agentId, this.busUrl, channel);
  }
}
