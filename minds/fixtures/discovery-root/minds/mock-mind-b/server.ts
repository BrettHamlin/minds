/**
 * mock-mind-b — Canonical test fixture Mind.
 * Domain: spec/generate/session. Escalates if request starts with "escalate".
 * Used by both integration.test.ts (direct spawn) and discovery.test.ts (discoverChildren).
 */
import { createMind } from "../../../../server-base.js";

await createMind({
  name: "mock-mind-b",
  domain: "Spec generation and session management for test scenarios",
  keywords: ["spec", "generate", "session", "test-b"],
  owns_files: ["minds/fixtures/discovery-root/minds/mock-mind-b/"],
  capabilities: ["generate test specs", "manage test sessions"],
  async handle(workUnit) {
    if (workUnit.request.startsWith("escalate")) {
      return { status: "escalate" };
    }
    return {
      status: "handled",
      data: { mind: "mock-mind-b", echo: workUnit.request },
    };
  },
});
