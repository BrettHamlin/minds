/**
 * supervisor-state-machine.test.ts — Tests for the supervisor state machine.
 */

import { describe, test, expect } from "bun:test";
import { SupervisorState, type SupervisorConfig } from "../supervisor-types.ts";
import { createSupervisorStateMachine } from "../supervisor-state-machine.ts";
import type { MindTask } from "../../cli/lib/implement-types.ts";

function makeConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return {
    mindName: "transport",
    ticketId: "BRE-500",
    waveId: "wave-1",
    tasks: [
      { id: "T001", mind: "transport", description: "Implement SSE endpoint", parallel: false },
    ],
    repoRoot: "/tmp/test-repo",
    busUrl: "http://localhost:7777",
    busPort: 7777,
    channel: "minds-BRE-500",
    worktreePath: "/tmp/test-worktree",
    baseBranch: "dev",
    callerPane: "%0",
    mindsSourceDir: "/tmp/test-repo/minds",
    featureDir: "/tmp/test-repo/specs/BRE-500-feature",
    dependencies: [],
    maxIterations: 3,
    droneTimeoutMs: 20 * 60 * 1000,
    ...overrides,
  };
}

describe("SupervisorStateMachine", () => {
  test("initial state is INIT", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(sm.getState()).toBe(SupervisorState.INIT);
  });

  test("valid transitions from INIT to DRONE_RUNNING", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    expect(sm.getState()).toBe(SupervisorState.DRONE_RUNNING);
  });

  test("valid transitions from INIT to DONE", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
  });

  test("valid transitions from DRONE_RUNNING to CHECKING", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    expect(sm.getState()).toBe(SupervisorState.CHECKING);
  });

  test("valid transitions from CHECKING to REVIEWING", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    expect(sm.getState()).toBe(SupervisorState.REVIEWING);
  });

  test("valid transitions from REVIEWING to DONE (approved)", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
  });

  test("valid transitions from REVIEWING back to DRONE_RUNNING (rejected)", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DRONE_RUNNING);
    expect(sm.getState()).toBe(SupervisorState.DRONE_RUNNING);
  });

  test("invalid transition from INIT to REVIEWING throws", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(() => sm.transition(SupervisorState.REVIEWING)).toThrow(/Invalid transition/);
  });

  test("invalid transition from DONE to any state throws", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(() => sm.transition(SupervisorState.INIT)).toThrow(/Invalid transition/);
  });

  test("getIteration starts at 0", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(sm.getIteration()).toBe(0);
  });

  test("incrementIteration advances and returns current count", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(sm.incrementIteration()).toBe(1);
    expect(sm.incrementIteration()).toBe(2);
    expect(sm.getIteration()).toBe(2);
  });

  test("isMaxIterations returns true when limit reached", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 2 }));
    sm.incrementIteration();
    sm.incrementIteration();
    expect(sm.isMaxIterations()).toBe(true);
  });

  test("isMaxIterations returns false below limit", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 3 }));
    sm.incrementIteration();
    expect(sm.isMaxIterations()).toBe(false);
  });

  test("INIT can transition to FAILED", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.FAILED);
    expect(sm.getState()).toBe(SupervisorState.FAILED);
  });

  test("DRONE_RUNNING can transition to FAILED", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.FAILED);
    expect(sm.getState()).toBe(SupervisorState.FAILED);
  });
});

describe("Full review cycle simulation", () => {
  test("approve on first try: INIT -> DRONE_RUNNING -> CHECKING -> REVIEWING -> DONE", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    expect(sm.getIteration()).toBe(1);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
    expect(sm.getIteration()).toBe(1);
  });

  test("reject then approve: 2 iterations", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 3 }));
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    expect(sm.getIteration()).toBe(2);
    expect(sm.isMaxIterations()).toBe(false);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
  });

  test("max iterations reached forces DONE", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 2 }));
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    expect(sm.isMaxIterations()).toBe(true);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
    expect(sm.getIteration()).toBe(2);
  });
});
