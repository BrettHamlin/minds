/**
 * Unit tests for src/scripts/orchestrator/commands/resolve-tickets.ts
 *
 * Tests cover the exported pure functions — no API calls, no subprocess needed.
 */

import { describe, test, expect } from "bun:test";

import {
  resolvePipelineVariant,
  classifyArgs,
} from "../../src/scripts/orchestrator/commands/resolve-tickets.ts";

// ---------------------------------------------------------------------------
// classifyArgs — argument classification
// ---------------------------------------------------------------------------

describe("classifyArgs", () => {
  describe("ticket ID detection", () => {
    test("bare ticket ID: BRE-123", () => {
      const result = classifyArgs(["BRE-123"]);
      expect(result.ticketsNoVariant).toEqual(["BRE-123"]);
      expect(result.ticketsWithVariant).toEqual([]);
      expect(result.projectNames).toEqual([]);
    });

    test("ticket with variant: BRE-123:backend", () => {
      const result = classifyArgs(["BRE-123:backend"]);
      expect(result.ticketsWithVariant).toEqual([{ ticket: "BRE-123", variant: "backend" }]);
      expect(result.ticketsNoVariant).toEqual([]);
      expect(result.projectNames).toEqual([]);
    });

    test("multi-char prefix: PROJ-42:mobile", () => {
      const result = classifyArgs(["PROJ-42:mobile"]);
      expect(result.ticketsWithVariant).toEqual([{ ticket: "PROJ-42", variant: "mobile" }]);
    });
  });

  describe("project name detection", () => {
    test("project name: 'Collab Install'", () => {
      const result = classifyArgs(["Collab Install"]);
      expect(result.projectNames).toEqual(["Collab Install"]);
      expect(result.ticketsWithVariant).toEqual([]);
      expect(result.ticketsNoVariant).toEqual([]);
    });

    test("single word project: 'Collab'", () => {
      const result = classifyArgs(["Collab"]);
      expect(result.projectNames).toEqual(["Collab"]);
    });

    test("lowercase ticket-like string: bre-123 (not a ticket)", () => {
      const result = classifyArgs(["bre-123"]);
      expect(result.projectNames).toEqual(["bre-123"]);
      expect(result.ticketsNoVariant).toEqual([]);
    });

    test("no digits: BRE-abc (not a ticket)", () => {
      const result = classifyArgs(["BRE-abc"]);
      expect(result.projectNames).toEqual(["BRE-abc"]);
    });
  });

  describe("mixed arguments", () => {
    test("pure explicit with variants", () => {
      const result = classifyArgs(["BRE-342:default", "BRE-341:mobile"]);
      expect(result.ticketsWithVariant).toEqual([
        { ticket: "BRE-342", variant: "default" },
        { ticket: "BRE-341", variant: "mobile" },
      ]);
      expect(result.ticketsNoVariant).toEqual([]);
      expect(result.projectNames).toEqual([]);
    });

    test("pure bare tickets", () => {
      const result = classifyArgs(["BRE-339", "BRE-340"]);
      expect(result.ticketsWithVariant).toEqual([]);
      expect(result.ticketsNoVariant).toEqual(["BRE-339", "BRE-340"]);
      expect(result.projectNames).toEqual([]);
    });

    test("project name + ticket:variant", () => {
      const result = classifyArgs(["Collab Install", "BRE-999:custom"]);
      expect(result.ticketsWithVariant).toEqual([{ ticket: "BRE-999", variant: "custom" }]);
      expect(result.ticketsNoVariant).toEqual([]);
      expect(result.projectNames).toEqual(["Collab Install"]);
    });

    test("project name + bare ticket + variant ticket", () => {
      const result = classifyArgs(["Collab", "BRE-100", "BRE-200:backend"]);
      expect(result.ticketsWithVariant).toEqual([{ ticket: "BRE-200", variant: "backend" }]);
      expect(result.ticketsNoVariant).toEqual(["BRE-100"]);
      expect(result.projectNames).toEqual(["Collab"]);
    });
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
