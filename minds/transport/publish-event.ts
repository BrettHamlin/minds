// publish-event.ts — Universal Minds event publisher (BRE-457)
//
// Wraps mindsPublish() with a normalized event shape. Fire-and-forget:
// publishMindsEvent() NEVER throws — bus failures are silently swallowed.

import { mindsPublish } from "./minds-publish.ts";

export interface MindsEvent {
  type: string;
  source: string;
  ticketId: string;
  payload: Record<string, unknown>;
  timestamp?: number;
}

/**
 * Publish a normalized Minds event to the bus. Fire-and-forget — never throws.
 */
export async function publishMindsEvent(
  busUrl: string,
  channel: string,
  event: MindsEvent,
): Promise<void> {
  await mindsPublish(busUrl, channel, event.type, {
    ...event.payload,
    source: event.source,
    ticketId: event.ticketId,
    timestamp: event.timestamp ?? Date.now(),
  }).catch(() => {});
}
