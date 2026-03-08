/**
 * Dashboard Mind — Minds Live Dashboard: React SPA visualization, state
 * aggregation from bus events, and aggregator route extensions.
 *
 * Owns: minds/dashboard/
 *
 * State is in-memory, built from MindsEventType bus events. Routes are added
 * to the existing aggregator (status-aggregator.ts) — not a separate server.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";
import { MindsEventType, type MindsBusMessage } from "../transport/minds-events.js";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface Drone {
  mindName: string;
  status: "pending" | "active" | "reviewing" | "merging" | "complete" | "failed";
  paneId?: string;
  worktree?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Wave {
  id: string;
  status: "active" | "complete" | "pending";
  drones: Drone[];
  startedAt?: string;
  completedAt?: string;
}

export interface Contract {
  producer: string;
  consumer: string;
  interface: string;
  status: "pending" | "fulfilled";
}

export interface MindsState {
  ticketId: string;
  waves: Wave[];
  contracts: Contract[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  switch (workUnit.intent) {
    case "build minds state from event": {
      // Stub — actual implementation in BRE-445
      const message = workUnit.context as MindsBusMessage | undefined;
      if (!message) {
        return { status: "handled", error: "Missing context: MindsBusMessage" };
      }
      // Validate event type is known
      const knownTypes = Object.values(MindsEventType) as string[];
      if (!knownTypes.includes(message.type)) {
        return { status: "handled", error: `Unknown MindsEventType: ${message.type}` };
      }
      return { status: "handled", result: { applied: message.type, ticketId: message.ticketId } };
    }

    case "get minds state": {
      // Stub — returns empty state; actual implementation in BRE-445
      const ctx = (workUnit.context ?? {}) as Record<string, unknown>;
      const ticketId = ctx.ticketId as string | undefined;
      if (!ticketId) {
        return { status: "handled", error: "Missing context.ticketId" };
      }
      const state: MindsState = {
        ticketId,
        waves: [],
        contracts: [],
        updatedAt: new Date().toISOString(),
      };
      return { status: "handled", result: state };
    }

    case "serve dashboard": {
      // Stub — routes added to aggregator in BRE-445
      return { status: "handled", result: { message: "Dashboard routes registered (stub)" } };
    }

    default:
      return { status: "escalate" };
  }
}

// ---------------------------------------------------------------------------
// Mind registration
// ---------------------------------------------------------------------------

export default createMind({
  name: "dashboard",
  domain: "Minds Live Dashboard: React SPA visualization, state aggregation from bus events, and aggregator route extensions for Minds-specific data.",
  keywords: ["dashboard", "minds", "state", "wave", "drone", "contract", "sse", "react", "visualization"],
  owns_files: ["minds/dashboard/"],
  capabilities: [
    "build minds state from event",
    "get minds state",
    "serve dashboard",
  ],
  exposes: [
    "MindsState types",
    "MindsStateBuilder",
  ],
  consumes: [
    "transport/MindsEventType",
    "transport/MindsBusMessage",
  ],
  handle,
});
