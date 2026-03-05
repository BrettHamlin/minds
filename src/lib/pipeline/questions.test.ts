// BRE-406: Unit tests for questions.ts shared library
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import * as os from "os";

import {
  QuestionCollector,
  resolveMode,
  presentInteractive,
  getFindingsPath,
  getResolutionsPath,
  type Finding,
  type Resolution,
} from "./questions";

// ── QuestionCollector ─────────────────────────────────────────────────────────

describe("QuestionCollector: constructor", () => {
  test("initializes with correct phase and ticketId", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    expect(qc.phase).toBe("clarify");
    expect(qc.ticketId).toBe("BRE-406");
  });

  test("isEmpty() is true initially", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    expect(qc.isEmpty()).toBe(true);
  });

  test("getFindings() returns empty array initially", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    expect(qc.getFindings()).toHaveLength(0);
  });
});

describe("QuestionCollector: add()", () => {
  test("returns incremental IDs starting at f1", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    const id1 = qc.add("Question 1?", {
      why: "reason",
      specReferences: [],
      codePatterns: [],
      constraints: [],
      implications: [],
    });
    const id2 = qc.add("Question 2?", {
      why: "reason2",
      specReferences: [],
      codePatterns: [],
      constraints: [],
      implications: [],
    });
    expect(id1).toBe("f1");
    expect(id2).toBe("f2");
  });

  test("isEmpty() is false after adding", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    qc.add("Q?", { why: "", specReferences: [], codePatterns: [], constraints: [], implications: [] });
    expect(qc.isEmpty()).toBe(false);
  });

  test("getFindings() returns all added findings", () => {
    const qc = new QuestionCollector("analyze", "BRE-406", "spec excerpt");
    qc.add("Q1?", { why: "w1", specReferences: ["spec:L1"], codePatterns: ["p1"], constraints: [], implications: ["i1"] });
    qc.add("Q2?", { why: "w2", specReferences: [], codePatterns: [], constraints: ["c2"], implications: [] });
    const findings = qc.getFindings();
    expect(findings).toHaveLength(2);
    expect(findings[0].id).toBe("f1");
    expect(findings[0].question).toBe("Q1?");
    expect(findings[1].id).toBe("f2");
  });

  test("getFindings() returns a copy (mutation-safe)", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    qc.add("Q?", { why: "", specReferences: [], codePatterns: [], constraints: [], implications: [] });
    const f1 = qc.getFindings();
    const f2 = qc.getFindings();
    expect(f1).not.toBe(f2); // different array references
    expect(f1).toEqual(f2); // same content
  });
});

describe("QuestionCollector: toBatch()", () => {
  test("produces correct FindingsBatch structure", () => {
    const qc = new QuestionCollector("analyze", "BRE-406", "spec text");
    qc.add("Q?", { why: "w", specReferences: [], codePatterns: [], constraints: [], implications: [] });
    const batch = qc.toBatch(1);
    expect(batch.phase).toBe("analyze");
    expect(batch.round).toBe(1);
    expect(batch.ticketId).toBe("BRE-406");
    expect(batch.findings).toHaveLength(1);
    expect(batch.specExcerpt).toBe("spec text");
  });

  test("toBatch(2) sets round=2", () => {
    const qc = new QuestionCollector("clarify", "BRE-406");
    qc.add("Q?", { why: "", specReferences: [], codePatterns: [], constraints: [], implications: [] });
    const batch = qc.toBatch(2);
    expect(batch.round).toBe(2);
  });
});

// ── resolveMode() ─────────────────────────────────────────────────────────────

describe("resolveMode: forceMode override", () => {
  test("returns 'interactive' when forceMode='interactive'", () => {
    expect(resolveMode({ forceMode: "interactive" })).toBe("interactive");
  });

  test("returns 'non-interactive' when forceMode='non-interactive'", () => {
    expect(resolveMode({ forceMode: "non-interactive" })).toBe("non-interactive");
  });
});

describe("resolveMode: missing pipeline.json", () => {
  test("returns 'interactive' (safe default) when config file not found", () => {
    expect(resolveMode({ pipelineConfigPath: "/nonexistent/pipeline.json" })).toBe("interactive");
  });
});

describe("resolveMode: global directive", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `bre406-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "pipeline.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns 'interactive' when interactive.enabled=true", () => {
    writeFileSync(configPath, JSON.stringify({ interactive: { enabled: true } }));
    expect(resolveMode({ pipelineConfigPath: configPath })).toBe("interactive");
  });

  test("returns 'non-interactive' when interactive.enabled=false", () => {
    writeFileSync(configPath, JSON.stringify({ interactive: { enabled: false } }));
    expect(resolveMode({ pipelineConfigPath: configPath })).toBe("non-interactive");
  });

  test("returns 'interactive' (default) when interactive absent", () => {
    writeFileSync(configPath, JSON.stringify({ codeReview: { enabled: true } }));
    expect(resolveMode({ pipelineConfigPath: configPath })).toBe("interactive");
  });
});

describe("resolveMode: per-phase override", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `bre406-phase-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "pipeline.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("per-phase off overrides global on", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        interactive: { enabled: true },
        phases: { clarify: { interactive: { enabled: false } } },
      }),
    );
    expect(resolveMode({ pipelineConfigPath: configPath, phase: "clarify" })).toBe("non-interactive");
  });

  test("per-phase on overrides global off", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        interactive: { enabled: false },
        phases: { clarify: { interactive: { enabled: true } } },
      }),
    );
    expect(resolveMode({ pipelineConfigPath: configPath, phase: "clarify" })).toBe("interactive");
  });

  test("inherits global when phase has no override", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        interactive: { enabled: false },
        phases: { clarify: {} },
      }),
    );
    expect(resolveMode({ pipelineConfigPath: configPath, phase: "clarify" })).toBe("non-interactive");
  });

  test("inherits global when phase not in config at all", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        interactive: { enabled: false },
        phases: {},
      }),
    );
    expect(resolveMode({ pipelineConfigPath: configPath, phase: "clarify" })).toBe("non-interactive");
  });
});

// ── presentInteractive() ──────────────────────────────────────────────────────

describe("presentInteractive()", () => {
  const finding: Finding = {
    id: "f1",
    question: "What auth strategy should this API use?",
    context: {
      why: "Implementation cannot start without knowing the auth approach",
      specReferences: ["spec.md:AC3", "spec.md:L45"],
      codePatterns: ["src/middleware/auth.ts uses JWT"],
      constraints: ["Must be stateless"],
      implications: ["T-3 depends on this decision"],
    },
  };

  test("returns question from finding", () => {
    const result = presentInteractive(finding);
    expect(result.question).toBe(finding.question);
  });

  test("returns header with finding ID", () => {
    const result = presentInteractive(finding);
    expect(result.header).toContain("f1");
  });

  test("contextSummary includes why", () => {
    const result = presentInteractive(finding);
    expect(result.contextSummary).toContain("Implementation cannot start");
  });

  test("contextSummary includes spec references", () => {
    const result = presentInteractive(finding);
    expect(result.contextSummary).toContain("spec.md:AC3");
  });

  test("contextSummary includes constraints", () => {
    const result = presentInteractive(finding);
    expect(result.contextSummary).toContain("Must be stateless");
  });

  test("contextSummary includes implications", () => {
    const result = presentInteractive(finding);
    expect(result.contextSummary).toContain("T-3 depends");
  });
});

describe("presentInteractive(): empty context fields", () => {
  const finding: Finding = {
    id: "f2",
    question: "Simple question?",
    context: {
      why: "Just because",
      specReferences: [],
      codePatterns: [],
      constraints: [],
      implications: [],
    },
  };

  test("does not include empty sections", () => {
    const result = presentInteractive(finding);
    expect(result.contextSummary).not.toContain("Spec references:");
    expect(result.contextSummary).not.toContain("Constraints:");
    expect(result.contextSummary).not.toContain("Implications:");
  });
});

// ── File path helpers ─────────────────────────────────────────────────────────

describe("getFindingsPath()", () => {
  test("constructs correct path", () => {
    const p = getFindingsPath("/tmp/myfeature", "clarify", 1);
    expect(p).toBe("/tmp/myfeature/findings/clarify-round-1.json");
  });

  test("constructs round-2 path", () => {
    const p = getFindingsPath("/tmp/myfeature", "analyze", 2);
    expect(p).toBe("/tmp/myfeature/findings/analyze-round-2.json");
  });
});

describe("getResolutionsPath()", () => {
  test("constructs correct path", () => {
    const p = getResolutionsPath("/tmp/myfeature", "clarify", 1);
    expect(p).toBe("/tmp/myfeature/resolutions/clarify-round-1.json");
  });
});
