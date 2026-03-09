// state-tracker-hooks.test.ts — Tests for hook event handling in MindsStateTracker (BRE-457 T020)

import { describe, test, expect } from "bun:test";
import { MindsStateTracker } from "../state-tracker.js";
import { MindsEventType, HOOK_TYPES, type MindsBusMessage } from "@minds/transport/minds-events.js";

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

function makeHookMsg(
  hookType: string,
  source: string,
  extras?: Record<string, unknown>
): MindsBusMessage {
  return {
    channel: "minds-TEST-1",
    from: "@hook",
    // Cast: hook events use a string type not in the MindsEventType enum
    type: `HOOK_${hookType}` as unknown as MindsEventType,
    payload: {
      source,
      hookType,
      timestamp: Date.now(),
      payload: {},
      ...extras,
    },
    ticketId: "TEST-1",
    mindName: "test-mind",
  };
}

describe("MindsStateTracker hook events", () => {
  test("SubagentStart creates drone entry", () => {
    const tracker = new MindsStateTracker();
    // Set up a wave first so the drone has somewhere to live
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));

    tracker.applyEvent(
      makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:signals")
    );

    const state = tracker.getState("TEST-1")!;
    const allDrones = state.waves.flatMap((w) => w.drones);
    const drone = allDrones.find((d) => d.mindName === "signals");
    expect(drone).toBeDefined();
    expect(drone!.status).toBe("active");
  });

  test("SubagentStart creates drone in synthetic wave when no waves exist", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:cli"));

    const state = tracker.getState("TEST-1")!;
    expect(state.waves).toHaveLength(1);
    expect(state.waves[0].drones[0].mindName).toBe("cli");
  });

  test("SubagentStop marks drone complete", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:transport"));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_STOP, "drone:transport"));

    const state = tracker.getState("TEST-1")!;
    const drone = state.waves.flatMap((w) => w.drones).find((d) => d.mindName === "transport");
    expect(drone).toBeDefined();
    expect(drone!.status).toBe("complete");
    expect(drone!.completedAt).toBeTruthy();
  });

  test("PreToolUse increments toolCount", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:dashboard"));

    tracker.applyEvent(makeHookMsg(HOOK_TYPES.PRE_TOOL_USE, "drone:dashboard", { toolName: "Read" }));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.PRE_TOOL_USE, "drone:dashboard", { toolName: "Bash" }));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.PRE_TOOL_USE, "drone:dashboard", { toolName: "Write" }));

    const drone = tracker
      .getState("TEST-1")!
      .waves.flatMap((w) => w.drones)
      .find((d) => d.mindName === "dashboard");
    expect(drone).toBeDefined();
    expect(drone!.toolCount).toBe(3);
    expect(drone!.lastTool).toBe("Write");
  });

  test("PreToolUse sets lastTool to most recent tool name", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:signals"));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.PRE_TOOL_USE, "drone:signals", { toolName: "Bash" }));
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.PRE_TOOL_USE, "drone:signals", { toolName: "Read" }));

    const drone = tracker
      .getState("TEST-1")!
      .waves.flatMap((w) => w.drones)
      .find((d) => d.mindName === "signals");
    expect(drone!.lastTool).toBe("Read");
  });

  test("PostToolUseFailure surfaces error in errors array", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:transport"));
    tracker.applyEvent(
      makeHookMsg(HOOK_TYPES.POST_TOOL_USE_FAILURE, "drone:transport", {
        toolName: "Bash",
        payload: { error: "Command not found: foobar" },
      })
    );

    const drone = tracker
      .getState("TEST-1")!
      .waves.flatMap((w) => w.drones)
      .find((d) => d.mindName === "transport");
    expect(drone).toBeDefined();
    expect(drone!.errors).toHaveLength(1);
    expect(drone!.errors![0]).toBe("Command not found: foobar");
  });

  test("PostToolUseFailure uses fallback message when no payload.error", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:cli"));
    tracker.applyEvent(
      makeHookMsg(HOOK_TYPES.POST_TOOL_USE_FAILURE, "drone:cli", {
        toolName: "Write",
        payload: {},
      })
    );

    const drone = tracker
      .getState("TEST-1")!
      .waves.flatMap((w) => w.drones)
      .find((d) => d.mindName === "cli");
    expect(drone!.errors![0]).toBe("Tool failure: Write");
  });

  test("multiple PostToolUseFailure events accumulate in errors array", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.SUBAGENT_START, "drone:dashboard"));
    tracker.applyEvent(
      makeHookMsg(HOOK_TYPES.POST_TOOL_USE_FAILURE, "drone:dashboard", {
        toolName: "Bash",
        payload: { error: "err1" },
      })
    );
    tracker.applyEvent(
      makeHookMsg(HOOK_TYPES.POST_TOOL_USE_FAILURE, "drone:dashboard", {
        toolName: "Read",
        payload: { error: "err2" },
      })
    );

    const drone = tracker
      .getState("TEST-1")!
      .waves.flatMap((w) => w.drones)
      .find((d) => d.mindName === "dashboard");
    expect(drone!.errors).toHaveLength(2);
    expect(drone!.errors![1]).toBe("err2");
  });

  test("hook events do not interfere with regular events on same ticket", () => {
    const tracker = new MindsStateTracker();
    tracker.applyEvent(makeMsg(MindsEventType.WAVE_STARTED, { waveId: "1" }));
    tracker.applyEvent(
      makeMsg(MindsEventType.DRONE_SPAWNED, { waveId: "1", mindName: "signals", tasks: 4 })
    );
    tracker.applyEvent(makeHookMsg(HOOK_TYPES.PRE_TOOL_USE, "drone:signals", { toolName: "Bash" }));

    const state = tracker.getState("TEST-1")!;
    expect(state.waves[0].id).toBe("1");
    const drone = state.waves[0].drones.find((d) => d.mindName === "signals");
    expect(drone!.tasks).toBe(4);
    expect(drone!.toolCount).toBe(1);
    expect(drone!.lastTool).toBe("Bash");
  });
});
