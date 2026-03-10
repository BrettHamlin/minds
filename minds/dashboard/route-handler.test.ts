// route-handler.test.ts — Unit tests for route handler (BRE-445 T004)

import { describe, test, expect } from "bun:test";
import { MindsStateTracker } from "./state-tracker.js";
import { MindsEventType, type MindsBusMessage } from "@minds/transport/minds-events.js";
import { createMindsRouteHandler } from "./route-handler.js";

function makeMsg(
  type: MindsEventType,
  payload: unknown,
  overrides?: Partial<MindsBusMessage>
): MindsBusMessage {
  return {
    channel: "minds-TEST-1",
    from: "@test",
    type,
    payload,
    ticketId: "TEST-1",
    mindName: "test-mind",
    ...overrides,
  };
}

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe("createMindsRouteHandler", () => {
  test("GET /api/minds/active returns JSON array", async () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );

    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/active"));

    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toContain("application/json");
    const body = await res!.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].ticketId).toBe("TEST-1");
  });

  test("GET /api/minds/waves returns waves for a ticket", async () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "transport",
      })
    );

    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/waves?ticket=TEST-1"));

    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.waves).toHaveLength(1);
    expect(body.waves[0].drones).toHaveLength(1);
  });

  test("GET /api/minds/waves returns 404 for unknown ticket", async () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/waves?ticket=NOPE-999"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  test("GET /api/minds/contracts returns contracts for a ticket", async () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.CONTRACT_FULFILLED, {
        producer: "transport",
        consumer: "dashboard",
        interface: "MindsStateTracker",
      })
    );

    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/contracts?ticket=TEST-1"));

    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.contracts).toHaveLength(1);
    expect(body.contracts[0].status).toBe("fulfilled");
  });

  test("GET /api/minds/contracts returns 404 for unknown ticket", async () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/contracts?ticket=NOPE-999"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  test("GET /minds serves HTML content type", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/minds"));

    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toContain("text/html");
  });

  test("GET /minds/ serves HTML content type", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/minds/"));

    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toContain("text/html");
  });

  test("SSE endpoint returns event-stream content type", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/subscribe/minds-status"));

    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toBe("text/event-stream");
  });

  test("unknown route returns null", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/something-else"));

    expect(res).toBeNull();
  });

  // T004: /api/minds/events SSE endpoint tests

  test("GET /api/minds/events returns text/event-stream Content-Type", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/events?ticket=TEST-1"));

    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toBe("text/event-stream");
  });

  test("GET /api/minds/events returns no-cache Cache-Control", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/events?ticket=TEST-1"));

    expect(res).not.toBeNull();
    expect(res!.headers.get("cache-control")).toBe("no-cache");
  });

  test("GET /api/minds/events returns 400 when ticket param is missing", async () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/minds/events"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body.error).toBeTruthy();
  });

  test("GET /api/unknown still returns null (regression)", () => {
    const tracker = new MindsStateTracker();
    const handler = createMindsRouteHandler(tracker);
    const res = handler(makeRequest("/api/unknown"));

    expect(res).toBeNull();
  });
});
