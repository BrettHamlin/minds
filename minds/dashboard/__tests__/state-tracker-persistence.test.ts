// state-tracker-persistence.test.ts — Tests for SQLite persistence in MindsStateTracker (BRE-457 T019)

import { describe, test, expect, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { MindsStateTracker } from "../state-tracker.js";
import { MindsEventType, type MindsBusMessage } from "@minds/transport/minds-events.js";

const TEST_DB = "/tmp/minds-tracker-persist-test.sqlite";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

afterEach(cleanup);

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

describe("MindsStateTracker persistence", () => {
  test("apply events then restart tracker with same dbPath restores state", () => {
    // First tracker: apply events
    const tracker1 = new MindsStateTracker(TEST_DB);
    tracker1.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1", ticketTitle: "My Feature" }));
    tracker1.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, { waveId: "1", mindName: "transport", tasks: 3 })
    );

    // Second tracker: load from DB
    const tracker2 = new MindsStateTracker(TEST_DB);
    tracker2.loadFromDb();

    const state = tracker2.getState("TEST-1");
    expect(state).toBeDefined();
    expect(state!.ticketTitle).toBe("My Feature");
    expect(state!.waves).toHaveLength(1);
    expect(state!.waves[0].drones[0].mindName).toBe("transport");
    expect(state!.waves[0].drones[0].tasks).toBe(3);
  });

  test("getAllActive returns persisted states after loadFromDb", () => {
    const tracker1 = new MindsStateTracker(TEST_DB);
    tracker1.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }, { ticketId: "A-1" }));
    tracker1.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }, { ticketId: "B-2" }));

    const tracker2 = new MindsStateTracker(TEST_DB);
    tracker2.loadFromDb();

    const all = tracker2.getAllActive();
    expect(all).toHaveLength(2);
    const ids = all.map((s) => s.ticketId).sort();
    expect(ids).toEqual(["A-1", "B-2"]);
  });

  test("getHistory returns ordered event log", () => {
    const tracker = new MindsStateTracker(TEST_DB);
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, { waveId: "1", mindName: "signals" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_COMPLETE, { waveId: "1", mindName: "signals" })
    );

    const history = tracker.getHistory("TEST-1");
    expect(history.length).toBe(3);
    expect(history[0].event_type).toBe(MindsEventType.WAVE_STARTED);
    expect(history[1].event_type).toBe(MindsEventType.DRONE_SPAWNED);
    expect(history[2].event_type).toBe(MindsEventType.DRONE_COMPLETE);
  });

  test("getHistory with limit returns subset", () => {
    const tracker = new MindsStateTracker(TEST_DB);
    for (let i = 0; i < 5; i++) {
      tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: String(i) }));
    }
    const history = tracker.getHistory("TEST-1", 2);
    expect(history).toHaveLength(2);
  });

  test("getHistory returns empty array when no db", () => {
    const tracker = new MindsStateTracker(); // no dbPath
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    const history = tracker.getHistory("TEST-1");
    expect(history).toEqual([]);
  });

  test("loadFromDb no-ops when no db", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    // Should not throw
    tracker.loadFromDb();
    expect(tracker.getState("TEST-1")).toBeDefined();
  });

  test("state is updated in db on each applyEvent", () => {
    const tracker1 = new MindsStateTracker(TEST_DB);
    tracker1.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    tracker1.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, { waveId: "1", mindName: "cli" })
    );
    tracker1.applyEvent(
      makeMsg(MindsEventType.DRONE_COMPLETE, { waveId: "1", mindName: "cli", tasksComplete: 5 })
    );

    const tracker2 = new MindsStateTracker(TEST_DB);
    tracker2.loadFromDb();

    const drone = tracker2.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("complete");
    expect(drone.tasksComplete).toBe(5);
  });
});
