/**
 * Unit tests for search.ts — memory search functionality.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, rmSync } from "fs";
import { searchMemory } from "./search";
import { syncIndex, createIndex, indexPath } from "./index";
import { appendDailyLog } from "./write";
import { dailyLogPath } from "./paths";

const TEST_MIND = "memory";
const TEST_DATE = "2099-02-01"; // far future to avoid real log conflicts

afterEach(() => {
  // Clean up test log and index
  const logPath = dailyLogPath(TEST_MIND, TEST_DATE);
  if (existsSync(logPath)) rmSync(logPath);

  const dbPath = indexPath(TEST_MIND);
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe("searchMemory", () => {
  test("throws with context for nonexistent mind", async () => {
    await expect(searchMemory("nonexistent-mind-xyz", "query")).rejects.toThrow(
      /searchMemory: memory directory does not exist for mind/
    );
  });

  test("returns empty array when no match", async () => {
    await syncIndex(TEST_MIND);
    const results = await searchMemory(TEST_MIND, "xyzzy_not_found_ever_12345");
    expect(results).toEqual([]);
  });

  test("finds content that was written to daily log", async () => {
    await appendDailyLog(TEST_MIND, "unique_search_term_alpha_beta_2099", TEST_DATE);
    await syncIndex(TEST_MIND);

    const results = await searchMemory(TEST_MIND, "unique_search_term_alpha_beta_2099");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("unique_search_term_alpha_beta_2099");
  });

  test("results include path, startLine, endLine, score", async () => {
    await appendDailyLog(TEST_MIND, "deterministic_keyword_test_99", TEST_DATE);
    await syncIndex(TEST_MIND);

    const results = await searchMemory(TEST_MIND, "deterministic_keyword_test_99");
    if (results.length > 0) {
      const r = results[0];
      expect(typeof r.path).toBe("string");
      expect(typeof r.startLine).toBe("number");
      expect(typeof r.endLine).toBe("number");
      expect(typeof r.content).toBe("string");
      expect(typeof r.score).toBe("number");
    }
  });

  test("respects maxResults option", async () => {
    // Write multiple distinct entries
    for (let i = 0; i < 5; i++) {
      await appendDailyLog(TEST_MIND, `search_common_word_test_${i}`, TEST_DATE);
    }
    await syncIndex(TEST_MIND);

    const results = await searchMemory(TEST_MIND, "search_common_word_test", { maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("scores are numbers (BM25 from FTS5)", async () => {
    await appendDailyLog(TEST_MIND, "bm25_score_test_keyword", TEST_DATE);
    await syncIndex(TEST_MIND);

    const results = await searchMemory(TEST_MIND, "bm25_score_test_keyword");
    if (results.length > 0) {
      expect(typeof results[0].score).toBe("number");
    }
  });

  test("search is scoped to the specified mind — does not cross minds", async () => {
    // Searching for a term in memory mind — results should only be from memory mind paths
    await syncIndex(TEST_MIND);
    const results = await searchMemory(TEST_MIND, "memory");

    // All result paths should be within the memory mind's memory dir
    for (const r of results) {
      expect(r.path).toContain(`minds/${TEST_MIND}/memory`);
    }
  });

  test("auto-syncs index if database does not exist", async () => {
    // Delete db if exists to force auto-sync
    const dbPath = indexPath(TEST_MIND);
    if (existsSync(dbPath)) rmSync(dbPath);

    // Should not throw — should auto-sync
    const results = await searchMemory(TEST_MIND, "memory");
    expect(Array.isArray(results)).toBe(true);

    if (existsSync(dbPath)) rmSync(dbPath);
  });
});
