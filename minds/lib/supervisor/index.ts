/**
 * minds/lib/supervisor/index.ts — Barrel export for the supervisor module.
 *
 * Re-exports the public API from all supervisor sub-modules.
 */

// Types, enums, constants, and utilities from supervisor-types
export {
  SupervisorState,
  type SupervisorConfig,
  type SupervisorDeps,
  type CheckResults,
  type ReviewFinding,
  type ReviewVerdict,
  type StateMachine,
  type SupervisorResult,
  DEFAULT_REVIEW_TIMEOUT_MS,
  DEFAULT_DRONE_TIMEOUT_MS,
  SENTINEL_FILENAME,
  MAX_DIFF_CHARS,
  MAX_TEST_OUTPUT_CHARS,
  errorMessage,
} from "./supervisor-types.ts";

// State machine
export { createSupervisorStateMachine } from "./supervisor-state-machine.ts";

// Review prompt, verdict parsing, feedback generation
export {
  buildReviewPrompt,
  parseReviewVerdict,
  buildFeedbackContent,
  type ReviewPromptParams,
} from "./supervisor-review.ts";

// Drone spawning, re-launch, completion detection, Stop hook
export {
  spawnDrone,
  relaunchDroneInWorktree,
  installDroneStopHook,
  waitForDroneCompletion,
  type DroneSpawnResult,
} from "./supervisor-drone.ts";

// Main orchestrator entry point
export { runMindSupervisor } from "./mind-supervisor.ts";
