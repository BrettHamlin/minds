/**
 * stage-registry.ts — Maps stage type strings to executor functions.
 *
 * The registry is the single source of truth for which executor handles
 * each stage type. Built-in executors are registered at module load.
 * New executors (run-command, health-check, collect-results) are stubbed
 * with "not yet implemented" errors until their implementing tickets land.
 */

import type { StageExecutor } from "./pipeline-types.ts";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, StageExecutor>();

/**
 * Register a stage executor for a given type string.
 * Throws if an executor is already registered for that type.
 */
export function registerExecutor(type: string, executor: StageExecutor): void {
  if (registry.has(type)) {
    throw new Error(`Stage executor already registered for type "${type}"`);
  }
  registry.set(type, executor);
}

/**
 * Look up the executor for a stage type.
 * Throws if no executor is registered for that type.
 */
export function getExecutor(type: string): StageExecutor {
  const executor = registry.get(type);
  if (!executor) {
    throw new Error(
      `No stage executor registered for type "${type}". ` +
      `Registered types: ${[...registry.keys()].join(", ") || "(none)"}`
    );
  }
  return executor;
}

/**
 * Check whether an executor is registered for a given type.
 */
export function hasExecutor(type: string): boolean {
  return registry.has(type);
}

/**
 * Get all registered type strings (for diagnostics/logging).
 */
export function registeredTypes(): string[] {
  return [...registry.keys()];
}

/**
 * Clear all registered executors. Only for testing.
 */
export function clearRegistry(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Stub executors for stages that are not yet implemented (BRE-621)
// ---------------------------------------------------------------------------

const notImplemented = (type: string): StageExecutor => {
  return async () => {
    throw new Error(`Stage executor "${type}" is not yet implemented (see BRE-621)`);
  };
};

// ---------------------------------------------------------------------------
// Register built-in executors
// ---------------------------------------------------------------------------

// Code pipeline stages — these are stubs that will be replaced when the
// supervisor is refactored to use the pipeline runner (BRE-619, BRE-620).
// For now they exist so the registry knows about all valid stage types.
registerExecutor("spawn-drone", notImplemented("spawn-drone"));
registerExecutor("wait-completion", notImplemented("wait-completion"));
registerExecutor("git-diff", notImplemented("git-diff"));
registerExecutor("run-tests", notImplemented("run-tests"));
registerExecutor("boundary-check", notImplemented("boundary-check"));
registerExecutor("contract-check", notImplemented("contract-check"));
registerExecutor("llm-review", notImplemented("llm-review"));

// Build/test pipeline stages — stubbed for BRE-621
registerExecutor("run-command", notImplemented("run-command"));
registerExecutor("health-check", notImplemented("health-check"));
registerExecutor("collect-results", notImplemented("collect-results"));
