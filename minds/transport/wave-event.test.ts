import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { publishWaveStarted, publishWaveComplete } from "./wave-event.ts";
import { MindsEventType } from "./minds-events.ts";
import { join } from "path";

const WAVE_EVENT_CLI = join(import.meta.dir, "wave-event.ts");

function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", WAVE_EVENT_CLI, ...args]);
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// ---------------------------------------------------------------------------
// wave-event.ts — unit tests
// ---------------------------------------------------------------------------

describe("wave-event: publishWaveStarted()", () => {
  let publishedCalls: Array<{ busUrl: string; channel: string; type: string; payload: unknown }> = [];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    publishedCalls = [];
    originalFetch = global.fetch;
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}");
      publishedCalls.push({
        busUrl: url.replace("/publish", ""),
        channel: body.channel,
        type: body.type,
        payload: body.payload,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("1. publishes WAVE_STARTED with correct payload", async () => {
    await publishWaveStarted("http://localhost:7777", "minds-BRE-456", "wave-1234");

    expect(publishedCalls).toHaveLength(1);
    expect(publishedCalls[0].type).toBe(MindsEventType.WAVE_STARTED);
    expect(publishedCalls[0].channel).toBe("minds-BRE-456");
    expect(publishedCalls[0].payload).toEqual({ waveId: "wave-1234" });
  });

  test("2. uses correct bus URL", async () => {
    await publishWaveStarted("http://localhost:9999", "minds-BRE-456", "wave-5678");

    expect(publishedCalls[0].busUrl).toBe("http://localhost:9999");
  });
});

describe("wave-event: publishWaveComplete()", () => {
  let publishedCalls: Array<{ busUrl: string; channel: string; type: string; payload: unknown }> = [];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    publishedCalls = [];
    originalFetch = global.fetch;
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}");
      publishedCalls.push({
        busUrl: url.replace("/publish", ""),
        channel: body.channel,
        type: body.type,
        payload: body.payload,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("3. publishes WAVE_COMPLETE with correct payload", async () => {
    await publishWaveComplete("http://localhost:7777", "minds-BRE-456", "wave-1234");

    expect(publishedCalls).toHaveLength(1);
    expect(publishedCalls[0].type).toBe(MindsEventType.WAVE_COMPLETE);
    expect(publishedCalls[0].channel).toBe("minds-BRE-456");
    expect(publishedCalls[0].payload).toEqual({ waveId: "wave-1234" });
  });

  test("4. start and complete use different event types", async () => {
    await publishWaveStarted("http://localhost:7777", "minds-BRE-456", "wave-1234");
    await publishWaveComplete("http://localhost:7777", "minds-BRE-456", "wave-1234");

    expect(publishedCalls).toHaveLength(2);
    expect(publishedCalls[0].type).toBe(MindsEventType.WAVE_STARTED);
    expect(publishedCalls[1].type).toBe(MindsEventType.WAVE_COMPLETE);
  });
});

// ---------------------------------------------------------------------------
// CLI error-path tests (T003 + T004)
// Tests the import.meta.main block via subprocess spawn
// ---------------------------------------------------------------------------

describe("wave-event CLI: error paths", () => {
  test("5. exits 1 with JSON error when no args provided", () => {
    const { exitCode, stderr } = runCli([]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty("error");
    expect(typeof parsed.error).toBe("string");
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  test("6. exits 1 with JSON error when subcommand is missing (only flags)", () => {
    const { exitCode, stderr } = runCli([
      "--bus-url", "http://localhost:7777",
      "--channel", "minds-BRE-456",
      "--wave-id", "wave-1234",
    ]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty("error");
  });

  test("7. exits 1 with JSON error when --bus-url is missing", () => {
    const { exitCode, stderr } = runCli([
      "start",
      "--channel", "minds-BRE-456",
      "--wave-id", "wave-1234",
    ]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty("error");
  });

  test("8. exits 1 with JSON error when --channel is missing", () => {
    const { exitCode, stderr } = runCli([
      "start",
      "--bus-url", "http://localhost:7777",
      "--wave-id", "wave-1234",
    ]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty("error");
  });

  test("9. exits 1 with JSON error when --wave-id is missing", () => {
    const { exitCode, stderr } = runCli([
      "start",
      "--bus-url", "http://localhost:7777",
      "--channel", "minds-BRE-456",
    ]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty("error");
  });

  test("10. exits 1 with JSON error for invalid subcommand", () => {
    const { exitCode, stderr } = runCli([
      "invalid",
      "--bus-url", "http://localhost:7777",
      "--channel", "minds-BRE-456",
      "--wave-id", "wave-1234",
    ]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toContain("invalid");
  });

  test("11. error message includes usage hint when required args absent", () => {
    const { exitCode, stderr } = runCli([]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error).toContain("Usage");
  });
});
