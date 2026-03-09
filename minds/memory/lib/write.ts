/**
 * write.ts — Memory write operations for per-Mind memory directories.
 *
 * appendDailyLog: append-only write to YYYY-MM-DD.md daily log.
 * updateMemoryMd: replace curated MEMORY.md content.
 *
 * Daily logs are ALWAYS append-only — never truncated or overwritten.
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { memoryDir, memoryMdPath, dailyLogPath } from "./paths.js";

/**
 * Appends content to a Mind's daily log file.
 * Creates the file (and memory dir) if they don't exist.
 * Daily logs are append-only — existing content is never modified.
 *
 * @param mindName - Name of the Mind
 * @param content - Text content to append
 * @param date - ISO date string (YYYY-MM-DD). Defaults to today.
 */
export async function appendDailyLog(mindName: string, content: string, date?: string): Promise<void> {
  const dir = memoryDir(mindName);
  const logPath = dailyLogPath(mindName, date);

  // Ensure memory directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Build the log entry with a timestamp header if file doesn't exist yet
  const timestamp = new Date().toISOString();
  const isNewFile = !existsSync(logPath);

  if (isNewFile) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const header = `# ${mindName} Daily Log — ${day}\n\n`;
    writeFileSync(logPath, header, "utf8");
  }

  // Append content with a separator
  const entry = `\n---\n<!-- ${timestamp} -->\n\n${content}\n`;
  appendFileSync(logPath, entry, "utf8");
}

/**
 * Replaces the curated MEMORY.md content for a Mind.
 * Creates the memory dir if it doesn't exist.
 *
 * @param mindName - Name of the Mind
 * @param content - Full new content for MEMORY.md
 */
export async function updateMemoryMd(mindName: string, content: string): Promise<void> {
  const dir = memoryDir(mindName);
  const mdPath = memoryMdPath(mindName);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(mdPath, content, "utf8");
}
