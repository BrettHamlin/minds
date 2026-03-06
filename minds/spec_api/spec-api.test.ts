/**
 * L2-4: Protocol Validation Tests for SpecAPI + SpecEngine Mind pair.
 *
 * Tests:
 * 1. SpecEngine receives in-domain work unit → returns { status: "handled" }
 * 2. SpecEngine receives out-of-domain work unit → returns { status: "escalate" }
 * 3. SpecAPI delegates to child → passes work unit through and returns "handled"
 * 4. describe() accuracy for both Minds
 *
 * Uses real MCP transport via createMind() (the protocol factory). Service
 * implementations are stubbed so no DB/LLM/API keys are required.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { createMind, type RunningMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

// ---------------------------------------------------------------------------
// Build a stub SpecEngine Mind (real protocol, stubbed handlers)
// ---------------------------------------------------------------------------

const SPEC_ENGINE_DOMAIN_KEYWORDS = [
  "spec", "session", "question", "answer", "blind qa", "blindqa",
  "role", "channel", "llm", "generate", "analyze", "submit",
];

function isSpecEngineDomain(request: string): boolean {
  const lower = request.toLowerCase();
  return SPEC_ENGINE_DOMAIN_KEYWORDS.some(kw => lower.includes(kw));
}

const stubSpecEngine: RunningMind = await createMind({
  name: "spec_engine",
  domain: "Spec generation core: LLM calls, session state machine, Q&A, database persistence",
  keywords: ["spec", "generate", "session", "question", "answer", "llm", "drizzle", "database",
             "blindqa", "role", "channel", "slack", "validation", "markdown"],
  owns_files: ["minds/spec_engine/"],
  capabilities: [
    "create spec",
    "generate questions",
    "record answers",
    "manage sessions",
    "blind QA",
    "LLM inference",
    "database persistence",
  ],
  async handle(workUnit: WorkUnit): Promise<WorkResult> {
    if (isSpecEngineDomain(workUnit.request)) {
      // Simulate successful domain handling
      return { status: "handled", data: { stubbed: true, request: workUnit.request } };
    }
    return { status: "escalate" };
  },
});

// ---------------------------------------------------------------------------
// Build a stub SpecAPI Mind (parent) that delegates to stub SpecEngine
// ---------------------------------------------------------------------------

const stubSpecApi: RunningMind = await createMind({
  name: "spec_api",
  domain: "HTTP REST API gateway for spec creation workflows. Delegates business logic to SpecEngine child.",
  keywords: ["http", "api", "rest", "endpoint", "request", "response", "spec", "specfactory"],
  owns_files: ["minds/spec_api/"],
  capabilities: [
    "serve HTTP REST endpoints",
    "route requests to SpecEngine",
    "validate HTTP inputs",
    "format HTTP responses",
  ],
  async handle(workUnit: WorkUnit): Promise<WorkResult> {
    // SpecAPI delegates all work to its SpecEngine child
    const result = await stubSpecEngine.handle(workUnit);
    // If child escalates, SpecAPI handles it (root gateway — never re-escalates spec domain)
    if (result.status === "escalate" && isSpecEngineDomain(workUnit.request)) {
      return { status: "handled", error: "SpecEngine escalated unexpectedly" };
    }
    return result;
  },
});

afterAll(async () => {
  await stubSpecEngine.shutdown();
  await stubSpecApi.shutdown();
});

// ---------------------------------------------------------------------------
// Test 1: SpecEngine handles in-domain work units
// ---------------------------------------------------------------------------

describe("SpecEngine — in-domain routing", () => {
  test("handles 'create a spec for X' → returns handled", async () => {
    const result = await stubSpecEngine.handle({
      request: "create a spec for a payment gateway",
      context: { title: "Payment Gateway", description: "...", pmUserId: "u-1" },
    });

    expect(result.status).toBe("handled");
    expect(result.data).toBeTruthy();
  });

  test("handles 'get session state' → returns handled", async () => {
    const result = await stubSpecEngine.handle({
      request: "get session state for user",
      context: { pmUserId: "u-2" },
    });

    // "session" is in domain keywords
    expect(result.status).toBe("handled");
  });

  test("handles 'start blind qa' → returns handled", async () => {
    const result = await stubSpecEngine.handle({
      request: "start blind qa for spec",
      context: { specId: "s-1" },
    });

    expect(result.status).toBe("handled");
  });

  test("handles 'generate questions' → returns handled", async () => {
    const result = await stubSpecEngine.handle({
      request: "generate questions for spec",
      context: { specId: "s-1" },
    });

    expect(result.status).toBe("handled");
  });
});

// ---------------------------------------------------------------------------
// Test 2: SpecEngine escalates out-of-domain requests
// ---------------------------------------------------------------------------

describe("SpecEngine — escalation for out-of-domain requests", () => {
  test("escalates 'deploy to production'", async () => {
    const result = await stubSpecEngine.handle({
      request: "deploy to production",
    });

    expect(result.status).toBe("escalate");
  });

  test("escalates 'advance pipeline phase'", async () => {
    const result = await stubSpecEngine.handle({
      request: "advance pipeline phase to plan_review",
    });

    expect(result.status).toBe("escalate");
  });

  test("escalates unrecognized domain request", async () => {
    const result = await stubSpecEngine.handle({
      request: "run the CI build pipeline and deploy artifacts",
    });

    expect(result.status).toBe("escalate");
  });
});

// ---------------------------------------------------------------------------
// Test 3: SpecAPI delegates to SpecEngine child
// ---------------------------------------------------------------------------

describe("SpecAPI — delegation to SpecEngine", () => {
  test("SpecAPI delegates 'create a spec' to SpecEngine → returns handled", async () => {
    const result = await stubSpecApi.handle({
      request: "create a spec for a user auth feature",
      context: { title: "Auth", description: "User authentication", pmUserId: "u-1" },
    });

    expect(result.status).toBe("handled");
  });

  test("SpecAPI delegates 'get active session' to SpecEngine → returns handled", async () => {
    const result = await stubSpecApi.handle({
      request: "get active session for user",
      context: { pmUserId: "u-3" },
    });

    expect(result.status).toBe("handled");
  });

  test("SpecAPI propagates escalate from SpecEngine for out-of-domain request", async () => {
    const result = await stubSpecApi.handle({
      request: "deploy to production servers",
    });

    // SpecAPI passes through the escalate from SpecEngine for non-spec requests
    expect(result.status).toBe("escalate");
  });
});

// ---------------------------------------------------------------------------
// Test 4: describe() accuracy
// ---------------------------------------------------------------------------

describe("describe() accuracy", () => {
  test("SpecEngine describe() returns correct name and domain", () => {
    const desc = stubSpecEngine.describe();

    expect(desc.name).toBe("spec_engine");
    expect(desc.domain).toContain("Spec generation");
    expect(desc.keywords).toContain("spec");
    expect(desc.keywords).toContain("session");
    expect(desc.keywords).toContain("question");
    expect(desc.owns_files).toContain("minds/spec_engine/");
    expect(desc.capabilities).toContain("create spec");
    expect(desc.capabilities).toContain("manage sessions");
  });

  test("SpecAPI describe() returns correct name and domain", () => {
    const desc = stubSpecApi.describe();

    expect(desc.name).toBe("spec_api");
    expect(desc.domain).toContain("HTTP");
    expect(desc.keywords).toContain("api");
    expect(desc.keywords).toContain("rest");
    expect(desc.owns_files).toContain("minds/spec_api/");
    expect(desc.capabilities).toContain("serve HTTP REST endpoints");
  });

  test("both describe() results have all required fields", () => {
    for (const mind of [stubSpecEngine, stubSpecApi]) {
      const desc = mind.describe();
      expect(typeof desc.name).toBe("string");
      expect(typeof desc.domain).toBe("string");
      expect(Array.isArray(desc.keywords)).toBe(true);
      expect(Array.isArray(desc.owns_files)).toBe(true);
      expect(Array.isArray(desc.capabilities)).toBe(true);
      expect(desc.keywords.length).toBeGreaterThan(0);
      expect(desc.capabilities.length).toBeGreaterThan(0);
    }
  });
});
