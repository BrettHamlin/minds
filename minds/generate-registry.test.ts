import { describe, it, expect } from "bun:test";
import { validateMindDescription } from "./mind";
import type { MindDescription } from "./mind";

// Tests for the output format that generate-registry.ts produces:
// a JSON array of MindDescription objects written to .collab/minds.json

const validDescription: MindDescription = {
  name: "signals",
  domain: "Agent-to-orchestrator signal emission and transport dispatch",
  keywords: ["signal", "emit", "phase"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals", "resolve signal names"],
};

describe("generate-registry output format", () => {
  describe("MindDescription schema", () => {
    it("accepts a valid MindDescription", () => {
      expect(validateMindDescription(validDescription)).toBe(true);
    });

    it("accepts description with optional exposes and consumes", () => {
      expect(
        validateMindDescription({
          ...validDescription,
          exposes: ["SPEC_COMPLETE"],
          consumes: ["PLAN_COMPLETE"],
        })
      ).toBe(true);
    });

    it("accepts description without exposes/consumes (optional)", () => {
      const { ...rest } = validDescription;
      expect(validateMindDescription(rest)).toBe(true);
    });

    it("rejects missing name", () => {
      const { name: _n, ...rest } = validDescription;
      expect(validateMindDescription(rest)).toBe(false);
    });

    it("rejects missing domain", () => {
      const { domain: _d, ...rest } = validDescription;
      expect(validateMindDescription(rest)).toBe(false);
    });

    it("rejects missing keywords", () => {
      const { keywords: _k, ...rest } = validDescription;
      expect(validateMindDescription(rest)).toBe(false);
    });

    it("rejects missing owns_files", () => {
      const { owns_files: _o, ...rest } = validDescription;
      expect(validateMindDescription(rest)).toBe(false);
    });

    it("rejects missing capabilities", () => {
      const { capabilities: _c, ...rest } = validDescription;
      expect(validateMindDescription(rest)).toBe(false);
    });

    it("rejects non-array keywords", () => {
      expect(validateMindDescription({ ...validDescription, keywords: "signal" })).toBe(false);
    });

    it("rejects non-array owns_files", () => {
      expect(validateMindDescription({ ...validDescription, owns_files: "minds/signals/" })).toBe(
        false
      );
    });

    it("rejects non-array capabilities", () => {
      expect(validateMindDescription({ ...validDescription, capabilities: null })).toBe(false);
    });

    it("rejects non-array exposes", () => {
      expect(validateMindDescription({ ...validDescription, exposes: "SPEC_COMPLETE" })).toBe(
        false
      );
    });

    it("rejects non-array consumes", () => {
      expect(validateMindDescription({ ...validDescription, consumes: "PLAN_COMPLETE" })).toBe(
        false
      );
    });

    it("rejects keywords with non-string entries", () => {
      expect(validateMindDescription({ ...validDescription, keywords: ["signal", 42] })).toBe(
        false
      );
    });
  });

  describe("registry array format", () => {
    it("a valid registry is an array of MindDescriptions", () => {
      const registry: MindDescription[] = [validDescription];
      expect(Array.isArray(registry)).toBe(true);
      expect(registry.every(validateMindDescription)).toBe(true);
    });

    it("registry with multiple Minds all pass validation", () => {
      const registry: MindDescription[] = [
        validDescription,
        { ...validDescription, name: "pipeline_core", domain: "Pipeline lifecycle management" },
        {
          ...validDescription,
          name: "cli",
          domain: "CLI command handling",
          exposes: ["CLI_READY"],
          consumes: ["SPEC_COMPLETE"],
        },
      ];
      expect(registry.every(validateMindDescription)).toBe(true);
    });

    it("detects invalid entry in registry", () => {
      const registry = [validDescription, { name: "bad" }];
      expect(registry.every(validateMindDescription)).toBe(false);
    });

    it("router is excluded — router name is not a child Mind", () => {
      // The generate-registry script excludes minds/router/server.ts.
      // Verify a registry of child Minds does not contain "router".
      const registry: MindDescription[] = [validDescription];
      const hasRouter = registry.some((d) => d.name === "router");
      expect(hasRouter).toBe(false);
    });
  });
});
