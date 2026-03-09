/**
 * Transport Mind — transport interface, implementations, and resolution.
 *
 * Owns: Transport interface, TmuxTransport, BusTransport, bus-server,
 * status aggregation, and resolve-transport (which transport to use).
 *
 * Leaf Mind: no children, no discoverChildren().
 */

import { createMind } from "@minds/server-base.js";
import type { WorkUnit, WorkResult } from "@minds/mind.js";
import { resolveTransportPath } from "./resolve-transport.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "publish message via transport": {
      const { channel, message } = ctx as { channel: string; message: unknown };
      if (!channel || !message) {
        return { status: "handled", error: "Missing context.channel or context.message" };
      }
      const transportPath = resolveTransportPath("BusTransport.ts");
      const { BusTransport } = await import(transportPath);
      const transport = new BusTransport();
      await transport.publish(channel, message);
      return { status: "handled", result: { ok: true } };
    }

    case "resolve transport implementation path": {
      const moduleName = (ctx.moduleName as string | undefined) ?? "BusTransport.ts";
      const resolved = resolveTransportPath(moduleName);
      return { status: "handled", result: { path: resolved } };
    }

    case "get transport status": {
      const busPortPath = (ctx.busPortFile as string | undefined);
      if (!busPortPath) {
        return { status: "handled", result: { transport: "tmux", active: true } };
      }
      const { readFileSync, existsSync } = await import("fs");
      if (!existsSync(busPortPath)) {
        return { status: "handled", result: { transport: "tmux", busActive: false } };
      }
      const port = readFileSync(busPortPath, "utf-8").trim();
      return { status: "handled", result: { transport: "bus", busPort: port, busActive: true } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "transport",
  domain: "Transport interface, TmuxTransport, BusTransport, bus-server, status aggregation, and transport resolution.",
  keywords: ["transport", "tmux", "bus", "publish", "subscribe", "channel", "message", "status", "resolve"],
  owns_files: ["minds/transport/"],
  capabilities: [
    "publish message via transport",
    "resolve transport implementation path",
    "get transport status",
  ],
  exposes: [
    "publish message via transport",
    "resolve transport implementation path",
    "get transport status",
  ],
  consumes: [],
  handle,
});
