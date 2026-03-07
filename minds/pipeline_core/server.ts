/**
 * Pipeline Core Mind — types, registry CRUD, signal definitions, transitions,
 * paths, repo-registry, and feature directory resolution.
 *
 * Owns: types, registry, signal, transitions, paths, questions, task-phases,
 * errors, tmux-client, status-emitter, repo-registry, repo, json-io,
 * pipeline config loading, feature metadata, validation.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "load pipeline for ticket": {
      const { loadPipelineForTicket } = await import("./pipeline.js");
      const ticketId = ctx.ticketId as string | undefined;
      const repoRoot = ctx.repoRoot as string | undefined;
      if (!ticketId || !repoRoot) {
        return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
      }
      try {
        const result = loadPipelineForTicket(repoRoot, ticketId);
        return { status: "handled", result };
      } catch (err: any) {
        return { status: "handled", error: err.message };
      }
    }

    case "resolve signal name": {
      const { getAllowedSignals } = await import("./signal.js");
      const phaseName = ctx.phaseName as string | undefined;
      const pipeline = ctx.pipeline as Record<string, any> | undefined;
      if (!phaseName || !pipeline) {
        return { status: "handled", error: "Missing context.phaseName or context.pipeline" };
      }
      const signals = getAllowedSignals(pipeline, phaseName);
      return { status: "handled", result: { signals } };
    }

    case "get registry path": {
      const { registryPath } = await import("./paths.js");
      const ticketId = ctx.ticketId as string | undefined;
      const repoRoot = ctx.repoRoot as string | undefined;
      if (!ticketId || !repoRoot) {
        return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
      }
      return { status: "handled", result: { path: registryPath(repoRoot, ticketId) } };
    }

    case "resolve transition": {
      const { resolveTransition } = await import("./transitions.js");
      const signal = ctx.signal as string | undefined;
      const pipeline = ctx.pipeline as Record<string, any> | undefined;
      const registry = ctx.registry as Record<string, any> | undefined;
      if (!signal || !pipeline) {
        return { status: "handled", error: "Missing context.signal or context.pipeline" };
      }
      try {
        const result = resolveTransition(signal, pipeline, registry ?? {});
        return { status: "handled", result };
      } catch (err: any) {
        return { status: "handled", error: err.message };
      }
    }

    case "find feature dir": {
      const { findFeatureDir } = await import("./feature.js");
      const ticketId = ctx.ticketId as string | undefined;
      const repoRoot = ctx.repoRoot as string | undefined;
      const branch = ctx.branch as string | undefined;
      if (!ticketId || !repoRoot) {
        return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
      }
      const dir = findFeatureDir(repoRoot, ticketId, branch ? { branch } : undefined);
      return { status: "handled", result: { dir } };
    }

    case "read feature metadata": {
      const { readMetadataJson, readFeatureMetadata } = await import("./feature.js");
      const ticketId = ctx.ticketId as string | undefined;
      const featureDirPath = ctx.featureDirPath as string | undefined;
      const specsDir = ctx.specsDir as string | undefined;
      if (featureDirPath) {
        const metadata = readMetadataJson(featureDirPath);
        return { status: "handled", result: { metadata } };
      }
      if (ticketId && specsDir) {
        const metadata = readFeatureMetadata(specsDir, ticketId);
        return { status: "handled", result: { metadata } };
      }
      return { status: "handled", error: "Missing context.featureDirPath or (context.ticketId + context.specsDir)" };
    }

    case "validate ticket id": {
      const { validateTicketIdArg } = await import("./validation.js");
      const args = ctx.args as string[] | undefined;
      const scriptName = ctx.scriptName as string | undefined;
      if (!args || !scriptName) {
        return { status: "handled", error: "Missing context.args or context.scriptName" };
      }
      validateTicketIdArg(args, scriptName);
      return { status: "handled", result: { ok: true } };
    }

    case "read json file": {
      const { readJsonFile } = await import("./json-io.js");
      const filePath = ctx.filePath as string | undefined;
      if (!filePath) {
        return { status: "handled", error: "Missing context.filePath" };
      }
      const data = readJsonFile(filePath);
      return { status: "handled", result: { data } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "pipeline_core",
  domain: "Pipeline types, registry CRUD, signal definitions, transitions, paths, repo-registry, and feature directory resolution.",
  keywords: ["pipeline", "registry", "signal", "transition", "path", "feature", "metadata", "ticket", "repo", "types"],
  owns_files: ["minds/pipeline_core/"],
  capabilities: [
    "load pipeline for ticket",
    "resolve signal name",
    "get registry path",
    "resolve transition",
    "find feature dir",
    "read feature metadata",
    "validate ticket id",
    "read json file",
  ],
  exposes: [
    "loadPipelineForTicket",
    "resolveSignalName",
    "registryPath",
    "findingsPath",
    "resolutionsPath",
    "signalQueuePath",
    "resolveTransition",
    "findFeatureDir",
    "readFeatureMetadata",
    "validateTicketIdArg",
    "readJsonFile",
    "parseTaskPhases",
    "FeatureMetadata type",
    "CompiledPipeline type",
  ],
  consumes: [],
  handle,
});
