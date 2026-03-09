/**
 * mock-mind-a — Canonical test fixture Mind.
 * Domain: signal/emit/event. Escalates if request starts with "escalate".
 * Used by both integration.test.ts (direct spawn) and discovery.test.ts (discoverChildren).
 */
import { createMind } from "../../../../server-base.js";

await createMind({
  name: "mock-mind-a",
  domain: "Signal emission and event routing for test scenarios",
  keywords: ["signal", "emit", "event", "test-a"],
  owns_files: ["minds/fixtures/discovery-root/minds/mock-mind-a/"],
  capabilities: ["emit test signals", "route test events"],
  async handle(workUnit) {
    if (workUnit.request.startsWith("escalate")) {
      return { status: "escalate" };
    }
    return {
      status: "handled",
      data: { mind: "mock-mind-a", echo: workUnit.request },
    };
  },
});
