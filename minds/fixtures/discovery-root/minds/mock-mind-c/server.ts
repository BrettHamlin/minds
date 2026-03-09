/**
 * mock-mind-c — Canonical test fixture for deep escalation scenarios.
 * Handles requests containing "deep", escalates everything else.
 * Used by integration.test.ts (direct spawn).
 */
import { createMind } from "../../../../server-base.js";

await createMind({
  name: "mock-mind-c",
  domain: "Deep escalation test fixture for protocol integration",
  keywords: ["deep", "escalation", "test-c", "level"],
  owns_files: ["minds/fixtures/discovery-root/minds/mock-mind-c/"],
  capabilities: ["handle deep level requests", "escalate non-deep requests"],
  async handle(workUnit) {
    if (workUnit.request.includes("deep")) {
      return {
        status: "handled",
        data: { mind: "mock-mind-c", echo: workUnit.request },
      };
    }
    return { status: "escalate" };
  },
});
