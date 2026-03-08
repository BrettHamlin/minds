// smoke-marker.test.ts — Tests for smoke-marker.ts (BRE-454 T003)

import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";

const RESULT_PATH = join(import.meta.dir, "smoke-result.json");

beforeEach(() => {
  if (existsSync(RESULT_PATH)) {
    unlinkSync(RESULT_PATH);
  }
});

describe("smoke-marker", () => {
  it("writes smoke-result.json with expected shape", async () => {
    const proc = Bun.spawn(["bun", "minds/pipeline_core/smoke-marker.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    expect(existsSync(RESULT_PATH)).toBe(true);

    const raw = readFileSync(RESULT_PATH, "utf8");
    const result = JSON.parse(raw);

    expect(result).toHaveProperty("phase", "pipeline_core");
    expect(result).toHaveProperty("ticket", "BRE-454");
    expect(result).toHaveProperty("status", "complete");
    expect(result).toHaveProperty("timestamp");
    expect(typeof result.timestamp).toBe("string");
    // Validate ISO 8601 format
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it("result JSON has no extra fields beyond expected shape", async () => {
    const proc = Bun.spawn(["bun", "minds/pipeline_core/smoke-marker.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    const raw = readFileSync(RESULT_PATH, "utf8");
    const result = JSON.parse(raw);
    const keys = Object.keys(result).sort();

    expect(keys).toEqual(["phase", "status", "ticket", "timestamp"]);
  });
});
