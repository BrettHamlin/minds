// collab-statusline.ts — Statusline reader for Claude Code (BRE-398)
//
// Reads the status cache file written by the StatusDaemon and outputs
// a one-line summary suitable for Claude Code's statusLine polling.
// Stateless: reads file, prints line, exits.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
// TODO(WD): Cross-Mind import — replace with parent escalation when Transport Mind is formalized.
import type { PipelineSnapshot } from "../transport/status-snapshot"; // CROSS-MIND

export interface CachedStatus {
  pipelines: PipelineSnapshot[];
  lastUpdate: string;
  connected: boolean;
}

const STALE_THRESHOLD_MS = 30_000;

/**
 * Format a duration in milliseconds as a human-readable elapsed time string.
 * Examples: "2m", "1h 5m", "45s", "3h 12m"
 */
export function formatElapsed(ms: number): string {
  if (ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function render(cachePath?: string): string {
  const resolvedPath =
    cachePath ||
    join(process.env.MINDS_ROOT || process.cwd(), ".collab/state/status-cache.json");

  if (!existsSync(resolvedPath)) return "collab: no status";

  try {
    const raw = readFileSync(resolvedPath, "utf8");
    const cache: CachedStatus = JSON.parse(raw);

    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age > STALE_THRESHOLD_MS) return "collab: stale";
    if (!cache.connected) return "collab: disconnected";
    if (cache.pipelines.length === 0) return "collab: idle";

    return cache.pipelines
      .map((p) => {
        let line = `${p.ticketId} ${p.phase} ▸ ${p.detail}`;
        if (p.startedAt) {
          const elapsed = Date.now() - new Date(p.startedAt).getTime();
          if (!isNaN(elapsed) && elapsed >= 0) {
            line += ` (${formatElapsed(elapsed)})`;
          }
        }
        return line;
      })
      .join(" | ");
  } catch {
    return "collab: error";
  }
}

if (import.meta.main) {
  console.log(render());
}
