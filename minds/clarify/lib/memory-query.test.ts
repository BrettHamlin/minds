/**
 * Unit tests for minds/clarify/lib/memory-query.ts
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { SearchResult } from "../../memory/lib/search.js";

// ── Mock setup ─────────────────────────────────────────────────────────────────
// Must be declared before dynamic import of the module under test.

const mockSearchMemory = mock(
  async (_mindName: string, _query: string, _opts?: unknown): Promise<SearchResult[]> => []
);

mock.module("../../memory/lib/search.js", () => ({
  searchMemory: mockSearchMemory,
}));

// Import module under test AFTER mock is registered so it receives the mock.
const { queryMemoryForAmbiguity } = await import("./memory-query.js");

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeResult(score: number, content: string): SearchResult {
  return {
    path: "minds/clarify/memory/2026-03-08.md",
    startLine: 1,
    endLine: 5,
    content,
    score,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("queryMemoryForAmbiguity()", () => {
  beforeEach(() => {
    mockSearchMemory.mockReset();
  });

  it("calls searchMemory with correct args", async () => {
    mockSearchMemory.mockResolvedValueOnce([]);
    await queryMemoryForAmbiguity("clarify", "What auth strategy to use?");
    expect(mockSearchMemory).toHaveBeenCalledTimes(1);
    expect(mockSearchMemory).toHaveBeenCalledWith(
      "clarify",
      "What auth strategy to use?",
      { maxResults: 5 }
    );
  });

  it("classifies result as direct when score > 0.7 and content has Q/A format", async () => {
    const result = makeResult(
      0.85,
      "BRE-400: Q: What auth strategy to use? → A: Use JWT. Reasoning: Existing pattern."
    );
    mockSearchMemory.mockResolvedValueOnce([result]);

    const matches = await queryMemoryForAmbiguity("clarify", "auth strategy");

    expect(matches).toHaveLength(1);
    expect(matches[0].classification).toBe("direct");
    expect(matches[0].score).toBe(0.85);
    expect(matches[0].result).toBe(result);
  });

  it("classifies result as partial when score is between 0.3 and 0.7", async () => {
    const result = makeResult(0.5, "Some related content about authentication patterns");
    mockSearchMemory.mockResolvedValueOnce([result]);

    const matches = await queryMemoryForAmbiguity("clarify", "auth patterns");

    expect(matches).toHaveLength(1);
    expect(matches[0].classification).toBe("partial");
    expect(matches[0].score).toBe(0.5);
  });

  it("classifies high-score result without Q/A format as partial", async () => {
    const result = makeResult(0.9, "Auth strategy discussion without Q/A format present");
    mockSearchMemory.mockResolvedValueOnce([result]);

    const matches = await queryMemoryForAmbiguity("clarify", "auth strategy");

    expect(matches).toHaveLength(1);
    expect(matches[0].classification).toBe("partial");
  });

  it("filters out results with score below 0.3", async () => {
    const lowScore = makeResult(0.1, "Q: Unrelated question → A: Unrelated answer");
    const goodScore = makeResult(0.5, "Relevant content about the ambiguity");
    mockSearchMemory.mockResolvedValueOnce([lowScore, goodScore]);

    const matches = await queryMemoryForAmbiguity("clarify", "relevant query");

    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBe(0.5);
  });

  it("returns empty array when no results above threshold", async () => {
    mockSearchMemory.mockResolvedValueOnce([
      makeResult(0.2, "Low relevance content"),
      makeResult(0.05, "Very low relevance content"),
    ]);

    const matches = await queryMemoryForAmbiguity("clarify", "anything");

    expect(matches).toEqual([]);
  });

  it("returns empty array and does not throw when memory directory does not exist", async () => {
    mockSearchMemory.mockRejectedValueOnce(
      new Error(
        'searchMemory: memory directory does not exist for mind "clarify" at "/some/path"'
      )
    );

    const matches = await queryMemoryForAmbiguity("clarify", "any query");

    expect(matches).toEqual([]);
  });

  it("re-throws non-memory-directory errors", async () => {
    mockSearchMemory.mockRejectedValueOnce(new Error("disk read error"));

    await expect(
      queryMemoryForAmbiguity("clarify", "any query")
    ).rejects.toThrow(/queryMemoryForAmbiguity: search failed for mind "clarify"/);
  });

  it("returns empty array when searchMemory returns no results", async () => {
    mockSearchMemory.mockResolvedValueOnce([]);

    const matches = await queryMemoryForAmbiguity("clarify", "any query");

    expect(matches).toEqual([]);
  });
});
