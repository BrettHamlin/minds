/**
 * Unit tests for write.ts — daily log and MEMORY.md writes.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to intercept paths.ts to redirect to our temp dir.
// Since Bun resolves modules at import time, we use a workaround:
// test the functions by providing the actual mind name "memory"
// (which exists in the real repo) and then verify append behavior.
// For isolation, we test by directly exercising the exported functions
// with a mind that we've provisioned.

// Since paths.ts uses a repo-relative REPO_ROOT we can't easily override
// without a mock. Instead, we test against the real "memory" mind which
// exists in the repo. We'll use a unique date so we don't pollute logs.

import { appendDailyLog, updateMemoryMd } from "./write";
import { memoryDir, memoryMdPath, dailyLogPath } from "./paths";

// Use a future date to avoid interfering with real usage
const TEST_DATE = "2099-01-01";
const TEST_MIND = "memory"; // memory mind exists in the repo

afterEach(() => {
  // Clean up test log file if created
  const logPath = dailyLogPath(TEST_MIND, TEST_DATE);
  if (existsSync(logPath)) {
    rmSync(logPath);
  }
});

describe("appendDailyLog", () => {
  test("creates daily log file if it doesn't exist", async () => {
    const logPath = dailyLogPath(TEST_MIND, TEST_DATE);
    expect(existsSync(logPath)).toBe(false);

    await appendDailyLog(TEST_MIND, "First entry", TEST_DATE);

    expect(existsSync(logPath)).toBe(true);
  });

  test("file contains the appended content", async () => {
    await appendDailyLog(TEST_MIND, "My test content", TEST_DATE);

    const content = readFileSync(dailyLogPath(TEST_MIND, TEST_DATE), "utf8");
    expect(content).toContain("My test content");
  });

  test("appends to existing file without overwriting", async () => {
    await appendDailyLog(TEST_MIND, "Entry one", TEST_DATE);
    await appendDailyLog(TEST_MIND, "Entry two", TEST_DATE);

    const content = readFileSync(dailyLogPath(TEST_MIND, TEST_DATE), "utf8");
    expect(content).toContain("Entry one");
    expect(content).toContain("Entry two");
  });

  test("new file has date header", async () => {
    await appendDailyLog(TEST_MIND, "Any content", TEST_DATE);

    const content = readFileSync(dailyLogPath(TEST_MIND, TEST_DATE), "utf8");
    expect(content).toContain(TEST_DATE);
    expect(content).toContain(TEST_MIND);
  });

  test("timestamp included in entry", async () => {
    await appendDailyLog(TEST_MIND, "Timestamped entry", TEST_DATE);

    const content = readFileSync(dailyLogPath(TEST_MIND, TEST_DATE), "utf8");
    // Should contain an ISO timestamp comment
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("defaults to today when no date given", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayLogPath = dailyLogPath(TEST_MIND, today);

    const existed = existsSync(todayLogPath);
    await appendDailyLog(TEST_MIND, "Today entry __test__");

    expect(existsSync(todayLogPath)).toBe(true);

    // Clean up if we created it
    if (!existed) {
      // Read and verify, then remove our test entry
      const content = readFileSync(todayLogPath, "utf8");
      expect(content).toContain("Today entry __test__");
      // Remove the log only if we created it (not pre-existing)
      rmSync(todayLogPath);
    }
  });
});

describe("updateMemoryMd", () => {
  test("writes content to MEMORY.md", async () => {
    const mdPath = memoryMdPath(TEST_MIND);
    const original = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null;

    const newContent = "# Test Memory\n\nTest content.";
    await updateMemoryMd(TEST_MIND, newContent);

    const content = readFileSync(mdPath, "utf8");
    expect(content).toBe(newContent);

    // Restore original if it existed
    if (original !== null) {
      writeFileSync(mdPath, original, "utf8");
    }
  });

  test("replaces existing content (not appends)", async () => {
    const mdPath = memoryMdPath(TEST_MIND);
    const original = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null;

    await updateMemoryMd(TEST_MIND, "First content");
    await updateMemoryMd(TEST_MIND, "Second content");

    const content = readFileSync(mdPath, "utf8");
    expect(content).toBe("Second content");
    expect(content).not.toContain("First content");

    // Restore
    if (original !== null) {
      writeFileSync(mdPath, original, "utf8");
    }
  });
});
