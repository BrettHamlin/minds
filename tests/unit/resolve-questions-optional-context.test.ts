import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";

const RESOLVE_QUESTIONS_PATH = "minds/coordination/resolve-questions.ts";

describe("resolve-questions.ts schema tolerance", () => {
  test("guards finding.context access with optional chaining before using codePatterns", () => {
    const source = readFileSync(RESOLVE_QUESTIONS_PATH, "utf-8");
    // The guard must use optional chaining — findings may not have a context field
    expect(source).toContain("finding.context?.codePatterns");
  });

  test("guards finding.context access with optional chaining before using constraints", () => {
    const source = readFileSync(RESOLVE_QUESTIONS_PATH, "utf-8");
    expect(source).toContain("finding.context?.constraints");
  });

  test("does not directly access finding.context.codePatterns without a guard", () => {
    const source = readFileSync(RESOLVE_QUESTIONS_PATH, "utf-8");
    const lines = source.split("\n");
    // Find lines that access finding.context.codePatterns (non-optional)
    // These are OK only if inside a guarded block (after an if check)
    const unguardedAccess = lines.filter(
      (line) =>
        line.includes("finding.context.codePatterns") &&
        !line.includes("finding.context?.codePatterns") &&
        !line.trim().startsWith("//"),
    );
    // All unguarded accesses must be inside a block guarded by finding.context?.codePatterns
    for (const line of unguardedAccess) {
      const lineIdx = lines.indexOf(line);
      // Check preceding lines for the guard
      const precedingBlock = lines.slice(Math.max(0, lineIdx - 5), lineIdx).join("\n");
      expect(precedingBlock).toContain("finding.context?.codePatterns");
    }
  });
});
