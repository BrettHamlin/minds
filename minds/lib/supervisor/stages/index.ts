/**
 * stages/index.ts — Barrel file for stage executors.
 *
 * Exports all executor functions and provides registerAllStages() which
 * replaces the stub registrations in stage-registry.ts with real executors.
 */

import { clearRegistry, registerExecutor, hasExecutor } from "../stage-registry.ts";

// Re-export individual executors — code pipeline
export { executeSpawnDrone } from "./spawn-drone.ts";
export { executeWaitCompletion } from "./wait-completion.ts";
export { executeGitDiff } from "./git-diff.ts";
export { executeRunTests } from "./run-tests.ts";
export { executeBoundaryCheck } from "./boundary-check.ts";
export { executeContractCheck } from "./contract-check.ts";
export { executeLlmReview, applyForceRejections } from "./llm-review.ts";
export { executeEvalScore } from "./eval-score.ts";

// Re-export individual executors — build/test pipeline (BRE-621)
export { executeRunCommand } from "./run-command.ts";
export { executeHealthCheck } from "./health-check.ts";
export { executeCollectResults } from "./collect-results.ts";

// Import executor functions for registration
import { executeSpawnDrone } from "./spawn-drone.ts";
import { executeWaitCompletion } from "./wait-completion.ts";
import { executeGitDiff } from "./git-diff.ts";
import { executeRunTests } from "./run-tests.ts";
import { executeBoundaryCheck } from "./boundary-check.ts";
import { executeContractCheck } from "./contract-check.ts";
import { executeLlmReview } from "./llm-review.ts";
import { executeEvalScore } from "./eval-score.ts";
import { executeRunCommand } from "./run-command.ts";
import { executeHealthCheck } from "./health-check.ts";
import { executeCollectResults } from "./collect-results.ts";

/**
 * Map of stage type -> executor function for all 10 pipeline stages.
 * Includes 7 code pipeline stages + 3 build/test pipeline stages (BRE-621).
 */
const ALL_EXECUTORS: Record<string, typeof executeSpawnDrone> = {
  // Code pipeline stages
  "spawn-drone": executeSpawnDrone,
  "wait-completion": executeWaitCompletion,
  "git-diff": executeGitDiff,
  "run-tests": executeRunTests,
  "boundary-check": executeBoundaryCheck,
  "contract-check": executeContractCheck,
  "llm-review": executeLlmReview,
  "eval-score": executeEvalScore,
  // Build/test pipeline stages (BRE-621)
  "run-command": executeRunCommand,
  "health-check": executeHealthCheck,
  "collect-results": executeCollectResults,
};

/**
 * Register all 10 pipeline stage executors into the stage registry.
 *
 * Call this before running a pipeline via the generic runner (BRE-620).
 * The stage-registry.ts has stubs by default; this replaces them with
 * real implementations.
 *
 * Safe to call multiple times — clears existing registrations for these
 * types before re-registering.
 */
export function registerAllStages(): void {
  for (const [type, executor] of Object.entries(ALL_EXECUTORS)) {
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

  for (const [type, executor] of Object.entries(ALL_EXECUTORS)) {
    if (!hasExecutor(type)) {
      registerExecutor(type, executor);
    }
  }
}
