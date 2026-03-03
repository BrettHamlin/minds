// Transport resolution entry point (BRE-347)
//
// Three-level priority cascade for selecting the agent communication transport:
//
//   Level 1 — Pipeline directive (highest priority)
//     @debug in the pipeline file → TmuxTransport always
//     Removing @debug is the explicit act of graduating a pipeline to production.
//
//   Level 2 — Auto-detection (no directive)
//     Pings the bus server; uses BusTransport if reachable, falls back otherwise.
//
//   Level 3 — Env var override (emergency / CI use)
//     COLLAB_TRANSPORT=tmux → force TmuxTransport
//     COLLAB_TRANSPORT=bus  → force BusTransport (fails loudly if bus is down)
//
// Summary table:
//   Pipeline has @debug                → TmuxTransport
//   No @debug, bus running             → BusTransport
//   No @debug, bus not running         → TmuxTransport (fallback)
//   COLLAB_TRANSPORT=tmux              → TmuxTransport (forced)
//   COLLAB_TRANSPORT=bus               → BusTransport (forced)

export type { Message, Unsubscribe } from "./Transport.ts";
export type { Transport } from "./Transport.ts";
export { TmuxTransport } from "./TmuxTransport.ts";
export { BusTransport } from "./BusTransport.ts";

import type { Transport } from "./Transport.ts";
import { TmuxTransport } from "./TmuxTransport.ts";
import { BusTransport } from "./BusTransport.ts";

/**
 * Resolve the appropriate Transport implementation for this pipeline run.
 *
 * @param pipelineDirectives - Directives declared at the top of the pipeline file
 *   (e.g. ["@debug", "@codeReview"]). Pass an empty array if none.
 */
export async function resolveTransport(pipelineDirectives: string[]): Promise<Transport> {
  const busUrl = process.env.COLLAB_BUS_URL ?? "http://localhost:7777";

  // Level 3: env var override — checked first so CI can force a transport
  // regardless of pipeline content or bus availability
  const envTransport = process.env.COLLAB_TRANSPORT;
  if (envTransport === "tmux") return new TmuxTransport();
  if (envTransport === "bus") return new BusTransport(busUrl);

  // Level 1: pipeline directive — @debug means "I'm still building this"
  if (pipelineDirectives.includes("@debug")) return new TmuxTransport();

  // Level 2: auto-detect — if the bus is reachable, use it
  try {
    const res = await fetch(`${busUrl}/status`, { signal: AbortSignal.timeout(200) });
    if (res.ok) return new BusTransport(busUrl);
  } catch {
    // bus not running — fall through to tmux fallback
  }

  // Fallback: tmux (always available when running locally)
  return new TmuxTransport();
}
