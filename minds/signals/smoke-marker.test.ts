// smoke-marker.test.ts — tests for smoke-marker.ts (BRE-454 T004)

import { describe, it, expect, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { runSmokeMarker, type SmokeResult } from "./smoke-marker";

const RESULT_PATH = join(import.meta.dir, "smoke-result.test.json");

afterEach(() => {
  if (existsSync(RESULT_PATH)) {
    unlinkSync(RESULT_PATH);
  }
});

describe("smoke-marker", () => {
  it("writes result JSON with expected shape", async () => {
    const result = await runSmokeMarker("signals", "BRE-454", RESULT_PATH);

    expect(result.phase).toBe("signals");
    expect(result.ticket).toBe("BRE-454");
    expect(result.status).toBe("complete");
    expect(typeof result.timestamp).toBe("string");
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it("writes result JSON file to disk", async () => {
    await runSmokeMarker("signals", "BRE-454", RESULT_PATH);

    expect(existsSync(RESULT_PATH)).toBe(true);

    const raw = await Bun.file(RESULT_PATH).text();
    const parsed: SmokeResult = JSON.parse(raw);

    expect(parsed.phase).toBe("signals");
    expect(parsed.ticket).toBe("BRE-454");
    expect(parsed.status).toBe("complete");
    expect(typeof parsed.timestamp).toBe("string");
  });
});
