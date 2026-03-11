/**
 * supervisor-bus.ts — Bus signal publishing for the deterministic Mind supervisor.
 */

import { publishMindsEvent } from "../../transport/publish-event.ts";
import { MindsEventType } from "../../transport/minds-events.ts";

// ---------------------------------------------------------------------------
// Bus Signal Publishing
// ---------------------------------------------------------------------------

export async function publishSignalDefault(
  busUrl: string,
  channel: string,
  type: MindsEventType,
  mindName: string,
  waveId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const ticketId = channel.replace(/^minds-/, "");
  await publishMindsEvent(busUrl, channel, {
    type,
    source: "supervisor",
    ticketId,
    payload: { mindName, waveId, ...extra },
  });
}
