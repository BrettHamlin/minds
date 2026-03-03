// BusTransport — placeholder for the SSE-based message bus (BRE-345).
//
// This stub satisfies the Transport interface so resolveTransport() compiles
// and the bus code path is exercised at import time. Full implementation
// is delivered in BRE-345.

import type { Transport, Message, Unsubscribe } from "./Transport.ts";

export class BusTransport implements Transport {
  constructor(private readonly busUrl: string) {}

  // BRE-345: POST message to bus server
  async publish(
    _channel: string,
    _message: Omit<Message, "id" | "timestamp">
  ): Promise<void> {}

  // BRE-345: Subscribe to SSE stream from bus server
  async subscribe(
    _channel: string,
    _handler: (msg: Message) => void
  ): Promise<Unsubscribe> {
    return () => {};
  }

  // BRE-345: Close all SSE connections
  async teardown(): Promise<void> {}

  // BRE-346: Bus-aware agent prompt injection
  agentPrompt(_agentId: string, channel: string): string {
    return `POST to ${this.busUrl}/publish with channel: ${channel}`;
  }
}
