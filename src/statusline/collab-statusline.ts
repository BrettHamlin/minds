// collab-statusline.ts — Statusline reader for Claude Code (BRE-398)
//
// Reads the status cache file written by the StatusDaemon and outputs
// a one-line summary suitable for Claude Code's statusLine polling.
// Stateless: reads file, prints line, exits.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PipelineSnapshot } from "../../transport/status-snapshot";

export interface CachedStatus {
  pipelines: PipelineSnapshot[];
  lastUpdate: string;
  connected: boolean;
}

const STALE_THRESHOLD_MS = 30_000;

export function render(cachePath?: string): string {
  const resolvedPath =
    cachePath ||
    join(process.env.COLLAB_ROOT || process.cwd(), ".collab/state/status-cache.json");

  if (!existsSync(resolvedPath)) return "collab: no status";

  try {
    const raw = readFileSync(resolvedPath, "utf8");
    const cache: CachedStatus = JSON.parse(raw);

    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age > STALE_THRESHOLD_MS) return "collab: stale";
    if (!cache.connected) return "collab: disconnected";
    if (cache.pipelines.length === 0) return "collab: idle";

    return cache.pipelines
      .map((p) => `${p.ticketId} ${p.phase} ▸ ${p.detail}`)
      .join(" | ");
  } catch {
    return "collab: error";
  }
}

if (import.meta.main) {
  console.log(render());
}
