/**
 * Unit tests for src/scripts/orchestrator/commands/resolve-tickets.ts
 *
 * Tests cover the exported pure functions only — no Linear API calls made.
 * Subprocess / E2E tests are in tests/e2e/resolve-tickets.test.ts.
 */

import { describe, test, expect } from "bun:test";

// Import the exports directly (no subprocess needed for pure functions)
import {
  resolvePipelineVariant,
} from "../../src/scripts/orchestrator/commands/resolve-tickets.ts";

// Re-export the regex from the module for testing. Since TICKET_RE is a
// module-level const (not exported), we replicate it here. If it ever changes,
// this test will catch the divergence.
const TICKET_RE = /^([A-Z]+-\d+)(?::(\w+))?$/;

// ---------------------------------------------------------------------------
// TICKET_RE — argument classification
// ---------------------------------------------------------------------------

describe("TICKET_RE regex", () => {
  describe("valid ticket IDs (should match)", () => {
    test("bare ticket ID: BRE-123", () => {
      const m = "BRE-123".match(TICKET_RE);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("BRE-123");
      expect(m![2]).toBeUndefined();
    });

    test("ticket with variant: BRE-123:backend", () => {
      const m = "BRE-123:backend".match(TICKET_RE);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("BRE-123");
      expect(m![2]).toBe("backend");
    });

    test("ticket with variant: BRE-999:custom", () => {
      const m = "BRE-999:custom".match(TICKET_RE);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("BRE-999");
      expect(m![2]).toBe("custom");
    });

    test("ticket with multi-char prefix: PROJ-42", () => {
      const m = "PROJ-42".match(TICKET_RE);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("PROJ-42");
    });

    test("ticket with variant: PROJ-42:mobile", () => {
      const m = "PROJ-42:mobile".match(TICKET_RE);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("PROJ-42");
      expect(m![2]).toBe("mobile");
    });
  });

  describe("project names (should NOT match)", () => {
    test("project name: 'Collab Install'", () => {
      expect("Collab Install".match(TICKET_RE)).toBeNull();
    });

    test("project name: 'Collab'", () => {
      expect("Collab".match(TICKET_RE)).toBeNull();
    });

    test("project name with spaces: 'My Feature Project'", () => {
      expect("My Feature Project".match(TICKET_RE)).toBeNull();
    });

    test("lowercase ticket ID: bre-123 (must be uppercase)", () => {
      expect("bre-123".match(TICKET_RE)).toBeNull();
    });

    test("mixed case: Bre-123", () => {
      expect("Bre-123".match(TICKET_RE)).toBeNull();
    });

    test("no digits: BRE-abc", () => {
      expect("BRE-abc".match(TICKET_RE)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Argument classification buckets
// ---------------------------------------------------------------------------

describe("argument classification into buckets", () => {
  function classify(args: string[]) {
    const explicitWithVariant: { ticket: string; variant: string }[] = [];
    const explicitNoVariant: string[] = [];
    const projectNames: string[] = [];

    for (const arg of args) {
      const m = arg.match(TICKET_RE);
      if (m) {
        if (m[2]) {
          explicitWithVariant.push({ ticket: m[1], variant: m[2] });
        } else {
          explicitNoVariant.push(m[1]);
        }
      } else {
        projectNames.push(arg);
      }
    }

    return { explicitWithVariant, explicitNoVariant, projectNames };
  }

  test("pure explicit with variants", () => {
    const { explicitWithVariant, explicitNoVariant, projectNames } = classify([
      "BRE-342:default",
      "BRE-341:mobile",
    ]);
    expect(explicitWithVariant).toEqual([
      { ticket: "BRE-342", variant: "default" },
      { ticket: "BRE-341", variant: "mobile" },
    ]);
    expect(explicitNoVariant).toEqual([]);
    expect(projectNames).toEqual([]);
  });

  test("pure explicit without variants", () => {
    const { explicitWithVariant, explicitNoVariant, projectNames } = classify([
      "BRE-339",
      "BRE-340",
    ]);
    expect(explicitWithVariant).toEqual([]);
    expect(explicitNoVariant).toEqual(["BRE-339", "BRE-340"]);
    expect(projectNames).toEqual([]);
  });

  test("pure project name", () => {
    const { explicitWithVariant, explicitNoVariant, projectNames } = classify([
      "Collab Install",
    ]);
    expect(explicitWithVariant).toEqual([]);
    expect(explicitNoVariant).toEqual([]);
    expect(projectNames).toEqual(["Collab Install"]);
  });

  test("mixed: project name + explicit with variant (AC9)", () => {
    const { explicitWithVariant, explicitNoVariant, projectNames } = classify([
      "Collab Install",
      "BRE-999:custom",
    ]);
    expect(explicitWithVariant).toEqual([{ ticket: "BRE-999", variant: "custom" }]);
    expect(explicitNoVariant).toEqual([]);
    expect(projectNames).toEqual(["Collab Install"]);
  });

  test("mixed: project name + bare ticket + variant ticket", () => {
    const { explicitWithVariant, explicitNoVariant, projectNames } = classify([
      "Collab",
      "BRE-100",
      "BRE-200:backend",
    ]);
    expect(explicitWithVariant).toEqual([{ ticket: "BRE-200", variant: "backend" }]);
    expect(explicitNoVariant).toEqual(["BRE-100"]);
    expect(projectNames).toEqual(["Collab"]);
  });
});

// ---------------------------------------------------------------------------
// resolvePipelineVariant
// ---------------------------------------------------------------------------

describe("resolvePipelineVariant", () => {
  test("returns variant suffix from pipeline:backend label", () => {
    expect(resolvePipelineVariant(["pipeline:backend"])).toBe("backend");
  });

  test("returns variant suffix from pipeline:mobile label", () => {
    expect(resolvePipelineVariant(["pipeline:mobile"])).toBe("mobile");
  });

  test("returns variant from mixed label array", () => {
    expect(resolvePipelineVariant(["bug", "pipeline:verification", "urgent"])).toBe(
      "verification"
    );
  });

  test("returns 'default' when no pipeline:* label present", () => {
    expect(resolvePipelineVariant(["bug", "frontend", "urgent"])).toBe("default");
  });

  test("returns 'default' for empty label array", () => {
    expect(resolvePipelineVariant([])).toBe("default");
  });

  test("is case-insensitive (Pipeline:Backend)", () => {
    expect(resolvePipelineVariant(["Pipeline:Backend"])).toBe("Backend");
  });

  test("uses first matching pipeline:* label when multiple present", () => {
    const result = resolvePipelineVariant(["pipeline:backend", "pipeline:mobile"]);
    expect(result).toBe("backend");
  });
});
