/**
 * tests/unit/orchestrator-init-idempotency.test.ts
 *
 * Guard test: ensures orchestrator-init.ts has an idempotency check that
 * prevents creating duplicate agent panes when called twice for the same ticket.
 *
 * Background: The orchestrator (collab.run) calls orchestrator-init.ts per ticket.
 * If stdout isn't captured (e.g., bus transport noise), the orchestrator may retry.
 * Without an idempotency guard, the retry creates a ghost pane that sits idle,
 * wasting resources and confusing the pipeline layout.
 *
 * The guard checks for an existing registry file before running initPipeline().
 * If found, it reuses the existing pane ID and exits early.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const INIT_PATH = resolve(
  PROJECT_ROOT,
  "minds/execution/orchestrator-init.ts"
);

describe("orchestrator-init idempotency guard", () => {
  test("checks for existing registry before creating new pane", () => {
    const source = readFileSync(INIT_PATH, "utf-8");

    // Must check if registry file already exists for the ticket
    expect(source).toContain("existsSync(existingRegistry)");

    // Must reuse existing agent_pane_id when registry exists
    expect(source).toContain("existing.agent_pane_id");
    expect(source).toContain("existing.nonce");

    // Must output AGENT_PANE= for the orchestrator to capture
    expect(source).toContain("AGENT_PANE=${existing.agent_pane_id}");
  });

  test("idempotency check runs before initPipeline", () => {
    const source = readFileSync(INIT_PATH, "utf-8");

    // The idempotency check (existingRegistry) must appear BEFORE initPipeline call
    const idempotencyIdx = source.indexOf("existingRegistry");
    const initPipelineIdx = source.indexOf("await initPipeline(ctx)");

    expect(idempotencyIdx).toBeGreaterThan(-1);
    expect(initPipelineIdx).toBeGreaterThan(-1);
    expect(idempotencyIdx).toBeLessThan(initPipelineIdx);
  });
});
