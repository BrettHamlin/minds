/**
 * contract-eval-results.ts — Computes consolidation algorithm eval scores at module load time.
 *
 * Imports fixtures and candidates, runs all 5 metrics against all 4 candidates,
 * exports computed results as const.
 */

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
  type ConsolidationResult,
} from "./contract-eval-candidates.js";

export interface CandidateScore {
  candidate: string;
  canonicalQuality: number;
  bimodalDetection: number;
  incrementalAccuracy: number;
  coldStartBehavior: number;
  performance: number;
  total: number;
}

type CandidateFn = (patterns: import("./contract-types.js").ContractPattern[]) => ConsolidationResult;

// ---------------------------------------------------------------------------
// Metric 1: Canonical quality (unimodal group)
// ---------------------------------------------------------------------------
// Expected: Summary, AC always present (required), Tech Stack 11/12 = 0.917 (required),
// Timeline 10/12 = 0.833 (required), Stakeholders 8/12 = 0.667 (optional), Risks 1/12 = 0.083 (dropped)
const expectedRequired = new Set(["Summary", "Acceptance Criteria", "Tech Stack", "Timeline"]);
const expectedOptional = new Set(["Stakeholders"]);
const expectedDropped = new Set(["Risks"]);
const allExpectedSections = new Set([...expectedRequired, ...expectedOptional, ...expectedDropped]);

function scoreCanonicalQuality(fn: CandidateFn): number {
  const result = fn(unimodalPatterns);
  if (result.canonicals.length === 0) return 0;

  const canonical = result.canonicals[0];
  const sectionMap = new Map(canonical.sections.map((s) => [s.name, s.required]));

  let correct = 0;
  let total = allExpectedSections.size;

  for (const name of expectedRequired) {
    if (sectionMap.has(name) && sectionMap.get(name) === true) correct++;
  }
  for (const name of expectedOptional) {
    if (sectionMap.has(name) && sectionMap.get(name) === false) correct++;
  }
  for (const name of expectedDropped) {
    if (!sectionMap.has(name)) correct++;
  }

  return Math.round((correct / total) * 10 * 100) / 100;
}

// ---------------------------------------------------------------------------
// Metric 2: Bimodal detection
// ---------------------------------------------------------------------------
function scoreBimodalDetection(fn: CandidateFn): number {
  const result = fn(bimodalPatterns);
  return result.clusterCount >= 2 ? 10 : 0;
}

// ---------------------------------------------------------------------------
// Metric 3: Incremental accuracy
// ---------------------------------------------------------------------------
function scoreIncrementalAccuracy(fn: CandidateFn): number {
  // Batch: run on all unimodal patterns
  const batchResult = fn(unimodalPatterns);
  if (batchResult.canonicals.length === 0) return 0;
  const batchSections = new Set(batchResult.canonicals[0].sections.map((s) => s.name));

  // Incremental: run on first half, then all
  const halfResult = fn(unimodalPatterns.slice(0, Math.ceil(unimodalPatterns.length / 2)));
  if (halfResult.canonicals.length === 0) return 0;

  // Final incremental: run on all (same as batch for non-incremental)
  // Compare half result to batch to measure stability
  const halfSections = new Set(halfResult.canonicals[0].sections.map((s) => s.name));

  // Jaccard similarity
  let intersection = 0;
  for (const s of batchSections) {
    if (halfSections.has(s)) intersection++;
  }
  const union = batchSections.size + halfSections.size - intersection;
  const similarity = union === 0 ? 1 : intersection / union;

  return Math.round(10 * similarity * 100) / 100;
}

// ---------------------------------------------------------------------------
// Metric 4: Cold-start behavior (sparse group)
// ---------------------------------------------------------------------------
function scoreColdStart(fn: CandidateFn): number {
  try {
    const result = fn(sparsePatterns);
    if (result.canonicals.length === 0) return 0;
    const canonical = result.canonicals[0];
    // Check it has at least "Deployment Checklist" and "Rollback Plan"
    const names = new Set(canonical.sections.map((s) => s.name));
    if (names.has("Deployment Checklist") && names.has("Rollback Plan")) return 10;
    if (names.size > 0) return 5;
    return 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Metric 5: Performance (50 patterns = unimodal + bimodal combined)
// ---------------------------------------------------------------------------
function scorePerformance(fn: CandidateFn): number {
  const combinedPatterns = [...unimodalPatterns, ...bimodalPatterns];
  const start = performance.now();
  // Run 10 times for stability
  for (let i = 0; i < 10; i++) {
    fn(combinedPatterns);
  }
  const elapsed = (performance.now() - start) / 10;

  if (elapsed < 10) return 10;
  if (elapsed < 100) return 7;
  if (elapsed < 1000) return 4;
  return 0;
}

// ---------------------------------------------------------------------------
// Run all metrics
// ---------------------------------------------------------------------------
function evaluateCandidate(name: string, fn: CandidateFn): CandidateScore {
  const canonicalQuality = scoreCanonicalQuality(fn);
  const bimodalDetection = scoreBimodalDetection(fn);
  const incrementalAccuracy = scoreIncrementalAccuracy(fn);
  const coldStartBehavior = scoreColdStart(fn);
  const perf = scorePerformance(fn);
  const total = Math.round(
    (canonicalQuality + bimodalDetection + incrementalAccuracy + coldStartBehavior + perf) * 100,
  ) / 100;

  return {
    candidate: name,
    canonicalQuality,
    bimodalDetection,
    incrementalAccuracy,
    coldStartBehavior,
    performance: perf,
    total,
  };
}

export const evalResults: CandidateScore[] = [
  evaluateCandidate("A", candidateA),
  evaluateCandidate("B", candidateB),
  evaluateCandidate("C", candidateC),
  evaluateCandidate("D", candidateD),
];

// Determine winner
const sorted = [...evalResults].sort((a, b) => b.total - a.total);
export const winner: string = sorted[0].candidate;

export const winnerRationale: string = (() => {
  const w = sorted[0];
  const runnerUp = sorted[1];
  const advantages: string[] = [];

  if (w.canonicalQuality > runnerUp.canonicalQuality) advantages.push("better canonical quality");
  if (w.bimodalDetection > runnerUp.bimodalDetection) advantages.push("bimodal detection capability");
  if (w.incrementalAccuracy > runnerUp.incrementalAccuracy) advantages.push("higher incremental accuracy");
  if (w.coldStartBehavior > runnerUp.coldStartBehavior) advantages.push("better cold-start behavior");
  if (w.performance > runnerUp.performance) advantages.push("faster performance");

  const advStr = advantages.length > 0 ? advantages.join(", ") : "highest total score";
  return `Candidate ${w.candidate} wins with total score ${w.total}/50. Advantages over runner-up (${runnerUp.candidate}): ${advStr}. Score breakdown: canonical=${w.canonicalQuality}, bimodal=${w.bimodalDetection}, incremental=${w.incrementalAccuracy}, cold-start=${w.coldStartBehavior}, perf=${w.performance}.`;
})();
