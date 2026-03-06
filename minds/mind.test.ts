import { describe, it, expect } from "bun:test";
import {
  validateWorkUnit,
  validateWorkResult,
  validateMindDescription,
} from "./mind";
import type { WorkUnit, WorkResult, MindDescription, Mind } from "./mind";

describe("validateWorkUnit", () => {
  it("accepts a minimal work unit", () => {
    expect(validateWorkUnit({ request: "do something" })).toBe(true);
  });

  it("accepts a full work unit with all optional fields", () => {
    expect(
      validateWorkUnit({ request: "do something", context: { extra: true }, from: "parent-mind" })
    ).toBe(true);
  });

  it("accepts any context value (unknown type)", () => {
    expect(validateWorkUnit({ request: "x", context: 42 })).toBe(true);
    expect(validateWorkUnit({ request: "x", context: null })).toBe(true);
    expect(validateWorkUnit({ request: "x", context: "string" })).toBe(true);
    expect(validateWorkUnit({ request: "x", context: [1, 2] })).toBe(true);
  });

  it("rejects null", () => {
    expect(validateWorkUnit(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateWorkUnit(undefined)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(validateWorkUnit("string")).toBe(false);
    expect(validateWorkUnit(42)).toBe(false);
    expect(validateWorkUnit(true)).toBe(false);
  });

  it("rejects empty object (missing request)", () => {
    expect(validateWorkUnit({})).toBe(false);
  });

  it("rejects non-string request", () => {
    expect(validateWorkUnit({ request: 42 })).toBe(false);
    expect(validateWorkUnit({ request: null })).toBe(false);
    expect(validateWorkUnit({ request: true })).toBe(false);
  });

  it("rejects non-string from", () => {
    expect(validateWorkUnit({ request: "do", from: 123 })).toBe(false);
    expect(validateWorkUnit({ request: "do", from: true })).toBe(false);
    expect(validateWorkUnit({ request: "do", from: {} })).toBe(false);
  });

  it("accepts undefined from (optional field)", () => {
    expect(validateWorkUnit({ request: "do something" })).toBe(true);
  });
});

describe("validateWorkResult", () => {
  it("accepts handled result", () => {
    expect(validateWorkResult({ status: "handled" })).toBe(true);
  });

  it("accepts escalate result", () => {
    expect(validateWorkResult({ status: "escalate" })).toBe(true);
  });

  it("accepts result with data", () => {
    expect(validateWorkResult({ status: "handled", data: { foo: "bar" } })).toBe(true);
  });

  it("accepts result with error string", () => {
    expect(validateWorkResult({ status: "handled", error: "something failed" })).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(validateWorkResult({ status: "unknown" })).toBe(false);
    expect(validateWorkResult({ status: "" })).toBe(false);
  });

  it("rejects missing status", () => {
    expect(validateWorkResult({})).toBe(false);
  });

  it("rejects non-string error", () => {
    expect(validateWorkResult({ status: "handled", error: 42 })).toBe(false);
  });

  it("rejects null", () => {
    expect(validateWorkResult(null)).toBe(false);
  });
});

describe("validateMindDescription", () => {
  const valid: MindDescription = {
    name: "signals",
    domain: "Agent-to-orchestrator signal emission and transport dispatch",
    keywords: ["signal", "emit", "phase", "event"],
    owns_files: ["minds/signals/"],
    capabilities: ["emit signals", "resolve signal names"],
  };

  it("accepts a valid MindDescription", () => {
    expect(validateMindDescription(valid)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateMindDescription(null)).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _n, ...rest } = valid;
    expect(validateMindDescription(rest)).toBe(false);
  });

  it("rejects non-string name", () => {
    expect(validateMindDescription({ ...valid, name: 42 })).toBe(false);
  });

  it("rejects missing domain", () => {
    const { domain: _d, ...rest } = valid;
    expect(validateMindDescription(rest)).toBe(false);
  });

  it("rejects non-array keywords", () => {
    expect(validateMindDescription({ ...valid, keywords: "signal" })).toBe(false);
  });

  it("rejects keywords with non-string entries", () => {
    expect(validateMindDescription({ ...valid, keywords: ["signal", 42] })).toBe(false);
  });

  it("rejects non-array owns_files", () => {
    expect(validateMindDescription({ ...valid, owns_files: "minds/signals/" })).toBe(false);
  });

  it("rejects non-array capabilities", () => {
    expect(validateMindDescription({ ...valid, capabilities: null })).toBe(false);
  });

  it("accepts empty arrays", () => {
    expect(
      validateMindDescription({ ...valid, keywords: [], owns_files: [], capabilities: [] })
    ).toBe(true);
  });
});

describe("Mind interface structural compliance", () => {
  it("a conforming object satisfies the Mind interface at runtime", () => {
    const mind: Mind = {
      async handle(workUnit) {
        return { status: "handled", data: { echo: workUnit.request } };
      },
      describe() {
        return {
          name: "test",
          domain: "test domain",
          keywords: ["test"],
          owns_files: ["minds/test/"],
          capabilities: ["do test things"],
        };
      },
    };

    expect(typeof mind.handle).toBe("function");
    expect(typeof mind.describe).toBe("function");
    expect(validateMindDescription(mind.describe())).toBe(true);
  });

  it("handle() returns a WorkResult-shaped object", async () => {
    const mind: Mind = {
      async handle(_workUnit) {
        return { status: "handled", data: "done" };
      },
      describe() {
        return { name: "t", domain: "t", keywords: [], owns_files: [], capabilities: [] };
      },
    };

    const result = await mind.handle({ request: "hello" });
    expect(validateWorkResult(result)).toBe(true);
  });

  it("escalate result is valid WorkResult", async () => {
    const mind: Mind = {
      async handle(_workUnit) {
        return { status: "escalate" };
      },
      describe() {
        return { name: "t", domain: "t", keywords: [], owns_files: [], capabilities: [] };
      },
    };

    const result = await mind.handle({ request: "out of domain" });
    expect(validateWorkResult(result)).toBe(true);
    expect(result.status).toBe("escalate");
  });
});
