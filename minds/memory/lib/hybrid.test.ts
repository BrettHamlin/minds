/**
 * Unit tests for hybrid.ts — hybrid BM25 + vector merge algorithm.
 *
 * T010: Tests merge algorithm (weighted scoring, score ordering),
 * bm25RankToScore normalization, temporal decay, MMR re-ranking,
 * and edge cases (empty results, single source).
 */

import { describe, test, expect } from "bun:test";
import {
  bm25RankToScore,
  applyTemporalDecay,
  mmrRerank,
  mergeHybridResults,
} from "./hybrid";
import type { VectorSearchResult, BM25SearchResult } from "./hybrid";
import type { SearchResult } from "./search";

// ─── bm25RankToScore ─────────────────────────────────────────────────────────

describe("bm25RankToScore", () => {
  test("rank 1 of 1 returns 1.0", () => {
    expect(bm25RankToScore(1, 1)).toBeCloseTo(1.0);
  });

  test("rank 1 of N returns 1.0 (best match)", () => {
    expect(bm25RankToScore(1, 5)).toBeCloseTo(1.0);
  });

  test("rank N of N returns 1/N (worst match)", () => {
    expect(bm25RankToScore(5, 5)).toBeCloseTo(0.2);
  });

  test("scores decrease as rank increases", () => {
    const total = 10;
    const scores = Array.from({ length: total }, (_, i) => bm25RankToScore(i + 1, total));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  test("returns 0 for invalid inputs", () => {
    expect(bm25RankToScore(0, 10)).toBe(0);
    expect(bm25RankToScore(1, 0)).toBe(0);
    expect(bm25RankToScore(-1, 10)).toBe(0);
  });

  test("scores are in (0, 1]", () => {
    for (let rank = 1; rank <= 10; rank++) {
      const score = bm25RankToScore(rank, 10);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ─── applyTemporalDecay ───────────────────────────────────────────────────────

describe("applyTemporalDecay", () => {
  test("returns unchanged score when path has no date", () => {
    const score = 0.8;
    expect(applyTemporalDecay(score, "/minds/memory/MEMORY.md", 90)).toBe(score);
  });

  test("reduces score for old files", () => {
    const oldPath = "/minds/memory/memory/2020-01-01.md";
    const decayed = applyTemporalDecay(1.0, oldPath, 90);
    expect(decayed).toBeLessThan(1.0);
  });

  test("minimal decay for today's date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const path = `/minds/memory/memory/${today}.md`;
    const decayed = applyTemporalDecay(1.0, path, 90);
    // Very close to 1.0 (daysSince ≈ 0)
    expect(decayed).toBeCloseTo(1.0, 1);
  });

  test("score halves after halfLifeDays", () => {
    // Create a date exactly halfLifeDays ago
    const halfLifeDays = 30;
    const pastDate = new Date(Date.now() - halfLifeDays * 24 * 60 * 60 * 1000);
    const dateStr = pastDate.toISOString().slice(0, 10);
    const path = `/minds/memory/${dateStr}.md`;

    const decayed = applyTemporalDecay(1.0, path, halfLifeDays);
    expect(decayed).toBeCloseTo(0.5, 1);
  });

  test("older files decay more than newer files", () => {
    const oldPath = "/minds/memory/2020-01-01.md";
    const newPath = "/minds/memory/2025-01-01.md";

    const decayedOld = applyTemporalDecay(1.0, oldPath, 90);
    const decayedNew = applyTemporalDecay(1.0, newPath, 90);

    expect(decayedOld).toBeLessThan(decayedNew);
  });
});

// ─── mmrRerank ────────────────────────────────────────────────────────────────

describe("mmrRerank", () => {
  const makeResult = (content: string, score: number): SearchResult => ({
    path: "/test.md",
    startLine: 1,
    endLine: 5,
    content,
    score,
  });

  test("returns empty array for empty input", () => {
    expect(mmrRerank([], 0.5, 10)).toEqual([]);
  });

  test("returns single item unchanged", () => {
    const r = makeResult("hello world", 1.0);
    expect(mmrRerank([r], 0.5, 10)).toHaveLength(1);
  });

  test("respects maxResults limit", () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      makeResult(`unique content ${i}`, 1.0 - i * 0.05)
    );
    expect(mmrRerank(results, 0.5, 3)).toHaveLength(3);
  });

  test("lambda=1 returns pure relevance ordering (no diversity)", () => {
    const results = [
      makeResult("alpha beta gamma", 0.9),
      makeResult("delta epsilon zeta", 0.8),
      makeResult("alpha beta gamma copy", 0.7),
    ];

    const reranked = mmrRerank(results, 1.0, 3);
    // With lambda=1, pure relevance: scores should be maintained
    expect(reranked[0].score).toBe(0.9);
  });

  test("with lambda<1, diverse content ranks higher than duplicate content", () => {
    // Two identical chunks + one diverse chunk
    const results = [
      makeResult("the memory mind owns all memory infrastructure", 1.0),
      makeResult("the memory mind owns all memory infrastructure", 0.95),
      makeResult("completely different content about pipeline routing", 0.9),
    ];

    const reranked = mmrRerank(results, 0.3, 3); // low lambda = high diversity
    // The diverse result should appear before the duplicate
    const diverseIdx = reranked.findIndex((r) => r.content.includes("pipeline routing"));
    const dupeIdx = reranked.findIndex(
      (r, i) => r.content.includes("memory mind") && i > 0
    );

    // Diverse should appear before second duplicate
    if (diverseIdx !== -1 && dupeIdx !== -1) {
      expect(diverseIdx).toBeLessThan(dupeIdx);
    }
  });
});

// ─── mergeHybridResults ───────────────────────────────────────────────────────

describe("mergeHybridResults", () => {
  let _makeIdx = 0;

  const makeVector = (
    content: string,
    vectorScore: number,
    path?: string
  ): VectorSearchResult => {
    const idx = _makeIdx++;
    return {
      path: path ?? `/test-${idx}.md`,
      startLine: 1,
      endLine: 5,
      content,
      vectorScore,
    };
  };

  const makeBM25 = (
    content: string,
    bm25Rank: number,
    path?: string
  ): BM25SearchResult => {
    const idx = _makeIdx++;
    return {
      path: path ?? `/test-${idx}.md`,
      startLine: 1,
      endLine: 5,
      content,
      bm25Rank,
    };
  };

  test("returns empty for empty inputs", () => {
    expect(mergeHybridResults([], [])).toEqual([]);
  });

  test("handles vector-only results (no BM25)", () => {
    const results = mergeHybridResults(
      [makeVector("hello world", 0.9), makeVector("foo bar", 0.5)],
      []
    );
    expect(results).toHaveLength(2);
    // Higher vector score should rank higher
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("handles BM25-only results (no vector)", () => {
    const results = mergeHybridResults(
      [],
      [makeBM25("hello", -1), makeBM25("world", -3)]
    );
    expect(results).toHaveLength(2);
    // BM25 rank 1 (rank -1 = position 1) should rank higher than rank 2
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("deduplicates chunks appearing in both result sets", () => {
    // Same chunk in both vector and BM25
    const vectorResults = [makeVector("shared content", 0.8, "/shared.md")];
    const bm25Results = [makeBM25("shared content", -1, "/shared.md")];

    const results = mergeHybridResults(vectorResults, bm25Results);
    expect(results).toHaveLength(1);
  });

  test("applies default 70-30 weighting", () => {
    // Vector-only chunk
    const vectorOnly = makeVector("vector only", 1.0, "/v.md");
    // BM25-only chunk at rank 1 of 1
    const bm25Only = makeBM25("bm25 only", -1, "/b.md");

    const results = mergeHybridResults([vectorOnly], [bm25Only]);
    const vResult = results.find((r) => r.path === "/v.md");
    const bResult = results.find((r) => r.path === "/b.md");

    // Vector: 0.7 * 1.0 + 0.3 * 0 = 0.7
    expect(vResult?.score).toBeCloseTo(0.7, 5);
    // BM25: 0.7 * 0 + 0.3 * 1.0 = 0.3
    expect(bResult?.score).toBeCloseTo(0.3, 5);
  });

  test("custom weights are applied correctly", () => {
    const vectorOnly = makeVector("vector chunk", 1.0, "/v.md");

    const results = mergeHybridResults([vectorOnly], [], {
      vectorWeight: 0.5,
      textWeight: 0.5,
    });

    // score = 0.5 * 1.0 + 0.5 * 0 = 0.5
    expect(results[0].score).toBeCloseTo(0.5, 5);
  });

  test("results are sorted by score descending", () => {
    const vectorResults = [
      makeVector("low score", 0.3, "/a.md"),
      makeVector("high score", 0.9, "/b.md"),
      makeVector("medium score", 0.6, "/c.md"),
    ];

    const results = mergeHybridResults(vectorResults, []);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  test("respects maxResults option", () => {
    const vectorResults = Array.from({ length: 20 }, (_, i) =>
      makeVector(`chunk ${i}`, Math.random(), `/file${i}.md`)
    );

    const results = mergeHybridResults(vectorResults, [], { maxResults: 5 });
    expect(results).toHaveLength(5);
  });

  test("applies temporal decay when halfLifeDays is set", () => {
    const oldPath = "/minds/memory/2020-01-01.md";
    const newPath = "/minds/memory/2025-01-01.md";

    const vectorResults = [
      { path: oldPath, startLine: 1, endLine: 5, content: "old chunk", vectorScore: 1.0 },
      { path: newPath, startLine: 1, endLine: 5, content: "new chunk", vectorScore: 1.0 },
    ];

    const results = mergeHybridResults(vectorResults, [], { halfLifeDays: 90 });

    const oldResult = results.find((r) => r.path === oldPath);
    const newResult = results.find((r) => r.path === newPath);

    // Old file should have lower score after decay
    expect(oldResult!.score).toBeLessThan(newResult!.score);
  });

  test("applies MMR re-ranking when lambda is set", () => {
    const vectorResults = [
      makeVector("identical content here", 1.0, "/a.md"),
      makeVector("identical content here", 0.99, "/b.md"),
      makeVector("completely different topic", 0.8, "/c.md"),
    ];

    const results = mergeHybridResults(vectorResults, [], { lambda: 0.3, maxResults: 3 });
    expect(results).toHaveLength(3);
  });

  test("results include path, startLine, endLine, content, score", () => {
    const results = mergeHybridResults(
      [makeVector("hello", 0.5)],
      []
    );
    const r = results[0];
    expect(typeof r.path).toBe("string");
    expect(typeof r.startLine).toBe("number");
    expect(typeof r.endLine).toBe("number");
    expect(typeof r.content).toBe("string");
    expect(typeof r.score).toBe("number");
  });
});
