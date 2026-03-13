/**
 * mind-supervisor.ts -- Deterministic Mind supervisor orchestrator.
 *
 * Replaces the LLM-driven Mind (Claude Code Opus in a tmux pane reading
 * a 300-line CLAUDE.md operating manual). This TypeScript process handles
 * ALL control flow deterministically:
 *
 *   1. Publish MIND_STARTED via bus
 *   2. Resolve the pipeline (explicit > template > default CODE_PIPELINE)
 *   3. Register all stage executors
 *   4. For each iteration, run the pipeline via runPipeline()
 *   5. If approved: publish MIND_COMPLETE, exit
 *   6. If rejected: write REVIEW-FEEDBACK-{n}.md, backoff, retry
 *   7. Max iterations then approve with warnings (or fail on hard errors)
 *
 * The LLM is only invoked for the one thing that requires judgment: code review.
 *
 * Module structure:
 *   supervisor-types.ts        — enums, interfaces, constants
 *   supervisor-state-machine.ts — state machine with validated transitions
 *   supervisor-review.ts       — review prompt, verdict parsing, feedback
 *   supervisor-drone.ts        — drone spawning, re-launch, completion detection
 *   supervisor-checks.ts       — standards loading, deterministic verification
 *   supervisor-bus.ts          — bus signal publishing
 *   supervisor-llm.ts          — LLM review process lifecycle
 *   pipeline-runner.ts         — generic stage runner (iterates pipeline stages)
 *   pipeline-templates.ts      — pipeline templates and resolution
 *   stage-registry.ts          — maps stage types to executors
 *   stages/                    — individual stage executor implementations
 *   mind-supervisor.ts         — this file: orchestrator entry point
 */

import { existsSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { MindsEventType } from "../../transport/minds-events.ts";
import { killPane as killPaneImpl } from "../tmux-utils.ts";

// Internal imports (used by runMindSupervisor below)
import {
  SupervisorState,
  type SupervisorConfig,
  type SupervisorDeps,
  type ReviewFinding,
  type SupervisorResult,
  SENTINEL_FILENAME,
  BASE_RETRY_BACKOFF_MS,
  BACKOFF_MULTIPLIER,
  MAX_BACKOFF_MS,
  errorMessage,
} from "./supervisor-types.ts";
import { createSupervisorStateMachine } from "./supervisor-state-machine.ts";
import { buildFeedbackContent } from "./supervisor-review.ts";
import {
  spawnDrone as spawnDroneImpl,
  relaunchDroneInWorktree as relaunchDroneImpl,
  installDroneStopHook as installDroneStopHookImpl,
  waitForDroneCompletion as waitForDroneCompletionImpl,
} from "./supervisor-drone.ts";
import { loadStandards, runDeterministicChecksDefault } from "./supervisor-checks.ts";
import { publishSignalDefault } from "./supervisor-bus.ts";
import { callLlmReviewDefault } from "./supervisor-llm.ts";
import { runPipeline } from "./pipeline-runner.ts";
import { resolvePipeline, CODE_PIPELINE } from "./pipeline-templates.ts";
import { registerAllStages } from "./stages/index.ts";
import type { StageContext } from "./pipeline-types.ts";

// ---------------------------------------------------------------------------
// Default dependencies (production implementations)
// ---------------------------------------------------------------------------

function createDefaultDeps(): SupervisorDeps {
  return {
    spawnDrone: spawnDroneImpl,
    relaunchDroneInWorktree: relaunchDroneImpl,
    waitForDroneCompletion: waitForDroneCompletionImpl,
    publishSignal: publishSignalDefault,
    runDeterministicChecks: runDeterministicChecksDefault,
    callLlmReview: callLlmReviewDefault,
    installDroneStopHook: installDroneStopHookImpl,
    killPane: killPaneImpl,
    delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

// ---------------------------------------------------------------------------
// Force-rejection helper (deterministic checks override LLM verdict)
// ---------------------------------------------------------------------------
// Canonical implementation lives in stages/llm-review.ts (BRE-619).
// Re-exported here for backward compatibility.
import { applyForceRejections } from "./stages/llm-review.ts";
export { applyForceRejections };

// ---------------------------------------------------------------------------
// Main Supervisor Entry Point
// ---------------------------------------------------------------------------

export async function runMindSupervisor(
  config: SupervisorConfig,
  depsOverride?: Partial<SupervisorDeps>,
): Promise<SupervisorResult> {
  if (config.maxIterations < 1) {
    throw new Error(`maxIterations must be >= 1, got ${config.maxIterations}`);
  }

  const deps = { ...createDefaultDeps(), ...depsOverride };

  // Register real stage executors (replaces stubs from stage-registry.ts)
  registerAllStages();

  // Resolve pipeline stages: explicit > template > default CODE_PIPELINE
  const pipelineStages = resolvePipelineFromConfig(config);

  const sm = createSupervisorStateMachine(config);
  const result: SupervisorResult = {
    ok: false,
    iterations: 0,
    approved: false,
    approvedWithWarnings: false,
    findings: [],
    allPaneIds: [],
    totalPanesSpawned: 0,
    worktree: config.worktreePath,
    branch: "",
    errors: [],
  };

  const allFindings: ReviewFinding[] = [];
  const allSpawnedPanes: string[] = [];

  let currentDronePane: string | undefined;
  let currentWorktree = config.worktreePath;
  let currentBranch = "";

  const standards = loadStandards(config.repoRoot);

  try {
    // ---- Step 1: Publish MIND_STARTED ----
    console.log(`[supervisor] @${config.mindName}: Starting (max ${config.maxIterations} iterations)`);
    await deps.publishSignal(
      config.busUrl, config.channel,
      MindsEventType.MIND_STARTED,
      config.mindName, config.waveId,
    );

    // ---- Main loop ----
    while (!sm.isMaxIterations()) {
      sm.transition(SupervisorState.DRONE_RUNNING);
      const iteration = sm.incrementIteration();
      result.iterations = iteration;

      // Build stage context for this iteration
      const ctx: StageContext = {
        supervisorConfig: config,
        deps,
        standards,
        iteration,
        dronePane: currentDronePane,
        worktree: currentWorktree,
        branch: currentBranch,
        store: {},
        allSpawnedPanes,
      };

      // Log iteration start
      if (iteration === 1) {
        console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- spawning drone`);
      } else {
        console.log(`[supervisor] @${config.mindName}: Iteration ${iteration} -- re-launching drone in existing worktree`);
      }

      // ---- Run pipeline stages for this iteration ----
      const pipelineResult = await runPipeline(pipelineStages, ctx);

      // Read back state from context (stages may have mutated it)
      currentDronePane = ctx.dronePane;
      currentWorktree = ctx.worktree;
      currentBranch = ctx.branch;
      result.dronePaneId = ctx.dronePane;
      result.worktree = ctx.worktree;
      result.branch = ctx.branch;

      // Log drone spawn/relaunch completion
      if (ctx.dronePane) {
        if (iteration === 1) {
          console.log(`[supervisor] @${config.mindName}: Drone spawned in pane ${ctx.dronePane}`);
        } else {
          console.log(`[supervisor] @${config.mindName}: Drone re-launched in pane ${ctx.dronePane}`);
        }
      }

      // If pipeline had a terminal failure (spawn failed, drone crashed), handle it
      if (!pipelineResult.ok && pipelineResult.error) {
        // Check if it was a spawn/relaunch or drone failure (terminal errors)
        const isTerminal = pipelineResult.stageResults.some(r => r.terminal);
        if (isTerminal) {
          const msg = pipelineResult.error;
          console.error(`[supervisor] @${config.mindName}: ${msg}`);
          result.errors.push(msg);
          sm.transition(SupervisorState.FAILED);
          break;
        }
      }

      console.log(`[supervisor] @${config.mindName}: Drone completed, running checks`);

      // Transition to CHECKING after drone stages, REVIEWING for LLM review
      sm.transition(SupervisorState.CHECKING);
      console.log(`[supervisor] @${config.mindName}: Reviewing (iteration ${iteration})`);
      sm.transition(SupervisorState.REVIEWING);

      // Accumulate findings across all iterations, tagging each with its iteration
      for (const finding of pipelineResult.findings) {
        allFindings.push({ ...finding, iteration });
      }
      result.findings = allFindings;

      // Propagate deferred cross-repo annotations from check results
      if (ctx.checkResults?.deferredCrossRepoAnnotations?.length) {
        result.deferredCrossRepoAnnotations = ctx.checkResults.deferredCrossRepoAnnotations;
      }

      // ---- Verdict ----
      const approved = pipelineResult.approved ?? pipelineResult.ok;

      if (approved) {
        console.log(`[supervisor] @${config.mindName}: APPROVED on iteration ${iteration}`);
        sm.transition(SupervisorState.DONE);
        result.ok = true;
        result.approved = true;
        break;
      }

      // Check if we're at max iterations after this rejection
      if (sm.isMaxIterations()) {
        // Hard failures (boundary violations, test failures) cannot be overridden
        const checks = ctx.checkResults;
        const hasBoundaryViolation = checks?.boundaryPass === false;
        const hasTestFailure = checks?.testsPass === false;
        const hasContractViolation = checks?.contractsPass === false;

        if (hasBoundaryViolation || hasTestFailure || hasContractViolation) {
          const reasons = [
            hasBoundaryViolation && "boundary violations",
            hasTestFailure && "test failures",
            hasContractViolation && "contract violations",
          ].filter(Boolean).join(", ");
          console.log(
            `[supervisor] @${config.mindName}: Max iterations (${config.maxIterations}) reached with hard failures (${reasons}). FAILING.`
          );
          sm.transition(SupervisorState.FAILED);
          result.ok = false;
          result.approved = false;
          break;
        }

        console.log(
          `[supervisor] @${config.mindName}: Max iterations (${config.maxIterations}) reached. Approving with warnings.`
        );
        sm.transition(SupervisorState.DONE);
        result.ok = true;
        result.approved = true;
        result.approvedWithWarnings = true;
        break;
      }

      // ---- Write feedback to the SAME worktree ----
      const verdict = ctx.verdict;
      const verdictFindings = verdict?.findings ?? pipelineResult.findings;
      console.log(
        `[supervisor] @${config.mindName}: REJECTED (${verdictFindings.length} findings). Writing feedback.`
      );

      const checks = ctx.checkResults;
      const testFailures = checks && !checks.testsPass ? checks.testOutput : undefined;
      const feedbackContent = buildFeedbackContent(iteration, verdictFindings, testFailures);
      writeFileSync(join(currentWorktree, `REVIEW-FEEDBACK-${iteration}.md`), feedbackContent);

      // Publish REVIEW_FEEDBACK signal
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.REVIEW_FEEDBACK,
        config.mindName, config.waveId,
        { iteration, findingsCount: verdictFindings.length },
      );

      // Exponential backoff before next iteration
      const backoffMs = Math.min(
        BASE_RETRY_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, iteration - 1),
        MAX_BACKOFF_MS,
      );
      console.log(
        `[supervisor] @${config.mindName}: Backoff ${backoffMs}ms before iteration ${iteration + 1}`,
      );
      await deps.delay(backoffMs);
    }

    // Handle edge case where loop exits due to isMaxIterations at START
    if (sm.getState() === SupervisorState.INIT) {
      sm.transition(SupervisorState.DONE);
      result.ok = true;
      result.approved = true;
      result.approvedWithWarnings = true;
    }

    // ---- Publish MIND_COMPLETE or MIND_FAILED ----
    if (result.ok) {
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_COMPLETE,
        config.mindName, config.waveId,
        { iterations: result.iterations, approvedWithWarnings: result.approvedWithWarnings },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_COMPLETE published`);
    } else {
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_FAILED,
        config.mindName, config.waveId,
        { iterations: result.iterations, error: result.errors.join("; ") },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_FAILED published`);
    }

  } catch (err) {
    const msg = `Supervisor error: ${errorMessage(err)}`;
    console.error(`[supervisor] @${config.mindName}: ${msg}`);
    result.errors.push(msg);
    result.ok = false;
    // Publish MIND_FAILED from catch block so the bus listener doesn't wait
    try {
      await deps.publishSignal(
        config.busUrl, config.channel,
        MindsEventType.MIND_FAILED,
        config.mindName, config.waveId,
        { error: msg },
      );
      console.log(`[supervisor] @${config.mindName}: MIND_FAILED published (from catch)`);
    } catch {
      // Best effort -- bus may be down too
    }
  } finally {
    // Record all tracked panes in the result for observability
    result.allPaneIds = [...allSpawnedPanes];
    result.totalPanesSpawned = allSpawnedPanes.length;

    // Cleanup: kill ALL spawned drone panes (not just the last one)
    for (const paneId of allSpawnedPanes) {
      await deps.killPane(paneId);
    }

    // Clean up sentinel file if present (skip if worktree was never resolved)
    const isPlaceholderWorktree = !currentWorktree || currentWorktree.startsWith("(");
    if (!isPlaceholderWorktree) {
      const sentinelPath = join(currentWorktree, SENTINEL_FILENAME);
      if (existsSync(sentinelPath)) {
        try { rmSync(sentinelPath, { force: true }); } catch { /* ignore */ }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pipeline resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve pipeline stages from SupervisorConfig.
 * Uses the same resolution order as resolvePipeline() but reads from config
 * fields rather than MindDescription.
 */
function resolvePipelineFromConfig(config: SupervisorConfig) {
  // If config has explicit pipeline stages, use them
  if (config.pipeline && config.pipeline.length > 0) {
    return config.pipeline;
  }

  // If config has a pipeline template name, resolve it
  if (config.pipelineTemplate) {
    // Build a minimal MindDescription-like object for resolvePipeline
    return resolvePipeline({
      name: config.mindName,
      pipeline_template: config.pipelineTemplate,
    } as any);
  }

  // Default: CODE_PIPELINE
  return CODE_PIPELINE;
}
