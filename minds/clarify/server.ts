/**
 * Clarify Mind — pipeline clarify stage Q&A protocol, findings emission,
 * and resolution handling.
 *
 * Owns: clarify phase command (src/commands/collab.clarify.md),
 * clarify Mind source (minds/clarify/).
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "run clarify phase": {
      // The clarify phase is executed by the agent via collab.clarify.md.
      // This intent documents the capability; actual orchestration happens
      // through the pipeline command. Return a summary of the clarify protocol.
      return {
        status: "handled",
        result: {
          protocol: "batch-questions",
          steps: [
            "prerequisites-check",
            "detect-execution-mode",
            "load-spec",
            "classify-ticket-type",
            "codebase-scan",
            "ambiguity-scan",
            "generate-questions",
            "resolve-questions",
            "integrate-answers",
            "emit-completion-signal",
          ],
          batchSignal: "CLARIFY_QUESTIONS",
          completionSignal: "CLARIFY_COMPLETE",
        },
      };
    }

    case "group findings": {
      const { groupFindings } = await import("./group-questions.js");
      const findings = ctx.findings as unknown[] | undefined;
      if (!findings || !Array.isArray(findings)) {
        return { status: "handled", error: "Missing or invalid context.findings array" };
      }
      const grouped = groupFindings(findings as Parameters<typeof groupFindings>[0]);
      return { status: "handled", result: { grouped } };
    }

    case "apply resolutions": {
      // Resolution application is performed by the agent reading the resolutions file
      // and updating the spec. This capability confirms the contract for callers.
      const featureDir = ctx.featureDir as string | undefined;
      const phase = ctx.phase as string | undefined;
      const round = ctx.round as number | undefined;
      if (!featureDir || !phase) {
        return { status: "handled", error: "Missing context.featureDir or context.phase" };
      }
      const { checkForResolutions } = await import("../pipeline_core/questions.js");
      const resolutions = checkForResolutions(featureDir, phase, round ?? 1);
      if (!resolutions) {
        return {
          status: "handled",
          result: {
            available: false,
            message: `No resolutions found for ${phase} round ${round ?? 1} in ${featureDir}`,
          },
        };
      }
      return {
        status: "handled",
        result: {
          available: true,
          resolutions: resolutions.resolutions,
          round: resolutions.round,
          phase: resolutions.phase,
        },
      };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "clarify",
  domain: "Pipeline clarify stage: Q&A protocol, batch findings emission, resolution handling, interactive and non-interactive modes.",
  keywords: ["clarify", "question", "finding", "resolution", "batch", "ambiguity", "spec", "qa", "interactive"],
  owns_files: ["minds/clarify/", "src/commands/collab.clarify.md"],
  capabilities: [
    "run clarify phase",
    "group findings",
    "apply resolutions",
  ],
  exposes: ["run clarify phase", "group findings", "apply resolutions"],
  consumes: [
    "pipeline_core/findingsPath",
    "pipeline_core/resolutionsPath",
    "pipeline_core/loadPipelineForTicket",
    "signals/emit-signal",
  ],
  handle,
});
