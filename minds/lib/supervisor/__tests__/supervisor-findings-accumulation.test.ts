/**
 * supervisor-findings-accumulation.test.ts — Tests for Issue 9: findings
 * accumulation across supervisor iterations.
 *
 * Verifies that:
 *   1. ReviewFinding supports an iteration field
 *   2. Findings from multiple iterations accumulate (not overwrite)
 *   3. Each finding is tagged with its source iteration
 *   4. parseReviewVerdict output can be tagged with iteration numbers
 *   5. buildFeedbackContent works with iteration-tagged findings
 */

import { describe, test, expect } from "bun:test";
import type { ReviewFinding, ReviewVerdict } from "../supervisor-types.ts";
import { parseReviewVerdict, buildFeedbackContent } from "../supervisor-review.ts";

// ---------------------------------------------------------------------------
// Helpers — simulate the accumulation logic from runMindSupervisor
// ---------------------------------------------------------------------------

/**
 * Replicates the accumulation pattern in mind-supervisor.ts:
 *   for (const finding of verdict.findings) {
 *     allFindings.push({ ...finding, iteration });
 *   }
 */
function accumulateFindings(
  allFindings: ReviewFinding[],
  verdict: ReviewVerdict,
  iteration: number,
): ReviewFinding[] {
  for (const finding of verdict.findings) {
    allFindings.push({ ...finding, iteration });
  }
  return allFindings;
}

// ---------------------------------------------------------------------------
// ReviewFinding iteration field
// ---------------------------------------------------------------------------

describe("ReviewFinding iteration field", () => {
  test("ReviewFinding accepts an optional iteration number", () => {
    const finding: ReviewFinding = {
      file: "src/handler.ts",
      line: 42,
      severity: "error",
      message: "Missing null check",
      iteration: 1,
    };
    expect(finding.iteration).toBe(1);
  });

  test("ReviewFinding works without iteration (backward compatible)", () => {
    const finding: ReviewFinding = {
      file: "src/handler.ts",
      line: 42,
      severity: "error",
      message: "Missing null check",
    };
    expect(finding.iteration).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Findings accumulation across iterations
// ---------------------------------------------------------------------------

describe("findings accumulation across iterations", () => {
  test("findings from iteration 1 are preserved after iteration 2", () => {
    const allFindings: ReviewFinding[] = [];

    const verdict1: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "a.ts", line: 10, severity: "error", message: "Missing test" },
      ],
    };

    const verdict2: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "b.ts", line: 20, severity: "warning", message: "Unused import" },
      ],
    };

    accumulateFindings(allFindings, verdict1, 1);
    accumulateFindings(allFindings, verdict2, 2);

    expect(allFindings).toHaveLength(2);
    expect(allFindings[0].file).toBe("a.ts");
    expect(allFindings[0].message).toBe("Missing test");
    expect(allFindings[1].file).toBe("b.ts");
    expect(allFindings[1].message).toBe("Unused import");
  });

  test("each finding is tagged with its source iteration", () => {
    const allFindings: ReviewFinding[] = [];

    const verdict1: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "a.ts", line: 10, severity: "error", message: "Bug in a.ts" },
        { file: "a.ts", line: 15, severity: "warning", message: "Style issue" },
      ],
    };

    const verdict2: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "b.ts", line: 5, severity: "error", message: "Bug in b.ts" },
      ],
    };

    const verdict3: ReviewVerdict = {
      approved: true,
      findings: [],
    };

    accumulateFindings(allFindings, verdict1, 1);
    accumulateFindings(allFindings, verdict2, 2);
    accumulateFindings(allFindings, verdict3, 3);

    expect(allFindings).toHaveLength(3);

    // Iteration 1 findings
    expect(allFindings[0].iteration).toBe(1);
    expect(allFindings[1].iteration).toBe(1);

    // Iteration 2 findings
    expect(allFindings[2].iteration).toBe(2);

    // No findings added from iteration 3 (approved with empty findings)
  });

  test("approved iteration with no findings does not clear previous findings", () => {
    const allFindings: ReviewFinding[] = [];

    const verdict1: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "a.ts", line: 1, severity: "error", message: "Issue found" },
      ],
    };

    const verdict2: ReviewVerdict = {
      approved: true,
      findings: [],
    };

    accumulateFindings(allFindings, verdict1, 1);
    accumulateFindings(allFindings, verdict2, 2);

    // Previous findings are still present
    expect(allFindings).toHaveLength(1);
    expect(allFindings[0].iteration).toBe(1);
    expect(allFindings[0].message).toBe("Issue found");
  });

  test("accumulates findings across many iterations", () => {
    const allFindings: ReviewFinding[] = [];

    for (let i = 1; i <= 5; i++) {
      const verdict: ReviewVerdict = {
        approved: i === 5,
        findings: i < 5
          ? [{ file: `file${i}.ts`, line: i, severity: "error", message: `Issue ${i}` }]
          : [],
      };
      accumulateFindings(allFindings, verdict, i);
    }

    expect(allFindings).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(allFindings[i].iteration).toBe(i + 1);
      expect(allFindings[i].file).toBe(`file${i + 1}.ts`);
    }
  });

  test("findings from parseReviewVerdict can be tagged with iteration", () => {
    const allFindings: ReviewFinding[] = [];

    // Simulate what the supervisor does: parse verdict then tag with iteration
    const raw1 = JSON.stringify({
      approved: false,
      findings: [
        { file: "x.ts", line: 1, severity: "error", message: "Parse error" },
      ],
    });
    const verdict1 = parseReviewVerdict(raw1);
    accumulateFindings(allFindings, verdict1, 1);

    const raw2 = JSON.stringify({
      approved: false,
      findings: [
        { file: "y.ts", line: 2, severity: "warning", message: "Style warning" },
      ],
    });
    const verdict2 = parseReviewVerdict(raw2);
    accumulateFindings(allFindings, verdict2, 2);

    expect(allFindings).toHaveLength(2);
    expect(allFindings[0].iteration).toBe(1);
    expect(allFindings[0].file).toBe("x.ts");
    expect(allFindings[1].iteration).toBe(2);
    expect(allFindings[1].file).toBe("y.ts");
  });

  test("test failure findings injected by supervisor are also tagged", () => {
    const allFindings: ReviewFinding[] = [];

    // Simulate the test-failure injection path in mind-supervisor.ts
    const verdict: ReviewVerdict = {
      approved: false,
      findings: [
        { file: "(tests)", line: 0, severity: "error", message: "Tests are failing." },
      ],
    };

    accumulateFindings(allFindings, verdict, 1);

    expect(allFindings).toHaveLength(1);
    expect(allFindings[0].iteration).toBe(1);
    expect(allFindings[0].file).toBe("(tests)");
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackContent with iteration-tagged findings
// ---------------------------------------------------------------------------

describe("buildFeedbackContent with iteration-tagged findings", () => {
  test("works correctly with findings that have iteration field", () => {
    const findings: ReviewFinding[] = [
      { file: "a.ts", line: 10, severity: "error", message: "Bug", iteration: 1 },
      { file: "b.ts", line: 20, severity: "warning", message: "Style", iteration: 2 },
    ];

    const content = buildFeedbackContent(2, findings);
    expect(content).toContain("Round 2");
    expect(content).toContain("a.ts:10");
    expect(content).toContain("b.ts:20");
    expect(content).toContain("**Error**");
    expect(content).toContain("Warning");
  });
});
