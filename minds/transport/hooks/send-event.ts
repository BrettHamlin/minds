#!/usr/bin/env bun
// send-event.ts — Claude Code hook handler that publishes hook events to the Minds bus (BRE-457)
//
// Reads JSON from stdin (Claude Code hook data), normalizes to MindsHookEvent,
// and publishes via publishMindsEvent(). ALWAYS exits 0 — hook handler failure
// must never block Claude Code.
//
// Usage (in .claude/settings.json hooks):
//   bun minds/transport/hooks/send-event.ts --source-app drone:transport

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { publishMindsEvent } from "../publish-event.ts";
import type { MindsHookEvent } from "../minds-events.ts";

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

/**
 * Resolve bus URL from BUS_URL env var or by scanning .collab/state/minds-bus-*.json files.
 */
function resolveBusUrlFromEnvOrState(): string | undefined {
  if (process.env.BUS_URL) return process.env.BUS_URL;

  // Scan state files for bus URL
  const stateDir = join(process.cwd(), ".collab", "state");
  try {
    const files = readdirSync(stateDir).filter((f) => /^minds-bus-.+\.json$/.test(f));
    if (files.length > 0) {
      const raw = readFileSync(join(stateDir, files[0]), "utf-8");
      const state = JSON.parse(raw);
      if (state.busUrl) return state.busUrl;
    }
  } catch {
    // State dir missing or unreadable
  }

  return undefined;
}

async function main(): Promise<void> {
  const sourceApp = getArg("--source-app") ?? "unknown";
  const channel = process.env.MINDS_CHANNEL;

  // Read stdin
  let stdinData: string;
  try {
    stdinData = readFileSync(0, "utf-8");
  } catch {
    process.exit(0);
    return;
  }

  if (!stdinData.trim()) {
    process.exit(0);
    return;
  }

  // Parse hook JSON
  let hookData: Record<string, unknown>;
  try {
    hookData = JSON.parse(stdinData);
  } catch {
    process.exit(0);
    return;
  }

  // Resolve bus URL
  const busUrl = resolveBusUrlFromEnvOrState();
  if (!busUrl) {
    process.exit(0);
    return;
  }

  // Derive channel — prefer env var, fall back to empty (skip publish)
  if (!channel) {
    process.exit(0);
    return;
  }

  // Normalize to MindsHookEvent
  const hookEvent: MindsHookEvent = {
    source: sourceApp,
    sessionId: String(hookData.session_id ?? ""),
    hookType: String(hookData.hook_event_name ?? "unknown"),
    toolName: hookData.tool_name ? String(hookData.tool_name) : undefined,
    timestamp: Date.now(),
    payload: hookData,
  };

  // Publish — fire-and-forget
  await publishMindsEvent(busUrl, channel, {
    type: `HOOK_${hookEvent.hookType}`,
    source: hookEvent.source,
    ticketId: channel.replace(/^minds-/, ""),
    payload: {
      sessionId: hookEvent.sessionId,
      hookType: hookEvent.hookType,
      toolName: hookEvent.toolName,
      hookPayload: hookEvent.payload,
    },
    timestamp: hookEvent.timestamp,
  });
}

main().catch(() => {}).finally(() => process.exit(0));
