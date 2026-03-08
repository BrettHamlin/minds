/**
 * Unit tests for paths.ts — deterministic path resolution.
 */

import { describe, test, expect } from "bun:test";
import { memoryDir, memoryMdPath, dailyLogPath } from "./paths";

describe("memoryDir", () => {
  test("returns path ending with minds/{name}/memory", () => {
    const result = memoryDir("pipeline_core");
    expect(result).toMatch(/minds[/\\]pipeline_core[/\\]memory$/);
  });

  test("different mind names produce different paths", () => {
    const a = memoryDir("execution");
    const b = memoryDir("spec_api");
    expect(a).not.toBe(b);
    expect(a).toMatch(/minds[/\\]execution[/\\]memory$/);
    expect(b).toMatch(/minds[/\\]spec_api[/\\]memory$/);
  });

  test("path does not include trailing slash", () => {
    const result = memoryDir("clarify");
    expect(result).not.toMatch(/[/\\]$/);
  });
});

describe("memoryMdPath", () => {
  test("returns path ending with MEMORY.md", () => {
    const result = memoryMdPath("pipeline_core");
    expect(result).toMatch(/MEMORY\.md$/);
  });

  test("is inside the mind's memory dir", () => {
    const dir = memoryDir("execution");
    const mdPath = memoryMdPath("execution");
    expect(mdPath.startsWith(dir)).toBe(true);
  });

  test("different minds produce different paths", () => {
    expect(memoryMdPath("clarify")).not.toBe(memoryMdPath("execution"));
  });
});

describe("dailyLogPath", () => {
  test("uses provided date", () => {
    const result = dailyLogPath("pipeline_core", "2026-03-08");
    expect(result).toMatch(/2026-03-08\.md$/);
  });

  test("defaults to today when no date given", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = dailyLogPath("pipeline_core");
    expect(result).toMatch(new RegExp(`${today}\\.md$`));
  });

  test("is inside the mind's memory dir", () => {
    const dir = memoryDir("execution");
    const logPath = dailyLogPath("execution", "2026-01-01");
    expect(logPath.startsWith(dir)).toBe(true);
  });

  test("different dates produce different paths", () => {
    const a = dailyLogPath("execution", "2026-03-01");
    const b = dailyLogPath("execution", "2026-03-08");
    expect(a).not.toBe(b);
  });

  test("date format is YYYY-MM-DD", () => {
    const result = dailyLogPath("memory", "2026-12-31");
    expect(result).toMatch(/2026-12-31\.md$/);
  });
});
