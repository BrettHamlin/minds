import { describe, expect, it, mock, beforeEach } from "bun:test";
import { publishMindsEvent, type MindsEvent } from "../publish-event.ts";

// We mock mindsPublish at the module level to capture calls
const mockPublish = mock(() => Promise.resolve());

// Mock the minds-publish module
mock.module("../minds-publish.ts", () => ({
  mindsPublish: mockPublish,
}));

describe("publishMindsEvent", () => {
  beforeEach(() => {
    mockPublish.mockClear();
    mockPublish.mockImplementation(() => Promise.resolve());
  });

  it("normalizes event shape — source, ticketId, timestamp added to payload", async () => {
    const event: MindsEvent = {
      type: "WAVE_STARTED",
      source: "orchestrator",
      ticketId: "BRE-457",
      payload: { waveId: "wave-1" },
      timestamp: 1700000000000,
    };

    await publishMindsEvent("http://localhost:7777", "minds-BRE-457", event);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [busUrl, channel, type, payload] = mockPublish.mock.calls[0];
    expect(busUrl).toBe("http://localhost:7777");
    expect(channel).toBe("minds-BRE-457");
    expect(type).toBe("WAVE_STARTED");
    expect(payload).toEqual({
      waveId: "wave-1",
      source: "orchestrator",
      ticketId: "BRE-457",
      timestamp: 1700000000000,
    });
  });

  it("adds timestamp if missing", async () => {
    const before = Date.now();

    const event: MindsEvent = {
      type: "DRONE_SPAWNED",
      source: "orchestrator",
      ticketId: "BRE-457",
      payload: { mindName: "transport" },
    };

    await publishMindsEvent("http://localhost:7777", "minds-BRE-457", event);

    const [, , , payload] = mockPublish.mock.calls[0];
    const ts = (payload as Record<string, unknown>).timestamp as number;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it("fire-and-forget never throws even when bus call fails", async () => {
    mockPublish.mockImplementation(() => Promise.reject(new Error("bus down")));

    const event: MindsEvent = {
      type: "WAVE_COMPLETE",
      source: "orchestrator",
      ticketId: "BRE-457",
      payload: { waveId: "wave-1" },
    };

    // Should not throw
    await publishMindsEvent("http://localhost:9999", "minds-BRE-457", event);
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("all fields present in published message", async () => {
    const event: MindsEvent = {
      type: "DRONE_REVIEWING",
      source: "orchestrator",
      ticketId: "BRE-100",
      payload: { waveId: "w-2", mindName: "signals", extra: true },
      timestamp: 1234567890,
    };

    await publishMindsEvent("http://localhost:7777", "minds-BRE-100", event);

    const [, , , payload] = mockPublish.mock.calls[0];
    const p = payload as Record<string, unknown>;
    expect(p.source).toBe("orchestrator");
    expect(p.ticketId).toBe("BRE-100");
    expect(p.timestamp).toBe(1234567890);
    expect(p.waveId).toBe("w-2");
    expect(p.mindName).toBe("signals");
    expect(p.extra).toBe(true);
  });
});
