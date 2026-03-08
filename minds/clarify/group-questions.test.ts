/**
 * Unit tests for minds/clarify/group-questions.ts
 */

import { describe, it, expect } from "bun:test";
import { groupFindings } from "./group-questions";
import type { GroupedFindings } from "./group-questions";
import type { Finding } from "../pipeline_core/questions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFinding(id: string, question: string, overrides: Partial<Finding["context"]> = {}): Finding {
  return {
    id,
    question,
    context: {
      why: overrides.why ?? "",
      specReferences: overrides.specReferences ?? [],
      codePatterns: overrides.codePatterns ?? [],
      constraints: overrides.constraints ?? [],
      implications: overrides.implications ?? [],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("groupFindings()", () => {
  it("returns empty array for empty input", () => {
    expect(groupFindings([])).toEqual([]);
  });

  it("groups a single finding into one group", () => {
    const finding = makeFinding("f1", "What is the primary key strategy?", {
      why: "Need to determine schema design",
      specReferences: [],
    });
    const groups = groupFindings([finding]);
    expect(groups).toHaveLength(1);
    expect(groups[0].findings).toContain(finding);
  });

  it("groups findings with database keywords under Data Model", () => {
    const f1 = makeFinding("f1", "Which database schema should we use?", {
      why: "Need to define the data model",
    });
    const f2 = makeFinding("f2", "What fields should the table have?", {
      why: "Column definitions needed",
    });
    const groups = groupFindings([f1, f2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].topic).toBe("Data Model");
    expect(groups[0].findings).toHaveLength(2);
  });

  it("groups findings with api keywords under Integration", () => {
    const f1 = makeFinding("f1", "What API contract should the endpoint follow?", {
      why: "Integration with upstream service",
    });
    const groups = groupFindings([f1]);
    expect(groups[0].topic).toBe("Integration");
  });

  it("groups unrecognized findings under Uncategorized", () => {
    const f1 = makeFinding("f1", "Which color should the button be?");
    const groups = groupFindings([f1]);
    expect(groups[0].topic).toBe("Uncategorized");
  });

  it("preserves original order within each group", () => {
    const f1 = makeFinding("f1", "What schema should we use?");
    const f2 = makeFinding("f2", "What table relationships are needed?", {
      why: "database relationships",
    });
    const f3 = makeFinding("f3", "What columns does the model need?", {
      why: "data model field definitions",
    });
    const groups = groupFindings([f1, f2, f3]);
    // All three should land in Data Model due to keywords
    const dataModelGroup = groups.find((g) => g.topic === "Data Model");
    expect(dataModelGroup).toBeDefined();
    expect(dataModelGroup!.findings[0].id).toBe("f1");
    expect(dataModelGroup!.findings[1].id).toBe("f2");
    expect(dataModelGroup!.findings[2].id).toBe("f3");
  });

  it("produces separate groups for different topics", () => {
    const f1 = makeFinding("f1", "What database schema should we use?");
    const f2 = makeFinding("f2", "What API endpoint format is required?", {
      why: "integration with external service",
    });
    const groups = groupFindings([f1, f2]);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const topics = groups.map((g) => g.topic);
    expect(topics).toContain("Data Model");
    expect(topics).toContain("Integration");
  });

  it("group order follows first occurrence in input", () => {
    const f1 = makeFinding("f1", "What API contract is needed?", {
      why: "integration with upstream",
    });
    const f2 = makeFinding("f2", "What database schema should we use?", {
      why: "data model definitions",
    });
    const groups = groupFindings([f1, f2]);
    expect(groups[0].topic).toBe("Integration");
    expect(groups[1].topic).toBe("Data Model");
  });

  it("extracts topic from Markdown section header in specReferences", () => {
    const f1 = makeFinding("f1", "What should happen here?", {
      specReferences: ["## Authentication Flow"],
    });
    const groups = groupFindings([f1]);
    expect(groups[0].topic).toBe("Authentication Flow");
  });

  it("extracts topic from Section: pattern in specReferences", () => {
    const f1 = makeFinding("f1", "What should happen here?", {
      specReferences: ["Section: User Roles"],
    });
    const groups = groupFindings([f1]);
    expect(groups[0].topic).toBe("User Roles");
  });

  it("returns GroupedFindings with correct shape", () => {
    const f1 = makeFinding("f1", "What performance targets are required?", {
      why: "latency requirements",
    });
    const groups = groupFindings([f1]);
    const group = groups[0] as GroupedFindings;
    expect(typeof group.topic).toBe("string");
    expect(Array.isArray(group.findings)).toBe(true);
  });

  it("matches performance/latency keywords to Non-Functional", () => {
    const f1 = makeFinding("f1", "What latency SLA is acceptable?", {
      why: "performance requirements",
    });
    const groups = groupFindings([f1]);
    expect(groups[0].topic).toBe("Non-Functional");
  });

  it("matches scope/feature keywords to Functional Scope", () => {
    const f1 = makeFinding("f1", "Is this feature in scope?", {
      why: "clarify feature boundaries",
    });
    const groups = groupFindings([f1]);
    expect(groups[0].topic).toBe("Functional Scope");
  });
});
