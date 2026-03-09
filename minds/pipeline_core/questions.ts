/**
 * questions.ts — Shared batch question/answer protocol for pipeline phases.
 *
 * Used by clarify, spec-critique, and analyze phases to collect findings and
 * resolve them via either interactive (AskUserQuestion) or non-interactive
 * (batch signal) modes.
 *
 * Install path: .minds/lib/pipeline/questions.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { execSync } from "child_process";
import { getRepoRoot } from "./repo";
import { resolvePipelineConfigPath } from "./pipeline";
import { findingsPath, resolutionsPath } from "./paths";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single finding requiring an answer. */
export interface Finding {
  id: string; // "f1", "f2", etc.
  question: string; // Open-ended question for the orchestrator/user
  context: {
    why: string; // Why this question matters for the implementation
    specReferences: string[]; // Relevant spec sections/quotes
    codePatterns: string[]; // What the agent already found in the codebase
    constraints: string[]; // Known constraints that limit the answer space
    implications: string[]; // What downstream decisions depend on this answer
  };
}

/** A batch of findings from a phase for a given round. */
export interface FindingsBatch {
  phase: string; // "clarify" | "spec_critique" | "analyze"
  round: number; // 1, 2, ... for dependent rounds
  ticketId: string;
  findings: Finding[];
  specExcerpt: string; // Relevant spec content for orchestrator context
}

/** An answer to a single finding. */
export interface Resolution {
  findingId: string;
  answer: string; // Free-form reasoned answer
  reasoning: string; // How it arrived there (audit trail)
  sources: string[]; // Files/patterns it consulted
}

/** A batch of resolutions from the orchestrator or user. */
export interface ResolutionBatch {
  phase: string;
  round: number;
  resolutions: Resolution[];
}

// ── QuestionCollector ────────────────────────────────────────────────────────

/**
 * Collects findings during phase analysis.
 * Phases call .add() for each question found, then pass the collector
 * to resolveAndApply().
 */
export class QuestionCollector {
  private findings: Finding[] = [];
  private counter = 1;

  constructor(
    public readonly phase: string,
    public readonly ticketId: string,
    public readonly specExcerpt: string = "",
  ) {}

  /** Add a finding to the collection. Returns the assigned finding ID. */
  add(question: string, context: Finding["context"]): string {
    const id = `f${this.counter++}`;
    this.findings.push({ id, question, context });
    return id;
  }

  /** Get all collected findings. */
  getFindings(): Finding[] {
    return [...this.findings];
  }

  /** Returns true if no questions have been collected. */
  isEmpty(): boolean {
    return this.findings.length === 0;
  }

  /** Build a FindingsBatch for a given round. */
  toBatch(round: number): FindingsBatch {
    return {
      phase: this.phase,
      round,
      ticketId: this.ticketId,
      findings: this.getFindings(),
      specExcerpt: this.specExcerpt,
    };
  }
}

// ── Mode resolution ──────────────────────────────────────────────────────────

export type InteractiveMode = "interactive" | "non-interactive";

export interface ModeResolutionOptions {
  /**
   * Path to pipeline.json. Defaults to .minds/config/pipeline.json
   * resolved from the git repo root.
   */
  pipelineConfigPath?: string;
  /** Phase name to check for per-phase override. */
  phase?: string;
  /**
   * Override: force a specific mode without reading pipeline.json.
   * Useful for testing.
   */
  forceMode?: InteractiveMode;
  /**
   * Default mode when no explicit interactive config is found.
   * Defaults to "interactive" (preserves existing behavior for non-orchestrated runs).
   * Pass "non-interactive" for orchestrated pipelines where absence of config = batch mode.
   */
  defaultMode?: InteractiveMode;
}

/**
 * Determine whether the current phase should run in interactive or
 * non-interactive mode by reading the pipeline.json @interactive config.
 *
 * Resolution order:
 *  1. forceMode (if provided)
 *  2. Per-phase interactive override from pipeline.json phases[phase].interactive
 *  3. Global interactive from pipeline.json .interactive.enabled
 *  4. Default: "interactive" (preserves current behavior)
 */
export function resolveMode(options: ModeResolutionOptions = {}): InteractiveMode {
  if (options.forceMode) return options.forceMode;

  try {
    const configPath =
      options.pipelineConfigPath ?? resolvePipelineConfigPath(getRepoRoot());
    if (!configPath || !existsSync(configPath)) return options.defaultMode ?? "interactive";

    const raw = readFileSync(configPath, "utf-8");
    const pipeline = JSON.parse(raw) as Record<string, any>;

    // Check per-phase override first
    if (options.phase) {
      const phases = (pipeline.phases as Record<string, any>) ?? {};
      const phase = (phases[options.phase] as Record<string, any>) ?? {};
      const phaseInteractive = phase.interactive as { enabled?: boolean } | undefined;
      if (phaseInteractive !== undefined && typeof phaseInteractive.enabled === "boolean") {
        return phaseInteractive.enabled ? "interactive" : "non-interactive";
      }
    }

    // Fall back to global interactive directive
    const globalInteractive = pipeline.interactive as { enabled?: boolean } | undefined;
    if (globalInteractive !== undefined && typeof globalInteractive.enabled === "boolean") {
      return globalInteractive.enabled ? "interactive" : "non-interactive";
    }
  } catch {
    // Any error → fall back to defaultMode or interactive (safe default)
  }

  return options.defaultMode ?? "interactive";
}

// ── Non-interactive: emit batch + await answers ───────────────────────────────

/**
 * Write a FindingsBatch to the findings file and emit the _QUESTIONS signal.
 * Returns the path to the findings file.
 */
export async function emitQuestionBatch(
  batch: FindingsBatch,
  featureDir: string,
): Promise<string> {
  const filePath = findingsPath(featureDir, batch.phase, batch.round);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(batch, null, 2));

  // Emit the _QUESTIONS signal with the findings file path as detail
  const signal = `${batch.phase.toUpperCase()}_QUESTIONS`;
  try {
    execSync(
      `bun .minds/handlers/emit-phase-signal.ts "${signal}" "${filePath}"`,
      { stdio: "inherit" },
    );
  } catch {
    // emit-phase-signal.ts may not be available in all environments
    // (e.g., unit tests). Log and continue.
    console.error(
      `[questions] Warning: could not emit signal ${signal}. Continuing.`,
    );
  }

  return filePath;
}

/**
 * Check for existing resolutions written by the orchestrator.
 * Returns the ResolutionBatch if already available, or null if not yet resolved.
 *
 * The agent should NOT poll or wait. The orchestrator will:
 * 1. Receive the _QUESTIONS signal
 * 2. Resolve questions and write the resolutions file
 * 3. Re-dispatch the phase to the agent via tmux
 *
 * On re-dispatch, the agent calls this again and finds the resolutions.
 */
export function checkForResolutions(
  featureDir: string,
  phase: string,
  round: number,
): ResolutionBatch | null {
  const filePath = resolutionsPath(featureDir, phase, round);

  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ResolutionBatch;
  }

  return null;
}

/**
 * @deprecated Use checkForResolutions instead. The agent should not poll —
 * the orchestrator re-dispatches the phase after writing resolutions.
 * Kept for backwards compatibility; immediately checks and returns or throws.
 */
export async function awaitAnswers(
  featureDir: string,
  phase: string,
  round: number,
): Promise<ResolutionBatch> {
  const resolutions = checkForResolutions(featureDir, phase, round);
  if (resolutions) return resolutions;

  // Instead of polling, inform the caller that resolutions aren't ready yet.
  // The agent should emit the _QUESTIONS signal and end its response.
  // The orchestrator will re-dispatch after writing resolutions.
  throw new Error(
    `[questions] Resolutions not yet available for ${phase} round ${round}. ` +
    `The orchestrator will re-dispatch this phase after resolving questions.`,
  );
}

// ── Interactive: present questions via AskUserQuestion ────────────────────────

/**
 * Present a finding interactively using AskUserQuestion tool.
 *
 * NOTE: This function outputs the question in a format the agent can use
 * to call AskUserQuestion. Since the AskUserQuestion tool is called by
 * the agent (not by TypeScript), this function returns a structured prompt
 * that the agent should pass to AskUserQuestion.
 *
 * In practice, skill commands use this indirectly — the shared library
 * instructs the agent to call AskUserQuestion with the finding's question
 * and context as the options/descriptions.
 *
 * Returns a Resolution from the user's answer.
 */
export function presentInteractive(
  finding: Finding,
): { question: string; header: string; contextSummary: string } {
  const contextSummary = [
    finding.context.why ? `**Why it matters:** ${finding.context.why}` : "",
    finding.context.specReferences.length > 0
      ? `**Spec references:** ${finding.context.specReferences.join("; ")}`
      : "",
    finding.context.constraints.length > 0
      ? `**Constraints:** ${finding.context.constraints.join("; ")}`
      : "",
    finding.context.implications.length > 0
      ? `**Implications:** ${finding.context.implications.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    question: finding.question,
    header: `Finding ${finding.id}`,
    contextSummary,
  };
}

// ── Top-level orchestrator ────────────────────────────────────────────────────

export interface ResolveAndApplyOptions {
  /** Feature directory (where findings/ and resolutions/ live) */
  featureDir: string;
  /** Round number (default: 1) */
  round?: number;
  /** Mode override for testing */
  forceMode?: InteractiveMode;
  /** Pipeline config path override for testing */
  pipelineConfigPath?: string;
}

/**
 * Top-level function for skills to call after collecting findings.
 *
 * In interactive mode:
 *   - Returns finding display data for each finding (agent calls AskUserQuestion)
 *   - Returns a promise resolving to Resolution[] from user answers
 *
 * In non-interactive mode:
 *   - Writes findings to disk
 *   - Emits _QUESTIONS signal
 *   - Polls for resolutions file
 *   - Returns Resolution[]
 *
 * The skill then applies the resolutions to its artifacts.
 */
export async function resolveAndApply(
  collector: QuestionCollector,
  options: ResolveAndApplyOptions,
): Promise<{
  mode: InteractiveMode;
  resolutions: Resolution[];
  /** In interactive mode: structured data for AskUserQuestion calls */
  interactiveQuestions?: Array<ReturnType<typeof presentInteractive> & { findingId: string }>;
}> {
  const round = options.round ?? 1;
  const mode = resolveMode({
    forceMode: options.forceMode,
    pipelineConfigPath: options.pipelineConfigPath,
    phase: collector.phase,
  });

  if (collector.isEmpty()) {
    return { mode, resolutions: [] };
  }

  if (mode === "interactive") {
    // Return structured questions for the agent to present via AskUserQuestion
    const interactiveQuestions = collector.getFindings().map((finding) => ({
      findingId: finding.id,
      ...presentInteractive(finding),
    }));

    // In interactive mode, the agent calls AskUserQuestion and wraps answers
    // into Resolutions itself. We return the question data for it to use.
    return {
      mode,
      resolutions: [], // Agent fills these in after AskUserQuestion calls
      interactiveQuestions,
    };
  }

  // Non-interactive mode: emit batch and await answers
  const batch = collector.toBatch(round);
  await emitQuestionBatch(batch, options.featureDir);
  const resolutionBatch = await awaitAnswers(
    options.featureDir,
    collector.phase,
    round,
  );

  return { mode, resolutions: resolutionBatch.resolutions };
}
