// minds-events.test.ts — Tests for serializeEventForSSE() (BRE-482)

import { describe, expect, it } from "bun:test";
import {
  MindsBusMessage,
  MindsEventType,
  serializeEventForSSE,
} from "../minds-events.ts";

function makeMessage(
  overrides: Partial<MindsBusMessage> = {},
): MindsBusMessage {
  return {
    channel: "minds-BRE-482",
    from: "@transport",
    type: MindsEventType.MIND_STARTED,
    payload: {},
    ticketId: "BRE-482",
    mindName: "transport",
    ...overrides,
  };
}

describe("serializeEventForSSE", () => {
  it("produces SSE format with event: and data: lines followed by blank line", () => {
    const msg = makeMessage({ type: MindsEventType.MIND_STARTED });
    const result = serializeEventForSSE(msg);

    expect(result).toMatch(/^event: MIND_STARTED\n/);
    expect(result).toMatch(/\ndata: \{.*\}\n\n$/);
  });

  it("includes type in the data JSON", () => {
    const msg = makeMessage({ type: MindsEventType.REVIEW_FEEDBACK });
    const result = serializeEventForSSE(msg);

    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.type).toBe("REVIEW_FEEDBACK");
  });

  it("includes mindName in the data JSON", () => {
    const msg = makeMessage({ mindName: "dashboard" });
    const result = serializeEventForSSE(msg);

    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.mindName).toBe("dashboard");
  });

  it("includes an ISO-8601 timestamp", () => {
    const msg = makeMessage();
    const result = serializeEventForSSE(msg);

    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });

  it("extracts waveId from payload when present", () => {
    const msg = makeMessage({
      payload: { waveId: "wave-3", extra: "data" },
    });
    const result = serializeEventForSSE(msg);

    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.waveId).toBe("wave-3");
  });

  it("omits waveId when not present in payload", () => {
    const msg = makeMessage({ payload: { other: "value" } });
    const result = serializeEventForSSE(msg);

    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.waveId).toBeUndefined();
  });

  it("includes the full payload in the data JSON", () => {
    const payload = { waveId: "wave-1", custom: "field", count: 42 };
    const msg = makeMessage({ payload });
    const result = serializeEventForSSE(msg);

    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.payload).toEqual(payload);
  });

  it("handles MIND_COMPLETE event type", () => {
    const msg = makeMessage({
      type: MindsEventType.MIND_COMPLETE,
      payload: { waveId: "wave-2" },
    });
    const result = serializeEventForSSE(msg);

    expect(result.startsWith("event: MIND_COMPLETE\n")).toBe(true);
    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.type).toBe("MIND_COMPLETE");
    expect(parsed.waveId).toBe("wave-2");
  });

  it("handles WAVE_STARTED event type", () => {
    const msg = makeMessage({
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId: "wave-1" },
    });
    const result = serializeEventForSSE(msg);

    expect(result.startsWith("event: WAVE_STARTED\n")).toBe(true);
    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.type).toBe("WAVE_STARTED");
  });

  it("handles DRONE_SPAWNED event type", () => {
    const msg = makeMessage({
      type: MindsEventType.DRONE_SPAWNED,
      payload: { waveId: "wave-1", agentId: "agent-xyz" },
    });
    const result = serializeEventForSSE(msg);

    expect(result.startsWith("event: DRONE_SPAWNED\n")).toBe(true);
    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.type).toBe("DRONE_SPAWNED");
    expect(parsed.waveId).toBe("wave-1");
  });

  it("handles payload as empty object gracefully", () => {
    const msg = makeMessage({ payload: {} });
    const result = serializeEventForSSE(msg);

    expect(result).toContain("event:");
    expect(result).toContain("data:");
    const dataLine = result.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.waveId).toBeUndefined();
    expect(parsed.payload).toEqual({});
  });

  it("terminates with double newline as per SSE spec", () => {
    const msg = makeMessage();
    const result = serializeEventForSSE(msg);
    expect(result.endsWith("\n\n")).toBe(true);
  });
});
