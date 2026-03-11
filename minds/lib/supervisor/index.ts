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
  buildAgentReviewPrompt,
  parseReviewVerdict,
  buildFeedbackContent,
  truncateWithLabel,
  formatReviewChecklist,
  REVIEW_CHECKLIST,
  REVIEW_RESPONSE_FORMAT,
  type ReviewPromptParams,
  type AgentReviewPromptParams,
} from "./supervisor-review.ts";

// Drone spawning, re-launch, completion detection, brief construction, Stop hook
export {
  spawnDrone,
  relaunchDroneInWorktree,
  installDroneStopHook,
  waitForDroneCompletion,
  buildSupervisorDroneBrief,
  type DroneSpawnResult,
} from "./supervisor-drone.ts";

// Deterministic checks and standards loading
export {
  loadStandards,
  runDeterministicChecksDefault,
} from "./supervisor-checks.ts";

// Bus signal publishing
export { publishSignalDefault } from "./supervisor-bus.ts";

// LLM review process lifecycle
export { callLlmReviewDefault } from "./supervisor-llm.ts";

// Mind Agent file generation
export {
  buildMindAgentContent,
  writeMindAgentFile,
  cleanupMindAgentFile,
  type MindAgentParams,
} from "./supervisor-agent.ts";

// Main orchestrator entry point
export { runMindSupervisor } from "./mind-supervisor.ts";
