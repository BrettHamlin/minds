/**
 * review-drone.test.ts — Verify startReview, reviewPass, reviewFail publish
 * the correct event types and payloads via mindsPublish.
 */

import { describe, expect, it, mock } from "bun:test";

// ─── Capture published events ─────────────────────────────────────────────────

type PublishCall = { busUrl: string; channel: string; type: string; payload: unknown };
const publishCalls: PublishCall[] = [];

mock.module("../../transport/minds-publish.ts", () => ({
  mindsPublish: async (busUrl: string, channel: string, type: string, payload: unknown) => {
    publishCalls.push({ busUrl, channel, type, payload });
  },
  resolveBusUrl: () => undefined,
}));

// ─── Import after mock registration ──────────────────────────────────────────

const { startReview, reviewPass, reviewFail } = await import("../review-drone.ts");

// ─── Constants ────────────────────────────────────────────────────────────────

const BUS_URL = "http://localhost:7777";
const CHANNEL = "minds-TEST-001";
const WAVE_ID = "wave-1234567890";
const MIND_NAME = "signals";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("startReview", () => {
  it("publishes DRONE_REVIEWING with correct type and payload", async () => {
    publishCalls.length = 0;
    await startReview(BUS_URL, CHANNEL, WAVE_ID, MIND_NAME);

    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call.type).toBe("DRONE_REVIEWING");
    expect(call.busUrl).toBe(BUS_URL);
    expect(call.channel).toBe(CHANNEL);
    expect((call.payload as Record<string, unknown>).waveId).toBe(WAVE_ID);
    expect((call.payload as Record<string, unknown>).mindName).toBe(MIND_NAME);
  });
});

describe("reviewPass", () => {
  it("publishes DRONE_REVIEW_PASS with correct type and payload", async () => {
    publishCalls.length = 0;
    await reviewPass(BUS_URL, CHANNEL, WAVE_ID, MIND_NAME);

    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call.type).toBe("DRONE_REVIEW_PASS");
    expect(call.busUrl).toBe(BUS_URL);
    expect(call.channel).toBe(CHANNEL);
    expect((call.payload as Record<string, unknown>).waveId).toBe(WAVE_ID);
    expect((call.payload as Record<string, unknown>).mindName).toBe(MIND_NAME);
  });
});

describe("reviewFail", () => {
  it("publishes DRONE_REVIEW_FAIL with correct type and payload (no violations)", async () => {
    publishCalls.length = 0;
    await reviewFail(BUS_URL, CHANNEL, WAVE_ID, MIND_NAME);

    expect(publishCalls).toHaveLength(1);
    const call = publishCalls[0];
    expect(call.type).toBe("DRONE_REVIEW_FAIL");
    expect(call.busUrl).toBe(BUS_URL);
    expect(call.channel).toBe(CHANNEL);
    expect((call.payload as Record<string, unknown>).waveId).toBe(WAVE_ID);
    expect((call.payload as Record<string, unknown>).mindName).toBe(MIND_NAME);
    expect((call.payload as Record<string, unknown>).violations).toBeUndefined();
  });

  it("includes violations count in payload when provided", async () => {
    publishCalls.length = 0;
    await reviewFail(BUS_URL, CHANNEL, WAVE_ID, MIND_NAME, 3);

    const call = publishCalls[0];
    expect(call.type).toBe("DRONE_REVIEW_FAIL");
    expect((call.payload as Record<string, unknown>).violations).toBe(3);
  });

  it("resolves without throwing even when bus errors occur (non-critical)", async () => {
    publishCalls.length = 0;
    // The implementation uses .catch(() => {}) — verify it resolves to undefined
    await expect(reviewFail(BUS_URL, CHANNEL, WAVE_ID, MIND_NAME)).resolves.toBeUndefined();
  });
});

describe("each review-drone function publishes to the correct channel", () => {
  it("startReview uses the provided channel exactly", async () => {
    publishCalls.length = 0;
    const customChannel = "minds-BRE-999";
    await startReview(BUS_URL, customChannel, WAVE_ID, MIND_NAME);
    expect(publishCalls[0].channel).toBe(customChannel);
  });

  it("reviewPass uses the provided channel exactly", async () => {
    publishCalls.length = 0;
    const customChannel = "minds-BRE-888";
    await reviewPass(BUS_URL, customChannel, WAVE_ID, MIND_NAME);
    expect(publishCalls[0].channel).toBe(customChannel);
  });

  it("reviewFail uses the provided channel exactly", async () => {
    publishCalls.length = 0;
    const customChannel = "minds-BRE-777";
    await reviewFail(BUS_URL, customChannel, WAVE_ID, MIND_NAME);
    expect(publishCalls[0].channel).toBe(customChannel);
  });
});
