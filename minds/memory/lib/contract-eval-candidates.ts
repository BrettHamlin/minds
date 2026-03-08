/**
 * contract-eval-candidates.ts — 4 consolidation algorithm candidates for contract patterns.
 *
 * All candidates take patterns from the SAME phase pair and produce canonical patterns.
 * (A) Frequency-weighted merge
 * (B) Prototype learning with exponential decay
 * (C) Hybrid frequency + Jaccard sub-clustering
 * (D) HAC with composite distance
 */

import type { ContractPattern, SectionDescriptor } from "./contract-types.js";

export interface ConsolidationResult {
  canonicals: ContractPattern[];
  clusterCount: number;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function sectionNames(p: ContractPattern): Set<string> {
  return new Set(p.sections.map((s) => s.name));
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = values[0] ?? "";
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

function buildCanonical(
  patterns: ContractPattern[],
  requiredThreshold: number,
  optionalThreshold: number,
): ContractPattern {
  const n = patterns.length;
  if (n === 0) {
    throw new Error("Cannot build canonical from empty patterns");
  }

  // Count section frequencies and collect descriptions
  const sectionFreq = new Map<string, number>();
  const sectionDescs = new Map<string, string>();
  for (const p of patterns) {
    for (const s of p.sections) {
      sectionFreq.set(s.name, (sectionFreq.get(s.name) ?? 0) + 1);
      if (!sectionDescs.has(s.name)) {
        sectionDescs.set(s.name, s.description);
      }
    }
  }

  const sections: SectionDescriptor[] = [];
  for (const [name, count] of sectionFreq) {
    const freq = count / n;
    if (freq >= requiredThreshold) {
      sections.push({ name, required: true, description: sectionDescs.get(name)! });
    } else if (freq >= optionalThreshold) {
      sections.push({ name, required: false, description: sectionDescs.get(name)! });
    }
    // else: dropped (freq < optionalThreshold)
  }

  return {
    sourcePhase: patterns[0].sourcePhase,
    targetPhase: patterns[0].targetPhase,
    artifactShape: mostCommon(patterns.map((p) => p.artifactShape)),
    sections,
    metadata: { consolidation: "canonical", patternCount: String(n) },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// (A) Frequency-weighted merge (~60 LOC)
// ---------------------------------------------------------------------------
export function candidateA(patterns: ContractPattern[]): ConsolidationResult {
  if (patterns.length === 0) return { canonicals: [], clusterCount: 0 };
  const canonical = buildCanonical(patterns, 0.7, 0.3);
  return { canonicals: [canonical], clusterCount: 1 };
}

// ---------------------------------------------------------------------------
// (B) Prototype learning with exponential decay (~200 LOC)
// ---------------------------------------------------------------------------
export function candidateB(patterns: ContractPattern[]): ConsolidationResult {
  if (patterns.length === 0) return { canonicals: [], clusterCount: 0 };

  const alpha = 0.3;
  const includeThreshold = 0.4;

  // Running scores per section name
  const scores = new Map<string, number>();
  const descriptions = new Map<string, string>();
  const shapes: string[] = [];

  for (const p of patterns) {
    const currentSections = sectionNames(p);
    shapes.push(p.artifactShape);

    // Update scores for all known sections + new ones
    const allNames = new Set([...scores.keys(), ...currentSections]);

    for (const name of allNames) {
      const currentValue = currentSections.has(name) ? 1.0 : 0.0;
      const priorScore = scores.get(name) ?? 0.0;
      const newScore = alpha * currentValue + (1 - alpha) * priorScore;
      scores.set(name, newScore);

      if (currentSections.has(name)) {
        const sec = p.sections.find((s) => s.name === name);
        if (sec && !descriptions.has(name)) {
          descriptions.set(name, sec.description);
        }
      }
    }
  }

  // Build canonical from final scores
  const sections: SectionDescriptor[] = [];
  for (const [name, score] of scores) {
    if (score >= includeThreshold) {
      sections.push({
        name,
        required: score >= 0.7,
        description: descriptions.get(name) ?? `${name} section content`,
      });
    }
  }

  const canonical: ContractPattern = {
    sourcePhase: patterns[0].sourcePhase,
    targetPhase: patterns[0].targetPhase,
    artifactShape: mostCommon(shapes),
    sections,
    metadata: { consolidation: "prototype", patternCount: String(patterns.length) },
    timestamp: new Date().toISOString(),
  };

  return { canonicals: [canonical], clusterCount: 1 };
}

// ---------------------------------------------------------------------------
// (C) Hybrid frequency + Jaccard sub-clustering (~200 LOC)
// ---------------------------------------------------------------------------
export function candidateC(patterns: ContractPattern[]): ConsolidationResult {
  if (patterns.length === 0) return { canonicals: [], clusterCount: 0 };

  // Stage 1: frequency merge to get initial canonical
  const initial = buildCanonical(patterns, 0.7, 0.3);
  const canonicalSections = new Set(initial.sections.map((s) => s.name));

  // Stage 2: compute Jaccard similarity between each pattern and canonical
  const distances = patterns.map((p) => {
    const pSections = sectionNames(p);
    return 1 - jaccard(pSections, canonicalSections);
  });

  // Check for bimodality: if patterns cluster into 2+ groups (distance > 0.4 threshold)
  const closePatterns: ContractPattern[] = [];
  const farPatterns: ContractPattern[] = [];
  const bimodalThreshold = 0.4;

  for (let i = 0; i < patterns.length; i++) {
    if (distances[i] > bimodalThreshold) {
      farPatterns.push(patterns[i]);
    } else {
      closePatterns.push(patterns[i]);
    }
  }

  // If both clusters are substantial (at least 2 patterns each), produce 2 canonicals
  if (farPatterns.length >= 2 && closePatterns.length >= 2) {
    const canonical1 = buildCanonical(closePatterns, 0.7, 0.3);
    const canonical2 = buildCanonical(farPatterns, 0.7, 0.3);
    return { canonicals: [canonical1, canonical2], clusterCount: 2 };
  }

  return { canonicals: [initial], clusterCount: 1 };
}

// ---------------------------------------------------------------------------
// (D) HAC with composite distance (~300 LOC)
// ---------------------------------------------------------------------------
export function candidateD(patterns: ContractPattern[]): ConsolidationResult {
  if (patterns.length === 0) return { canonicals: [], clusterCount: 0 };
  if (patterns.length === 1) {
    return { canonicals: [buildCanonical(patterns, 0.7, 0.3)], clusterCount: 1 };
  }

  const n = patterns.length;
  const sectionSets = patterns.map(sectionNames);

  // Distance matrix (Jaccard distance since phase pair is the same)
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - jaccard(sectionSets[i], sectionSets[j]);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }

  // Each pattern starts in its own cluster
  type Cluster = { members: number[] };
  let clusters: Cluster[] = patterns.map((_, i) => ({ members: [i] }));
  const mergeThreshold = 0.5;

  // Ward's linkage approximation: average distance between all pairs across clusters
  // (true Ward's needs variance, but average linkage is simpler and adequate here)
  function clusterDistance(a: Cluster, b: Cluster): number {
    let sum = 0;
    let count = 0;
    for (const i of a.members) {
      for (const j of b.members) {
        sum += dist[i][j];
        count++;
      }
    }
    return count === 0 ? 1 : sum / count;
  }

  // Agglomerative loop
  while (clusters.length > 1) {
    let minDist = Infinity;
    let mergeI = -1;
    let mergeJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = clusterDistance(clusters[i], clusters[j]);
        if (d < minDist) {
          minDist = d;
          mergeI = i;
          mergeJ = j;
        }
      }
    }

    // Stop if minimum distance exceeds threshold
    if (minDist > mergeThreshold) break;

    // Merge clusters
    const merged: Cluster = {
      members: [...clusters[mergeI].members, ...clusters[mergeJ].members],
    };
    // Remove j first (higher index), then i
    clusters = clusters.filter((_, idx) => idx !== mergeI && idx !== mergeJ);
    clusters.push(merged);
  }

  // Build canonical per cluster
  const canonicals = clusters.map((c) => {
    const clusterPatterns = c.members.map((i) => patterns[i]);
    return buildCanonical(clusterPatterns, 0.7, 0.3);
  });

  return { canonicals, clusterCount: clusters.length };
}
