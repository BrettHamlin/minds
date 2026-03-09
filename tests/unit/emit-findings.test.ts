import { describe, test, expect } from "bun:test";
import { toFinding, type QuestionInput } from "../../minds/signals/emit-findings";

describe("emit-findings", () => {
  test("toFinding wraps a minimal question into the correct Finding schema", () => {
    const input: QuestionInput = {
      question: "Which table should the API query?",
    };
    const finding = toFinding(input, 0);

    expect(finding.id).toBe("f1");
    expect(finding.question).toBe("Which table should the API query?");
    expect(finding.context).toEqual({
      why: "",
      specReferences: [],
      codePatterns: [],
      constraints: [],
      implications: [],
    });
  });

  test("toFinding preserves provided context fields", () => {
    const input: QuestionInput = {
      question: "How should errors be handled?",
      why: "Affects user experience",
      specReferences: ["Section 4.2"],
      codePatterns: ["src/middleware/error.ts uses try/catch"],
      constraints: ["Must return HTTP 4xx for client errors"],
      implications: ["Determines error response format"],
    };
    const finding = toFinding(input, 2);

    expect(finding.id).toBe("f3");
    expect(finding.context.why).toBe("Affects user experience");
    expect(finding.context.specReferences).toEqual(["Section 4.2"]);
    expect(finding.context.codePatterns).toEqual(["src/middleware/error.ts uses try/catch"]);
    expect(finding.context.constraints).toEqual(["Must return HTTP 4xx for client errors"]);
    expect(finding.context.implications).toEqual(["Determines error response format"]);
  });

  test("toFinding generates sequential IDs based on index", () => {
    const input: QuestionInput = { question: "test" };
    expect(toFinding(input, 0).id).toBe("f1");
    expect(toFinding(input, 1).id).toBe("f2");
    expect(toFinding(input, 4).id).toBe("f5");
  });
});
