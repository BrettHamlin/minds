#!/usr/bin/env bun
// wave-event.ts — Publish WAVE_STARTED or WAVE_COMPLETE to the Minds bus
//
// Usage:
//   bun minds/transport/wave-event.ts start --bus-url $BUS_URL --channel minds-{ticketId} --wave-id $WAVE_ID
//   bun minds/transport/wave-event.ts complete --bus-url $BUS_URL --channel minds-{ticketId} --wave-id $WAVE_ID

import { mindsPublish } from "./minds-publish.ts";
import { MindsEventType } from "./minds-events.ts";

export async function publishWaveStarted(busUrl: string, channel: string, waveId: string): Promise<void> {
  await mindsPublish(busUrl, channel, MindsEventType.WAVE_STARTED, { waveId });
}

export async function publishWaveComplete(busUrl: string, channel: string, waveId: string): Promise<void> {
  await mindsPublish(busUrl, channel, MindsEventType.WAVE_COMPLETE, { waveId });
}

if (import.meta.main) {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  }

  const subcommand = args[0];
  const busUrl = getArg("--bus-url");
  const ch = getArg("--channel");
  const waveId = getArg("--wave-id");

  if (!subcommand || !busUrl || !ch || !waveId) {
    console.error(
      JSON.stringify({
        error:
          "Usage: wave-event.ts <start|complete> --bus-url <url> --channel <minds-{ticketId}> --wave-id <id>",
      }),
    );
    process.exit(1);
  }

  try {
    if (subcommand === "start") {
      await publishWaveStarted(busUrl, ch, waveId);
    } else if (subcommand === "complete") {
      await publishWaveComplete(busUrl, ch, waveId);
    } else {
      console.error(JSON.stringify({ error: `Unknown subcommand: ${subcommand}` }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, subcommand, channel: ch, waveId }));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}
