import { describe, test, expect } from "bun:test";
import { queryContractPatterns } from "./phase-dispatch";
import { buildContractPattern, recordPhaseTransition } from "./phase-advance";
import type { ContractPattern } from "../memory/lib/contract-types.js";
import type { CompiledPipeline } from "../pipeline_core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PIPELINE: CompiledPipeline = {
  version: "3.1",
  phases: {
    clarify: {
      command: "/collab.clarify",
      signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTION"],
      transitions: {},
      conditionalTransitions: [],
    } as any,
    plan: {
      command: "/collab.plan",
      signals: ["PLAN_COMPLETE"],
      transitions: {},
      conditionalTransitions: [],
    } as any,
    tasks: {
      command: "/collab.tasks",
      signals: ["TASKS_COMPLETE"],
      transitions: {},
      conditionalTransitions: [],
    } as any,
    done: {
      terminal: true,
      signals: [],
      transitions: {},
      conditionalTransitions: [],
    } as any,
  },
};

const MOCK_PATTERN: ContractPattern = {
  sourcePhase: "clarify",
  targetPhase: "plan",
  artifactShape: "clarify phase artifacts handed off to plan",
  sections: [{ name: "CLARIFY_COMPLETE", required: true, description: "Signal emitted by clarify phase" }],
  metadata: { domain: "pipeline" },
  timestamp: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// T015 — queryContractPatterns (phase-dispatch integration)
// ---------------------------------------------------------------------------

describe("queryContractPatterns: contract query before dispatch", () => {
  test("1. returns results from searchMemory when patterns exist", async () => {
    const mockSearch = async () => [
      { path: "clarify-plan-123.json", startLine: 1, endLine: 10, content: JSON.stringify(MOCK_PATTERN), score: 0.9 },
    ];
    const results = await queryContractPatterns("clarify", "plan", { searchFn: mockSearch as any });
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("clarify-plan-123.json");
    expect(results[0].score).toBe(0.9);
  });

  test("2. cold start — returns empty array when no patterns exist", async () => {
    const mockSearch = async () => [];
    const results = await queryContractPatterns("clarify", "plan", { searchFn: mockSearch as any });
    expect(results).toEqual([]);
  });

  test("3. passes scope:contracts to searchMemory", async () => {
    let capturedOpts: Record<string, unknown> | undefined;
    const mockSearch = async (_mindName: string, _query: string, opts?: Record<string, unknown>) => {
      capturedOpts = opts;
      return [];
    };
    await queryContractPatterns("plan", "tasks", { searchFn: mockSearch as any });
    expect(capturedOpts?.scope).toBe("contracts");
  });

  test("4. builds query from source and target phase names", async () => {
    let capturedQuery = "";
    const mockSearch = async (_mindName: string, query: string) => {
      capturedQuery = query;
      return [];
    };
    await queryContractPatterns("clarify", "plan", { searchFn: mockSearch as any });
    expect(capturedQuery).toContain("clarify");
    expect(capturedQuery).toContain("plan");
  });

  test("5. never blocks dispatch on search failure — returns empty array", async () => {
    const mockSearch = async () => { throw new Error("search failed"); };
    const results = await queryContractPatterns("clarify", "plan", { searchFn: mockSearch as any });
    expect(results).toEqual([]);
  });

  test("6. passes provider:null to avoid slow embedding in dispatch path", async () => {
    let capturedOpts: Record<string, unknown> | undefined;
    const mockSearch = async (_mindName: string, _query: string, opts?: Record<string, unknown>) => {
      capturedOpts = opts;
      return [];
    };
    await queryContractPatterns("plan", "tasks", { searchFn: mockSearch as any });
    expect(capturedOpts?.provider).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T016 — buildContractPattern + recordPhaseTransition (phase-advance integration)
// ---------------------------------------------------------------------------

describe("buildContractPattern: derives artifact shape from pipeline config", () => {
  test("7. sets sourcePhase and targetPhase correctly", () => {
    const pattern = buildContractPattern("clarify", "plan", PIPELINE);
    expect(pattern.sourcePhase).toBe("clarify");
    expect(pattern.targetPhase).toBe("plan");
  });

  test("8. artifactShape includes source and target phase names", () => {
    const pattern = buildContractPattern("clarify", "plan", PIPELINE);
    expect(pattern.artifactShape).toContain("clarify");
    expect(pattern.artifactShape).toContain("plan");
  });

  test("9. sections derived from source phase signals", () => {
    const pattern = buildContractPattern("clarify", "plan", PIPELINE);
    // clarify has ["CLARIFY_COMPLETE", "CLARIFY_QUESTION"]
    expect(pattern.sections).toHaveLength(2);
    expect(pattern.sections[0].name).toBe("CLARIFY_COMPLETE");
    expect(pattern.sections[1].name).toBe("CLARIFY_QUESTION");
  });

  test("10. sections marked required with descriptive text", () => {
    const pattern = buildContractPattern("plan", "tasks", PIPELINE);
    expect(pattern.sections[0].required).toBe(true);
    expect(pattern.sections[0].description).toContain("plan");
  });

  test("11. sections empty when source phase has no signals", () => {
    const pattern = buildContractPattern("done", "plan", PIPELINE);
    expect(pattern.sections).toHaveLength(0);
  });

  test("12. timestamp is valid ISO 8601", () => {
    const pattern = buildContractPattern("clarify", "plan", PIPELINE);
    expect(() => new Date(pattern.timestamp)).not.toThrow();
    expect(new Date(pattern.timestamp).getFullYear()).toBeGreaterThan(2020);
  });

  test("13. metadata includes domain:pipeline", () => {
    const pattern = buildContractPattern("clarify", "plan", PIPELINE);
    expect(pattern.metadata.domain).toBe("pipeline");
  });
});

describe("recordPhaseTransition: write hook after successful transition", () => {
  test("14. calls writeContractPattern after successful transition", async () => {
    let capturedPattern: ContractPattern | null = null;
    const mockWrite = async (pattern: ContractPattern) => {
      capturedPattern = pattern;
      return "/fake/contracts/clarify-plan-123.json";
    };
    const result = await recordPhaseTransition("clarify", "plan", PIPELINE, { writeFn: mockWrite });
    expect(result).toBe("/fake/contracts/clarify-plan-123.json");
    expect(capturedPattern).not.toBeNull();
    expect(capturedPattern!.sourcePhase).toBe("clarify");
    expect(capturedPattern!.targetPhase).toBe("plan");
  });

  test("15. cold start — no prior patterns but write still succeeds", async () => {
    // Cold start: writeFn creates the dir on first call (contract-store handles provisioning)
    const mockWrite = async () => "/fake/contracts/plan-tasks-456.json";
    const result = await recordPhaseTransition("plan", "tasks", PIPELINE, { writeFn: mockWrite });
    expect(result).toBe("/fake/contracts/plan-tasks-456.json");
  });

  test("16. skips write when targetPhase is 'done' — no downstream consumer", async () => {
    let called = false;
    const mockWrite = async () => { called = true; return "/path.json"; };
    const result = await recordPhaseTransition("blindqa", "done", PIPELINE, { writeFn: mockWrite });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  test("17. never blocks phase advance on write failure — returns null", async () => {
    const mockWrite = async () => { throw new Error("write failed"); };
    const result = await recordPhaseTransition("clarify", "plan", PIPELINE, { writeFn: mockWrite });
    expect(result).toBeNull();
  });

  test("18. passes correct ContractPattern to writeFn", async () => {
    let capturedPattern: ContractPattern | null = null;
    const mockWrite = async (pattern: ContractPattern) => {
      capturedPattern = pattern;
      return "/path.json";
    };
    await recordPhaseTransition("plan", "tasks", PIPELINE, { writeFn: mockWrite });
    expect(capturedPattern!.sections[0].name).toBe("PLAN_COMPLETE");
    expect(capturedPattern!.metadata.domain).toBe("pipeline");
    expect(capturedPattern!.timestamp).toBeTruthy();
  });
});
