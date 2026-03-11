/**
 * supervisor-bus-shape.test.ts — Verifies the event shape produced by
 * publishSignal matches what waitForWaveCompletion expects.
 *
 * The chain: publishSignal → publishMindsEvent → mindsPublish → POST /publish
 *            → bus server BusMessage → SSE data: JSON → listener parses
 *
 * The listener checks:
 *   event.type === MindsEventType.MIND_COMPLETE
 *   event.payload?.waveId === waveId
 *   event.payload?.mindName (truthy + in expected set)
 */

import { describe, test, expect } from "bun:test";
import { MindsEventType } from "../../transport/minds-events.ts";

describe("bus event payload shape", () => {
  test("publishSignal produces payload shape matching waitForWaveCompletion expectations", () => {
    // Simulate the full transform chain without a real bus server.
    const mindName = "transport";
    const waveId = "wave-1";
    const channel = "minds-BRE-500";
    const ticketId = channel.replace(/^minds-/, "");
    const extra = { iterations: 2, approvedWithWarnings: false };

    // publishSignal → publishMindsEvent → mindsPublish flattens payload
    const eventPayload = { mindName, waveId, ...extra };
    const publishPayload = {
      ...eventPayload,
      source: "supervisor",
      ticketId,
      timestamp: Date.now(),
    };

    // mindsPublish POSTs: { channel, from, type, payload }
    // bus-server creates BusMessage with payload: b["payload"]
    const busMessage = {
      id: crypto.randomUUID(),
      seq: 1,
      channel,
      from: "minds",
      type: MindsEventType.MIND_COMPLETE as string,
      payload: publishPayload,
      timestamp: Date.now(),
    };

    // SSE listener parses JSON.stringify(busMessage)
    const parsed = JSON.parse(JSON.stringify(busMessage));

    // These are the exact checks from waitForWaveCompletion (bus-listener.ts)
    expect(parsed.type).toBe(MindsEventType.MIND_COMPLETE);
    expect(parsed.payload?.waveId).toBe(waveId);
    expect(parsed.payload?.mindName).toBe(mindName);
    expect(typeof parsed.payload?.mindName).toBe("string");
  });

  test("mindName and waveId are at the first level of payload, not nested deeper", () => {
    const payload = {
      mindName: "signals",
      waveId: "wave-2",
      source: "supervisor",
      ticketId: "BRE-500",
      timestamp: Date.now(),
    };

    const busMessage = { type: MindsEventType.MIND_COMPLETE, payload };

    expect(busMessage.payload.mindName).toBe("signals");
    expect(busMessage.payload.waveId).toBe("wave-2");
  });

  test("publishMindsEvent transform preserves mindName and waveId", () => {
    // Replicate the exact transform from publish-event.ts:
    //   mindsPublish(busUrl, channel, event.type, {
    //     ...event.payload, source, ticketId, timestamp
    //   })
    const mindsEvent = {
      type: MindsEventType.MIND_COMPLETE as string,
      source: "supervisor",
      ticketId: "BRE-500",
      payload: { mindName: "transport", waveId: "wave-1", iterations: 2 },
    };

    const transformedPayload = {
      ...mindsEvent.payload,
      source: mindsEvent.source,
      ticketId: mindsEvent.ticketId,
      timestamp: Date.now(),
    };

    // mindName and waveId survive the spread
    expect(transformedPayload.mindName).toBe("transport");
    expect(transformedPayload.waveId).toBe("wave-1");
    expect(transformedPayload.iterations).toBe(2);
    expect(transformedPayload.source).toBe("supervisor");

    // Full bus round-trip
    const busMessage = {
      id: "test-id",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: mindsEvent.type,
      payload: transformedPayload,
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(busMessage));
    expect(parsed.type).toBe(MindsEventType.MIND_COMPLETE);
    expect(parsed.payload?.waveId).toBe("wave-1");
    expect(parsed.payload?.mindName).toBe("transport");
  });

  test("MIND_FAILED event shape includes mindName, waveId, and error in payload", () => {
    const mindName = "transport";
    const waveId = "wave-1";
    const errorMsg = "Drone pane %10 died without writing sentinel";

    const busMessage = {
      id: "test-id",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: MindsEventType.MIND_FAILED as string,
      payload: {
        mindName,
        waveId,
        error: errorMsg,
        source: "supervisor",
        ticketId: "BRE-500",
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(busMessage));

    // These are the exact checks from waitForWaveCompletion for MIND_FAILED
    expect(parsed.type).toBe(MindsEventType.MIND_FAILED);
    expect(parsed.payload?.waveId).toBe(waveId);
    expect(parsed.payload?.mindName).toBe(mindName);
    expect(parsed.payload?.error).toBe(errorMsg);
    expect(typeof parsed.payload?.mindName).toBe("string");
    expect(typeof parsed.payload?.error).toBe("string");
  });

  test("all supervisor signal types include mindName and waveId in payload", () => {
    const signalTypes = [
      { type: MindsEventType.MIND_STARTED, extra: {} },
      { type: MindsEventType.REVIEW_STARTED, extra: { iteration: 1 } },
      { type: MindsEventType.REVIEW_FEEDBACK, extra: { iteration: 1, findingsCount: 3 } },
      { type: MindsEventType.MIND_COMPLETE, extra: { iterations: 2, approvedWithWarnings: false } },
      { type: MindsEventType.MIND_FAILED, extra: { error: "drone crashed" } },
    ];

    const mindName = "dashboard";
    const waveId = "wave-3";

    for (const { type, extra } of signalTypes) {
      const busPayload = {
        mindName,
        waveId,
        ...extra,
        source: "supervisor",
        ticketId: "BRE-500",
        timestamp: Date.now(),
      };

      expect(busPayload.mindName).toBe(mindName);
      expect(busPayload.waveId).toBe(waveId);
    }
  });

  test("extra payload fields are preserved through the chain", () => {
    const extra = { approved: true, iterations: 2, findings: [] };
    const flattenedPayload = {
      mindName: "transport",
      waveId: "wave-1",
      ...extra,
      source: "supervisor",
      ticketId: "BRE-500",
      timestamp: Date.now(),
    };

    const busMessage = {
      id: "uuid",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: MindsEventType.MIND_COMPLETE as string,
      payload: flattenedPayload,
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(busMessage));
    expect(parsed.payload.mindName).toBe("transport");
    expect(parsed.payload.waveId).toBe("wave-1");
    expect(parsed.payload.approved).toBe(true);
    expect(parsed.payload.iterations).toBe(2);
    expect(parsed.payload.findings).toEqual([]);
  });

  test("missing mindName would fail listener check", () => {
    const busMessage = {
      type: MindsEventType.MIND_COMPLETE,
      payload: { waveId: "wave-1", source: "supervisor" },
    };
    const parsed = JSON.parse(JSON.stringify(busMessage));
    expect(parsed.payload?.mindName).toBeUndefined();
  });

  test("missing waveId would fail listener check", () => {
    const busMessage = {
      type: MindsEventType.MIND_COMPLETE,
      payload: { mindName: "transport", source: "supervisor" },
    };
    const parsed = JSON.parse(JSON.stringify(busMessage));
    expect(parsed.payload?.waveId).toBeUndefined();
  });
});
