// Transport resolution entry point (BRE-347)
//
// Priority cascade for selecting the agent communication transport:
//
//   Level 1 — Pipeline directive (highest priority — cannot be overridden)
//     @debug in the pipeline file → TmuxTransport always.
//     Removing @debug is the explicit act of graduating a pipeline to production.
//
//   Level 2 — Env var override (emergency / CI use)
//     COLLAB_TRANSPORT=tmux → force TmuxTransport (when @debug is absent)
//     COLLAB_TRANSPORT=bus  → force BusTransport  (when @debug is absent)
//     Useful in CI environments where editing the pipeline file isn't possible.
//     NOTE: does NOT override @debug — a pipeline marked @debug stays on tmux.
//
//   Level 3 — Auto-detection (no directive, no env var)
//     Pings the bus server; uses BusTransport if reachable, falls back otherwise.
//
//   Level 4 — Fallback
//     TmuxTransport (always available when running locally).
//
// Summary table:
//   Pipeline has @debug                → TmuxTransport  (Level 1, cannot override)
//   @debug + COLLAB_TRANSPORT=bus      → TmuxTransport  (Level 1 wins)
//   No @debug, COLLAB_TRANSPORT=tmux   → TmuxTransport  (Level 2)
//   No @debug, COLLAB_TRANSPORT=bus    → BusTransport   (Level 2)
//   No @debug, no env var, bus running → BusTransport   (Level 3)
//   No @debug, no env var, bus down    → TmuxTransport  (Level 4 fallback)

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

  // Level 1: pipeline directive — @debug means "I'm still building this pipeline"
  // This is the highest-priority signal and cannot be overridden by env vars.
  if (pipelineDirectives.includes("@debug")) return new TmuxTransport();

  // Level 2: env var override — emergency / CI escape hatch when @debug is absent
  const envTransport = process.env.COLLAB_TRANSPORT;
  if (envTransport === "tmux") return new TmuxTransport();
  if (envTransport === "bus") return new BusTransport(busUrl);

  // Level 3: auto-detect — if the bus is reachable, use it
  try {
    const res = await fetch(`${busUrl}/status`, { signal: AbortSignal.timeout(200) });
    if (res.ok) return new BusTransport(busUrl);
  } catch {
    // bus not running — fall through to tmux fallback
  }

  // Level 4: fallback — tmux (always available when running locally)
  return new TmuxTransport();
}
