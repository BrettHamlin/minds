/**
 * contract-eval.test.ts — Eval harness for consolidation algorithm candidates.
 *
 * Validates fixture counts, candidate behaviors, and eval result integrity.
 */

import { describe, expect, test } from "bun:test";

import {
  unimodalPatterns,
  bimodalPatterns,
  noisyPatterns,
  sparsePatterns,
  allFixtures,
} from "./contract-eval-fixtures.js";

import {
  candidateA,
  candidateB,
  candidateC,
  candidateD,
} from "./contract-eval-candidates.js";

import {
  evalResults,
  winner,
  winnerRationale,
  type CandidateScore,
} from "./contract-eval-results.js";

// ---------------------------------------------------------------------------
// Fixture counts
// ---------------------------------------------------------------------------
describe("fixture counts", () => {
  test("unimodal has 10+ patterns", () => {
    expect(unimodalPatterns.length).toBeGreaterThanOrEqual(10);
  });

  test("bimodal has 10+ patterns", () => {
    expect(bimodalPatterns.length).toBeGreaterThanOrEqual(10);
  });

  test("noisy has 5+ patterns", () => {
    expect(noisyPatterns.length).toBeGreaterThanOrEqual(5);
  });

  test("sparse has 2-3 patterns", () => {
    expect(sparsePatterns.length).toBeGreaterThanOrEqual(2);
    expect(sparsePatterns.length).toBeLessThanOrEqual(3);
  });

  test("all fixtures is the sum of groups", () => {
    const total =
      unimodalPatterns.length +
      bimodalPatterns.length +
      noisyPatterns.length +
      sparsePatterns.length;
    expect(allFixtures.length).toBe(total);
  });

  test("all fixtures have correct phase pairs", () => {
    for (const p of unimodalPatterns) {
      expect(p.sourcePhase).toBe("clarify");
      expect(p.targetPhase).toBe("plan");
    }
    for (const p of bimodalPatterns) {
      expect(p.sourcePhase).toBe("plan");
      expect(p.targetPhase).toBe("implement");
    }
    for (const p of noisyPatterns) {
      expect(p.sourcePhase).toBe("implement");
      expect(p.targetPhase).toBe("review");
    }
    for (const p of sparsePatterns) {
      expect(p.sourcePhase).toBe("review");
      expect(p.targetPhase).toBe("deploy");
    }
  });
});

// ---------------------------------------------------------------------------
// Candidate A: Frequency-weighted merge
// ---------------------------------------------------------------------------
describe("candidateA", () => {
  test("returns 1 canonical for unimodal input", () => {
    const result = candidateA(unimodalPatterns);
    expect(result.clusterCount).toBe(1);
    expect(result.canonicals.length).toBe(1);
  });

  test("correctly classifies required sections (threshold >= 0.7)", () => {
    const result = candidateA(unimodalPatterns);
    const canonical = result.canonicals[0];
    const sectionMap = new Map(canonical.sections.map((s) => [s.name, s.required]));

    // Summary: 12/12 = 1.0 -> required
    expect(sectionMap.get("Summary")).toBe(true);
    // Acceptance Criteria: 12/12 = 1.0 -> required
    expect(sectionMap.get("Acceptance Criteria")).toBe(true);
    // Tech Stack: 11/12 = 0.917 -> required
    expect(sectionMap.get("Tech Stack")).toBe(true);
    // Timeline: 10/12 = 0.833 -> required
    expect(sectionMap.get("Timeline")).toBe(true);
    // Stakeholders: 8/12 = 0.667 -> optional (not required)
    expect(sectionMap.has("Stakeholders")).toBe(true);
    expect(sectionMap.get("Stakeholders")).toBe(false);
    // Risks: 1/12 = 0.083 -> dropped
    expect(sectionMap.has("Risks")).toBe(false);
  });

  test("handles empty input", () => {
    const result = candidateA([]);
    expect(result.clusterCount).toBe(0);
    expect(result.canonicals.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Candidate B: Prototype learning with exponential decay
// ---------------------------------------------------------------------------
describe("candidateB", () => {
  test("returns 1 canonical for unimodal input", () => {
    const result = candidateB(unimodalPatterns);
    expect(result.clusterCount).toBe(1);
    expect(result.canonicals.length).toBe(1);
  });

  test("canonical includes core sections", () => {
    const result = candidateB(unimodalPatterns);
    const names = new Set(result.canonicals[0].sections.map((s) => s.name));
    // At minimum, the most frequent sections should survive decay
    expect(names.has("Summary")).toBe(true);
    expect(names.has("Acceptance Criteria")).toBe(true);
  });

  test("handles sparse input without crash", () => {
    const result = candidateB(sparsePatterns);
    expect(result.canonicals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Candidate C: Hybrid frequency + Jaccard sub-clustering
// ---------------------------------------------------------------------------
describe("candidateC", () => {
  test("returns 2+ canonicals for bimodal input (bimodal detection)", () => {
    const result = candidateC(bimodalPatterns);
    expect(result.clusterCount).toBeGreaterThanOrEqual(2);
    expect(result.canonicals.length).toBeGreaterThanOrEqual(2);
  });

  test("returns 1 canonical for unimodal input", () => {
    const result = candidateC(unimodalPatterns);
    expect(result.clusterCount).toBe(1);
    expect(result.canonicals.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Candidate D: HAC with composite distance
// ---------------------------------------------------------------------------
describe("candidateD", () => {
  test("returns 2+ canonicals for bimodal input (bimodal detection)", () => {
    const result = candidateD(bimodalPatterns);
    expect(result.clusterCount).toBeGreaterThanOrEqual(2);
    expect(result.canonicals.length).toBeGreaterThanOrEqual(2);
  });

  test("returns valid result for unimodal input", () => {
    const result = candidateD(unimodalPatterns);
    expect(result.canonicals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// All candidates: sparse input (cold-start)
// ---------------------------------------------------------------------------
describe("cold-start (sparse input)", () => {
  const candidates = [
    { name: "A", fn: candidateA },
    { name: "B", fn: candidateB },
    { name: "C", fn: candidateC },
    { name: "D", fn: candidateD },
  ];

  for (const { name, fn } of candidates) {
    test(`candidate ${name} handles sparse input without errors`, () => {
      const result = fn(sparsePatterns);
      expect(result.canonicals.length).toBeGreaterThan(0);
      const canonical = result.canonicals[0];
      expect(canonical.sourcePhase).toBe("review");
      expect(canonical.targetPhase).toBe("deploy");
      expect(canonical.sections.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Performance: each candidate processes 26 patterns (unimodal+bimodal) in < 5000ms
// ---------------------------------------------------------------------------
describe("performance", () => {
  const combined = [...unimodalPatterns, ...bimodalPatterns];
  const candidates = [
    { name: "A", fn: candidateA },
    { name: "B", fn: candidateB },
    { name: "C", fn: candidateC },
    { name: "D", fn: candidateD },
  ];

  for (const { name, fn } of candidates) {
    test(`candidate ${name} processes ${combined.length} patterns in < 5000ms`, () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        fn(combined);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5000);
    });
  }
});

// ---------------------------------------------------------------------------
// Eval results validation
// ---------------------------------------------------------------------------
describe("evalResults", () => {
  test("has 4 entries (A, B, C, D)", () => {
    expect(evalResults.length).toBe(4);
    const names = evalResults.map((r) => r.candidate);
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(names).toContain("C");
    expect(names).toContain("D");
  });

  test("all scores are in valid range (0-10)", () => {
    for (const r of evalResults) {
      expect(r.canonicalQuality).toBeGreaterThanOrEqual(0);
      expect(r.canonicalQuality).toBeLessThanOrEqual(10);
      expect(r.bimodalDetection).toBeGreaterThanOrEqual(0);
      expect(r.bimodalDetection).toBeLessThanOrEqual(10);
      expect(r.incrementalAccuracy).toBeGreaterThanOrEqual(0);
      expect(r.incrementalAccuracy).toBeLessThanOrEqual(10);
      expect(r.coldStartBehavior).toBeGreaterThanOrEqual(0);
      expect(r.coldStartBehavior).toBeLessThanOrEqual(10);
      expect(r.performance).toBeGreaterThanOrEqual(0);
      expect(r.performance).toBeLessThanOrEqual(10);
    }
  });

  test("total equals sum of 5 metrics", () => {
    for (const r of evalResults) {
      const sum =
        r.canonicalQuality +
        r.bimodalDetection +
        r.incrementalAccuracy +
        r.coldStartBehavior +
        r.performance;
      // Allow floating point tolerance
      expect(Math.abs(r.total - sum)).toBeLessThan(0.01);
    }
  });

  test("winner is one of A, B, C, D", () => {
    expect(["A", "B", "C", "D"]).toContain(winner);
  });

  test("winnerRationale is a non-empty string", () => {
    expect(typeof winnerRationale).toBe("string");
    expect(winnerRationale.length).toBeGreaterThan(0);
  });

  test("winner has the highest total score", () => {
    const winnerScore = evalResults.find((r) => r.candidate === winner)!;
    for (const r of evalResults) {
      expect(winnerScore.total).toBeGreaterThanOrEqual(r.total);
    }
  });
});
