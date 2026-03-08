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
import { MindsStateTracker } from "./state-tracker.js";
import { createMindsRouteHandler } from "./route-handler.js";

// Re-export extended types from state-tracker
export type {
  Drone,
  Wave,
  Contract,
  MindsState,
} from "./state-tracker.js";

// Module-level tracker instance
export const tracker = new MindsStateTracker();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  switch (workUnit.intent) {
    case "build minds state from event": {
      const message = workUnit.context as MindsBusMessage | undefined;
      if (!message) {
        return { status: "handled", error: "Missing context: MindsBusMessage" };
      }
      const knownTypes = Object.values(MindsEventType) as string[];
      if (!knownTypes.includes(message.type)) {
        return { status: "handled", error: `Unknown MindsEventType: ${message.type}` };
      }
      tracker.applyEvent(message);
      return { status: "handled", result: { applied: message.type, ticketId: message.ticketId } };
    }

    case "get minds state": {
      const ctx = (workUnit.context ?? {}) as Record<string, unknown>;
      const ticketId = ctx.ticketId as string | undefined;
      if (ticketId) {
        const state = tracker.getState(ticketId);
        if (!state) {
          return { status: "handled", error: `No state for ticket: ${ticketId}` };
        }
        return { status: "handled", result: state };
      }
      return { status: "handled", result: tracker.getAllActive() };
    }

    case "serve dashboard": {
      const routeHandler = createMindsRouteHandler(tracker);
      return { status: "handled", result: { routeHandler, message: "Dashboard route handler created" } };
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
