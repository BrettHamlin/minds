/**
 * stages/index.ts — Barrel file for stage executors.
 *
 * Exports all executor functions and provides registerAllStages() which
 * replaces the stub registrations in stage-registry.ts with real executors.
 */

import { clearRegistry, registerExecutor, hasExecutor } from "../stage-registry.ts";

// Re-export individual executors
export { executeSpawnDrone } from "./spawn-drone.ts";
export { executeWaitCompletion } from "./wait-completion.ts";
export { executeGitDiff } from "./git-diff.ts";
export { executeRunTests } from "./run-tests.ts";
export { executeBoundaryCheck } from "./boundary-check.ts";
export { executeContractCheck } from "./contract-check.ts";
export { executeLlmReview, applyForceRejections } from "./llm-review.ts";

// Import executor functions for registration
import { executeSpawnDrone } from "./spawn-drone.ts";
import { executeWaitCompletion } from "./wait-completion.ts";
import { executeGitDiff } from "./git-diff.ts";
import { executeRunTests } from "./run-tests.ts";
import { executeBoundaryCheck } from "./boundary-check.ts";
import { executeContractCheck } from "./contract-check.ts";
import { executeLlmReview } from "./llm-review.ts";

/**
 * Map of stage type -> executor function for the 7 code pipeline stages.
 */
const CODE_PIPELINE_EXECUTORS: Record<string, typeof executeSpawnDrone> = {
  "spawn-drone": executeSpawnDrone,
  "wait-completion": executeWaitCompletion,
  "git-diff": executeGitDiff,
  "run-tests": executeRunTests,
  "boundary-check": executeBoundaryCheck,
  "contract-check": executeContractCheck,
  "llm-review": executeLlmReview,
};

/**
 * Register all 7 code pipeline stage executors into the stage registry.
 *
 * Call this before running a pipeline via the generic runner (BRE-620).
 * The stage-registry.ts has stubs by default; this replaces them with
 * real implementations.
 *
 * Safe to call multiple times — clears existing registrations for these
 * types before re-registering.
 */
export function registerAllStages(): void {
  for (const [type, executor] of Object.entries(CODE_PIPELINE_EXECUTORS)) {
    // If a stub is already registered, we need to clear it first.
    // The registry throws on duplicate registration, so we use a
    // targeted approach: clear only our types, then register.
    if (hasExecutor(type)) {
      // We can't selectively remove, so we'll use a workaround:
      // clear the entire registry and re-register everything.
      // This is fine because registerAllStages is called once at startup.
      clearRegistry();
      break;
    }
  }

  for (const [type, executor] of Object.entries(CODE_PIPELINE_EXECUTORS)) {
    if (!hasExecutor(type)) {
      registerExecutor(type, executor);
    }
  }
}
