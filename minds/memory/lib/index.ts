/**
 * index.ts — SQLite FTS5 index management for per-Mind memory.
 *
 * createIndex: creates the SQLite database + FTS5 table for a Mind.
 * syncIndex: re-indexes all markdown files in a Mind's memory directory.
 *
 * Chunks markdown into ~400 token segments with 80-token overlap.
 * Stores chunks in SQLite with FTS5 for BM25 keyword search.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import { memoryDir } from "./paths.js";

/** Approximate tokens per word (heuristic: 1 word ≈ 1.3 tokens). */
const WORDS_PER_CHUNK = Math.round(400 / 1.3); // ~308 words
const WORDS_OVERLAP = Math.round(80 / 1.3);    // ~61 words

/** A single indexed chunk from a markdown file. */
export interface MemoryChunk {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

/** Returns the path to the SQLite index file for a Mind. */
export function indexPath(mindName: string): string {
  return join(memoryDir(mindName), ".index.db");
}

/**
 * Creates the SQLite database and FTS5 virtual table for a Mind's memory index.
 * Idempotent: safe to call if the database already exists.
 *
 * @param mindName - Name of the Mind
 */
export function createIndex(mindName: string): void {
  const dir = memoryDir(mindName);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(indexPath(mindName));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content='chunks',
        content_rowid='id',
        tokenize='porter ascii'
      );

      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);
  } finally {
    db.close();
  }
}

/**
 * Splits text into overlapping chunks of approximately WORDS_PER_CHUNK words.
 * Uses 80-token (WORDS_OVERLAP words) overlap between consecutive chunks.
 *
 * @param text - Full text content to chunk
 * @returns Array of {words, startWord, endWord} chunks
 */
export function chunkText(text: string): Array<{ content: string; startWord: number; endWord: number }> {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const chunks: Array<{ content: string; startWord: number; endWord: number }> = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + WORDS_PER_CHUNK, words.length);
    const chunkWords = words.slice(start, end);
    chunks.push({
      content: chunkWords.join(" "),
      startWord: start,
      endWord: end - 1,
    });

    if (end >= words.length) break;
    start = end - WORDS_OVERLAP;
    if (start < 0) start = 0;
  }

  return chunks;
}

/**
 * Maps a word offset to an approximate line number in the original text.
 */
function wordOffsetToLine(text: string, wordOffset: number): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let charCount = 0;
  let wordCount = 0;

  for (let i = 0; i < text.length; i++) {
    if (/\S/.test(text[i])) {
      // start of a word
      if (wordCount === wordOffset) {
        return text.slice(0, i).split("\n").length;
      }
      // skip to end of word
      while (i < text.length && /\S/.test(text[i])) i++;
      wordCount++;
      i--; // compensate for loop increment
    }
  }
  return text.split("\n").length;
}

/**
 * Re-indexes all markdown files in a Mind's memory directory.
 * Clears existing chunks for changed files and re-inserts them.
 * Skips the SQLite index file itself (.index.db).
 *
 * @param mindName - Name of the Mind
 */
export async function syncIndex(mindName: string): Promise<void> {
  const dir = memoryDir(mindName);
  if (!existsSync(dir)) {
    throw new Error(`syncIndex: memory directory does not exist for mind "${mindName}" at "${dir}"`);
  }

  // Ensure index exists
  createIndex(mindName);

  const db = new Database(indexPath(mindName));
  try {
    // Get all markdown files
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = join(dir, file);
      const text = readFileSync(filePath, "utf8");

      // Clear existing chunks for this file
      db.run("DELETE FROM chunks WHERE path = ?", [filePath]);

      // Chunk and insert
      const chunks = chunkText(text);
      const lines = text.split("\n");

      for (const chunk of chunks) {
        const startLine = wordOffsetToLine(text, chunk.startWord);
        const endLine = wordOffsetToLine(text, chunk.endWord);
        db.run(
          "INSERT INTO chunks (path, start_line, end_line, content) VALUES (?, ?, ?, ?)",
          [filePath, startLine, endLine, chunk.content]
        );
      }
    }
  } finally {
    db.close();
  }
}
