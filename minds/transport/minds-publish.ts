#!/usr/bin/env bun
// minds-publish.ts — Publish a Minds bus event (BRE-444)
//
// CLI usage:
//   bun minds/transport/minds-publish.ts --channel minds-BRE-444 --type MIND_COMPLETE --payload '{"mindName":"transport"}'
//
// BUS_URL resolution (in priority order):
//   1. BUS_URL env var
//   2. .minds/bus-port file via mindsRoot() (port only → http://localhost:{port})
//
// Programmatic usage:
//   import { mindsPublish } from "./minds-publish.ts";
//   await mindsPublish(busUrl, "minds-BRE-444", "MIND_COMPLETE", { mindName: "transport" });

import { readFileSync } from "fs";
import { join } from "path";
import { mindsRoot } from "../shared/paths.js";

// ---------------------------------------------------------------------------
// BUS_URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the bus server URL from the environment or from `.minds/bus-port`.
 * Returns undefined if neither source is available.
 */
export function resolveBusUrl(cwd?: string): string | undefined {
  if (process.env.BUS_URL) return process.env.BUS_URL;

  const portFile = cwd ? join(cwd, ".minds", "bus-port") : join(mindsRoot(), "bus-port");
  try {
    const port = readFileSync(portFile, "utf8").trim();
    if (port && /^\d+$/.test(port)) return `http://localhost:${port}`;
  } catch {
    // File not found or unreadable — fall through
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Programmatic publish API
// ---------------------------------------------------------------------------

/**
 * Publish a Minds event to the bus server.
 *
 * @param busUrl  - URL of the running bus server (e.g. "http://localhost:7777")
 * @param channel - Minds channel (e.g. "minds-BRE-444")
 * @param type    - Event type string (e.g. "MIND_COMPLETE")
 * @param payload - Arbitrary event payload
 */
export async function mindsPublish(
  busUrl: string,
  channel: string,
  type: string,
  payload: unknown = null,
): Promise<void> {
  const body = JSON.stringify({ channel, from: "minds", type, payload });

  let res: Response;
  try {
    res = await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    throw new Error(`mindsPublish failed: cannot reach ${busUrl}/publish — ${err}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `mindsPublish failed: POST ${busUrl}/publish returned ${res.status} — ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  }

  const channel = getArg("--channel");
  const type = getArg("--type");
  const payloadRaw = getArg("--payload");

  if (!channel || !type) {
    console.error(
      JSON.stringify({
        error: "Usage: minds-publish.ts --channel <minds-{ticketId}> --type <event> [--payload <json>]",
      }),
    );
    process.exit(1);
  }

  let payload: unknown = null;
  if (payloadRaw !== undefined) {
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      console.error(JSON.stringify({ error: `Invalid JSON for --payload: ${payloadRaw}` }));
      process.exit(1);
    }
  }

  const busUrl = resolveBusUrl();
  if (!busUrl) {
    console.error(
      JSON.stringify({
        error:
          "Cannot resolve bus URL: set BUS_URL env var or ensure .minds/bus-port exists",
      }),
    );
    process.exit(1);
  }

  try {
    await mindsPublish(busUrl, channel, type, payload);
    console.log(JSON.stringify({ ok: true, channel, type }));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}
