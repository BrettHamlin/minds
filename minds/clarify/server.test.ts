/**
 * Unit tests for minds/clarify/server.ts
 */

import { describe, it, expect, afterEach } from "bun:test";
import type { RunningMind } from "../server-base";
import type { Finding } from "../pipeline_core/questions";

// Track minds started during tests for cleanup
const started: RunningMind[] = [];

async function startClarifyMind(): Promise<RunningMind> {
  // Import the default export from server.ts — it returns a Promise<RunningMind>
  const mod = await import("./server");
  const mind = await mod.default;
  started.push(mind);
  return mind;
}

afterEach(async () => {
  for (const mind of started.splice(0)) {
    await mind.shutdown().catch(() => {});
  }
});

// ── describe() ────────────────────────────────────────────────────────────────

describe("Clarify Mind — describe()", () => {
  it("returns MindDescription with name 'clarify'", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.name).toBe("clarify");
  });

  it("owns_files includes src/commands/collab.clarify.md", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.owns_files).toContain("src/commands/collab.clarify.md");
  });

  it("owns_files includes minds/clarify/", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.owns_files).toContain("minds/clarify/");
  });

  it("capabilities includes 'run clarify phase'", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.capabilities).toContain("run clarify phase");
  });

  it("capabilities includes 'group findings'", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.capabilities).toContain("group findings");
  });

  it("capabilities includes 'apply resolutions'", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.capabilities).toContain("apply resolutions");
  });

  it("keywords include 'clarify'", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.keywords).toContain("clarify");
  });

  it("domain mentions clarify phase", async () => {
    const mind = await startClarifyMind();
    const desc = mind.describe();
    expect(desc.domain.toLowerCase()).toContain("clarify");
  });
});

// ── handle() — intent routing ─────────────────────────────────────────────────

describe("Clarify Mind — handle() intent routing", () => {
  it("routes 'run clarify phase' intent and returns handled status", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({ request: "run clarify phase", intent: "run clarify phase" });
    expect(result.status).toBe("handled");
  });

  it("'run clarify phase' result includes protocol field", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({ request: "run clarify phase", intent: "run clarify phase" }) as any;
    expect(result.result?.protocol).toBeDefined();
  });

  it("routes 'group findings' intent with valid findings", async () => {
    const mind = await startClarifyMind();
    const findings: Finding[] = [
      {
        id: "f1",
        question: "What database schema should we use?",
        context: {
          why: "Need to define data model",
          specReferences: [],
          codePatterns: [],
          constraints: [],
          implications: [],
        },
      },
    ];
    const result = await mind.handle({
      request: "group findings",
      intent: "group findings",
      context: { findings },
    }) as any;
    expect(result.status).toBe("handled");
    expect(Array.isArray(result.result?.grouped)).toBe(true);
  });

  it("'group findings' returns error when findings is missing", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({
      request: "group findings",
      intent: "group findings",
      context: {},
    }) as any;
    expect(result.status).toBe("handled");
    expect(result.error).toContain("findings");
  });

  it("'group findings' returns error when findings is not an array", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({
      request: "group findings",
      intent: "group findings",
      context: { findings: "not-an-array" },
    }) as any;
    expect(result.status).toBe("handled");
    expect(result.error).toBeTruthy();
  });

  it("returns escalate for unknown intent", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({
      request: "do something unrecognized",
      intent: "do something unrecognized",
    });
    expect(result.status).toBe("escalate");
  });

  it("returns escalate when no intent is provided and request does not match", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({ request: "completely unrelated request xyz" });
    expect(result.status).toBe("escalate");
  });

  it("'apply resolutions' returns error when featureDir is missing", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({
      request: "apply resolutions",
      intent: "apply resolutions",
      context: { phase: "clarify" },
    }) as any;
    expect(result.status).toBe("handled");
    expect(result.error).toContain("featureDir");
  });

  it("'apply resolutions' returns available:false when no resolutions file exists", async () => {
    const mind = await startClarifyMind();
    const result = await mind.handle({
      request: "apply resolutions",
      intent: "apply resolutions",
      context: {
        featureDir: "/tmp/nonexistent-feature-dir-test",
        phase: "clarify",
        round: 1,
      },
    }) as any;
    expect(result.status).toBe("handled");
    expect(result.result?.available).toBe(false);
  });
});
