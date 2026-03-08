// smoke-marker.test.ts — Tests for smoke-marker.ts (BRE-454 T005)
//
// Verifies:
//   - result JSON is written to the output path
//   - JSON has the expected shape { phase, ticket, timestamp, status }
//   - Uses a separate test output path to avoid polluting smoke-result.json

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runSmokeMarker, type SmokeResult } from "./smoke-marker.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempOutputPath(): string {
  return join(tmpdir(), `smoke-result-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const createdPaths: string[] = [];

afterEach(() => {
  for (const p of createdPaths.splice(0)) {
    try { rmSync(p, { force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSmokeMarker — result JSON shape", () => {
  test("writes result JSON to the output path", async () => {
    const outputPath = tempOutputPath();
    createdPaths.push(outputPath);

    await runSmokeMarker(outputPath);

    expect(existsSync(outputPath)).toBe(true);
  });

  test("result JSON has phase = 'transport'", async () => {
    const outputPath = tempOutputPath();
    createdPaths.push(outputPath);

    await runSmokeMarker(outputPath);

    const result = JSON.parse(readFileSync(outputPath, "utf8")) as SmokeResult;
    expect(result.phase).toBe("transport");
  });

  test("result JSON has ticket = 'BRE-454'", async () => {
    const outputPath = tempOutputPath();
    createdPaths.push(outputPath);

    await runSmokeMarker(outputPath);

    const result = JSON.parse(readFileSync(outputPath, "utf8")) as SmokeResult;
    expect(result.ticket).toBe("BRE-454");
  });

  test("result JSON has a valid ISO timestamp", async () => {
    const outputPath = tempOutputPath();
    createdPaths.push(outputPath);

    await runSmokeMarker(outputPath);

    const result = JSON.parse(readFileSync(outputPath, "utf8")) as SmokeResult;
    expect(typeof result.timestamp).toBe("string");
    expect(isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  test("result JSON has status = 'complete' when smoke-probe exits 0", async () => {
    const outputPath = tempOutputPath();
    createdPaths.push(outputPath);

    await runSmokeMarker(outputPath);

    const result = JSON.parse(readFileSync(outputPath, "utf8")) as SmokeResult;
    expect(result.status).toBe("complete");
  });

  test("result JSON has all required keys", async () => {
    const outputPath = tempOutputPath();
    createdPaths.push(outputPath);

    await runSmokeMarker(outputPath);

    const result = JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["phase", "status", "ticket", "timestamp"].sort());
  });
});
