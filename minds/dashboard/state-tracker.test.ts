// state-tracker.test.ts — Unit tests for MindsStateTracker (BRE-445 T002)

import { describe, test, expect } from "bun:test";
import { MindsStateTracker } from "./state-tracker.js";
import { MindsEventType, type MindsBusMessage } from "../transport/minds-events.js";

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

describe("MindsStateTracker", () => {
  test("WAVE_STARTED creates wave entry", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );

    const state = tracker.getState("TEST-1");
    expect(state).toBeDefined();
    expect(state!.waves).toHaveLength(1);
    expect(state!.waves[0].id).toBe("1");
    expect(state!.waves[0].status).toBe("active");
    expect(state!.waves[0].startedAt).toBeTruthy();
  });

  test("WAVE_STARTED sets ticketTitle from payload", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, {
        waveId: "1",
        ticketTitle: "My Feature",
      })
    );

    const state = tracker.getState("TEST-1");
    expect(state!.ticketTitle).toBe("My Feature");
  });

  test("DRONE_SPAWNED adds drone to correct wave", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "transport",
        paneId: "%42",
        worktree: "/tmp/test",
        tasks: 5,
        branch: "minds/TEST-1-transport",
      })
    );

    const state = tracker.getState("TEST-1");
    const drone = state!.waves[0].drones[0];
    expect(drone.mindName).toBe("transport");
    expect(drone.status).toBe("active");
    expect(drone.paneId).toBe("%42");
    expect(drone.worktree).toBe("/tmp/test");
    expect(drone.tasks).toBe(5);
    expect(drone.tasksComplete).toBe(0);
    expect(drone.branch).toBe("minds/TEST-1-transport");
    expect(drone.startedAt).toBeTruthy();
  });

  test("DRONE_COMPLETE marks drone complete", () => {
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
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_COMPLETE, {
        waveId: "1",
        mindName: "transport",
        tasksComplete: 4,
      })
    );

    const drone = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("complete");
    expect(drone.tasksComplete).toBe(4);
    expect(drone.completedAt).toBeTruthy();
  });

  test("DRONE_REVIEWING status transition", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "signals",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_REVIEWING, {
        waveId: "1",
        mindName: "signals",
      })
    );

    const drone = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("reviewing");
  });

  test("DRONE_REVIEW_PASS status transition", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "signals",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_REVIEWING, {
        waveId: "1",
        mindName: "signals",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_REVIEW_PASS, {
        waveId: "1",
        mindName: "signals",
      })
    );

    const drone = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("complete");
  });

  test("DRONE_REVIEW_FAIL increments reviewAttempts and reverts to active", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "dashboard",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_REVIEW_FAIL, {
        waveId: "1",
        mindName: "dashboard",
        violations: 3,
      })
    );

    const drone = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("active");
    expect(drone.reviewAttempts).toBe(1);
    expect(drone.violations).toBe(3);

    // Second fail increments again
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_REVIEW_FAIL, {
        waveId: "1",
        mindName: "dashboard",
        violations: 1,
      })
    );

    const drone2 = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone2.reviewAttempts).toBe(2);
    expect(drone2.violations).toBe(1);
  });

  test("DRONE_MERGING status transition", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "cli",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_MERGING, {
        waveId: "1",
        mindName: "cli",
      })
    );

    const drone = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("merging");
  });

  test("DRONE_MERGED marks drone complete", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "cli",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_MERGING, {
        waveId: "1",
        mindName: "cli",
      })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_MERGED, {
        waveId: "1",
        mindName: "cli",
      })
    );

    const drone = tracker.getState("TEST-1")!.waves[0].drones[0];
    expect(drone.status).toBe("complete");
    expect(drone.completedAt).toBeTruthy();
  });

  test("CONTRACT_FULFILLED updates contract status", () => {
    const tracker = new MindsStateTracker();
    // First, create the state with an event
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    // Fulfill a contract
    tracker.applyEvent(
      makeMsg(MindsEventType.CONTRACT_FULFILLED, {
        producer: "transport",
        consumer: "dashboard",
        interface: "MindsStateTracker",
      })
    );

    const state = tracker.getState("TEST-1")!;
    expect(state.contracts).toHaveLength(1);
    expect(state.contracts[0].status).toBe("fulfilled");
    expect(state.contracts[0].producer).toBe("transport");
    expect(state.contracts[0].consumer).toBe("dashboard");
    expect(state.contracts[0].interface).toBe("MindsStateTracker");
  });

  test("WAVE_COMPLETE marks wave complete", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_COMPLETE, { waveId: "1" })
    );

    const wave = tracker.getState("TEST-1")!.waves[0];
    expect(wave.status).toBe("complete");
    expect(wave.completedAt).toBeTruthy();
  });

  test("subscribe callback fires on event", () => {
    const tracker = new MindsStateTracker();
    const received: string[] = [];

    const unsub = tracker.subscribe((state) => {
      received.push(state.ticketId);
    });

    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_COMPLETE, { waveId: "1" })
    );

    expect(received).toEqual(["TEST-1", "TEST-1"]);

    // Unsubscribe stops callbacks
    unsub();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "2" })
    );
    expect(received).toHaveLength(2);
  });

  test("getState returns undefined for unknown ticket", () => {
    const tracker = new MindsStateTracker();
    expect(tracker.getState("NOPE-999")).toBeUndefined();
  });

  test("getAllActive returns all tracked tickets", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }, { ticketId: "A-1" })
    );
    tracker.applyEvent(
      makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }, { ticketId: "B-2" })
    );

    const all = tracker.getAllActive();
    expect(all).toHaveLength(2);
    const ids = all.map((s) => s.ticketId).sort();
    expect(ids).toEqual(["A-1", "B-2"]);
  });

  test("stats are recalculated on each event", () => {
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
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, {
        waveId: "1",
        mindName: "signals",
      })
    );

    const stats = tracker.getState("TEST-1")!.stats;
    expect(stats.mindsInvolved).toBe(2);
    expect(stats.activeDrones).toBe(2);
    expect(stats.currentWave).toBe(1);
    expect(stats.totalWaves).toBe(1);
    expect(stats.contractsFulfilled).toBe(0);
    expect(stats.contractsTotal).toBe(0);
  });
});
