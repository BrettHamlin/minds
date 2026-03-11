/**
 * supervisor-state-machine.ts — State machine with validated transitions
 * for the deterministic Mind supervisor.
 */

import { SupervisorState, type SupervisorConfig, type StateMachine } from "./supervisor-types.ts";

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<SupervisorState, SupervisorState[]> = {
  [SupervisorState.INIT]: [SupervisorState.DRONE_RUNNING, SupervisorState.DONE, SupervisorState.FAILED],
  [SupervisorState.DRONE_RUNNING]: [SupervisorState.CHECKING, SupervisorState.FAILED],
  [SupervisorState.CHECKING]: [SupervisorState.REVIEWING, SupervisorState.FAILED],
  [SupervisorState.REVIEWING]: [SupervisorState.DONE, SupervisorState.DRONE_RUNNING, SupervisorState.FAILED],
  [SupervisorState.DONE]: [],
  [SupervisorState.FAILED]: [],
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSupervisorStateMachine(config: SupervisorConfig): StateMachine {
  let state = SupervisorState.INIT;
  let iteration = 0;

  return {
    getState() {
      return state;
    },

    transition(to: SupervisorState) {
      const allowed = VALID_TRANSITIONS[state];
      if (!allowed.includes(to)) {
        throw new Error(
          `Invalid transition from ${state} to ${to}. Allowed: [${allowed.join(", ")}]`
        );
      }
      state = to;
    },

    getIteration() {
      return iteration;
    },

    incrementIteration() {
      iteration++;
      return iteration;
    },

    isMaxIterations() {
      return iteration >= config.maxIterations;
    },
  };
}
