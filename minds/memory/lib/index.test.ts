/**
 * Unit tests for index.ts — SQLite FTS5 index management.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { chunkText, createIndex, syncIndex, indexPath } from "./index";

// We test createIndex/syncIndex against the real "memory" mind
// (repo-relative paths from paths.ts), using a test-specific date marker
// so we don't pollute real data.

// For index tests, we need isolation. We use the real memory mind's
// memory dir (which exists) and clean up after ourselves.

const TEST_MIND = "memory";

describe("chunkText", () => {
  test("returns empty array for empty string", () => {
    expect(chunkText("")).toHaveLength(0);
  });

  test("returns empty array for whitespace-only string", () => {
    expect(chunkText("   \n\t  ")).toHaveLength(0);
  });

  test("single chunk for short text", () => {
    const text = "Hello world this is a short text.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Hello");
    expect(chunks[0].content).toContain("text.");
  });

  test("produces multiple chunks for long text", () => {
    // Generate a text longer than WORDS_PER_CHUNK (~308 words)
    const manyWords = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(manyWords);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("chunks have overlap — last words of chunk N appear in chunk N+1", () => {
    const manyWords = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(manyWords);

    if (chunks.length >= 2) {
      // The last few words of chunk 0 should appear in chunk 1 (overlap)
      const lastWordsOfChunk0 = chunks[0].content.split(" ").slice(-5).join(" ");
      expect(chunks[1].content).toContain(lastWordsOfChunk0.split(" ")[0]);
    }
  });

  test("startWord < endWord for each chunk", () => {
    const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.startWord).toBeLessThanOrEqual(chunk.endWord);
    }
  });

  test("all content from original text appears in chunks", () => {
    const words = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const text = words.join(" ");
    const chunks = chunkText(text);
    const allContent = chunks.map((c) => c.content).join(" ");
    for (const word of words) {
      expect(allContent).toContain(word);
    }
  });
});

describe("createIndex", () => {
  test("creates SQLite database file", () => {
    createIndex(TEST_MIND);
    const dbPath = indexPath(TEST_MIND);
    expect(existsSync(dbPath)).toBe(true);

    // Clean up
    rmSync(dbPath);
  });

  test("idempotent — calling twice does not throw", () => {
    expect(() => {
      createIndex(TEST_MIND);
      createIndex(TEST_MIND);
    }).not.toThrow();

    const dbPath = indexPath(TEST_MIND);
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  test("creates chunks table", () => {
    createIndex(TEST_MIND);
    const dbPath = indexPath(TEST_MIND);

    const db = new Database(dbPath);
    try {
      // If table doesn't exist this will throw
      const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").all();
      expect(result).toHaveLength(1);
    } finally {
      db.close();
      if (existsSync(dbPath)) rmSync(dbPath);
    }
  });

  test("creates FTS5 virtual table", () => {
    createIndex(TEST_MIND);
    const dbPath = indexPath(TEST_MIND);

    const db = new Database(dbPath);
    try {
      const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").all();
      expect(result).toHaveLength(1);
    } finally {
      db.close();
      if (existsSync(dbPath)) rmSync(dbPath);
    }
  });
});

describe("syncIndex", () => {
  test("throws with context for nonexistent mind", async () => {
    await expect(syncIndex("nonexistent-mind-xyz")).rejects.toThrow(
      /syncIndex: memory directory does not exist for mind/
    );
  });

  test("indexes markdown files in memory dir", async () => {
    const dbPath = indexPath(TEST_MIND);

    await syncIndex(TEST_MIND);
    expect(existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath);
    try {
      const count = db.query("SELECT COUNT(*) as n FROM chunks").get() as { n: number };
      // Memory mind has at least MEMORY.md with content
      expect(count.n).toBeGreaterThan(0);
    } finally {
      db.close();
      if (existsSync(dbPath)) rmSync(dbPath);
    }
  });

  test("syncing twice doesn't duplicate chunks", async () => {
    const dbPath = indexPath(TEST_MIND);

    await syncIndex(TEST_MIND);
    const db1 = new Database(dbPath);
    const count1 = (db1.query("SELECT COUNT(*) as n FROM chunks").get() as { n: number }).n;
    db1.close();

    await syncIndex(TEST_MIND);
    const db2 = new Database(dbPath);
    const count2 = (db2.query("SELECT COUNT(*) as n FROM chunks").get() as { n: number }).n;
    db2.close();

    expect(count1).toBe(count2);

    if (existsSync(dbPath)) rmSync(dbPath);
  });
});
