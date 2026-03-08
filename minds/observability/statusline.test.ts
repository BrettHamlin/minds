// BRE-432: statusline duration display and formatElapsed tests
import { describe, test, expect, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { render, formatElapsed } from "./statusline";

// ============================================================================
// Unit tests: formatElapsed
// ============================================================================

describe("formatElapsed", () => {
  test("formats seconds only", () => {
    expect(formatElapsed(45_000)).toBe("45s");
  });

  test("formats zero seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
  });

  test("formats minutes", () => {
    expect(formatElapsed(120_000)).toBe("2m");
  });

  test("formats minutes ignoring remaining seconds", () => {
    expect(formatElapsed(150_000)).toBe("2m");
  });

  test("formats hours and minutes", () => {
    expect(formatElapsed(3_900_000)).toBe("1h 5m");
  });

  test("handles negative values", () => {
    expect(formatElapsed(-1000)).toBe("0s");
  });

  test("sub-second rounds to 0s", () => {
    expect(formatElapsed(500)).toBe("0s");
  });
});

// ============================================================================
// Unit tests: render with duration
// ============================================================================

describe("render — duration in statusline", () => {
  let tmpDir: string;

  function writeCacheFile(data: object): string {
    tmpDir = join(tmpdir(), `sl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const cachePath = join(tmpDir, "status-cache.json");
    writeFileSync(cachePath, JSON.stringify(data));
    return cachePath;
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("includes elapsed time when startedAt is present", () => {
    const fiveMinutesAgo = new Date(Date.now() - 300_000).toISOString();
    const cachePath = writeCacheFile({
      pipelines: [{
        ticketId: "BRE-100",
        phase: "impl",
        status: "running",
        detail: "building",
        startedAt: fiveMinutesAgo,
      }],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });

    const result = render(cachePath);
    expect(result).toContain("BRE-100 impl ▸ building");
    expect(result).toMatch(/\(5m\)/);
  });

  test("omits elapsed time when startedAt is absent", () => {
    const cachePath = writeCacheFile({
      pipelines: [{
        ticketId: "BRE-101",
        phase: "plan",
        status: "running",
        detail: "planning",
      }],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });

    const result = render(cachePath);
    expect(result).toBe("BRE-101 plan ▸ planning");
    expect(result).not.toContain("(");
  });

  test("shows hours for long-running pipelines", () => {
    const twoHoursAgo = new Date(Date.now() - 7_500_000).toISOString(); // 2h 5m
    const cachePath = writeCacheFile({
      pipelines: [{
        ticketId: "BRE-102",
        phase: "impl",
        status: "running",
        detail: "building",
        startedAt: twoHoursAgo,
      }],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });

    const result = render(cachePath);
    expect(result).toMatch(/\(2h 5m\)/);
  });

  test("renders multiple pipelines with durations", () => {
    const now = Date.now();
    const cachePath = writeCacheFile({
      pipelines: [
        {
          ticketId: "BRE-200",
          phase: "impl",
          status: "running",
          detail: "coding",
          startedAt: new Date(now - 60_000).toISOString(),
        },
        {
          ticketId: "BRE-201",
          phase: "plan",
          status: "running",
          detail: "planning",
        },
      ],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });

    const result = render(cachePath);
    expect(result).toContain("BRE-200 impl ▸ coding (1m)");
    expect(result).toContain("BRE-201 plan ▸ planning");
    expect(result).toContain(" | ");
  });
});
