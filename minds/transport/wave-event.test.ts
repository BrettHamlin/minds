import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { publishWaveStarted, publishWaveComplete } from "./wave-event.ts";
import { MindsEventType } from "./minds-events.ts";

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
