/**
 * collect-results.ts — Stage executor for reading output into stage context.
 *
 * Collects output from a previous run-command stage (via ctx.store.commandOutput)
 * or from a specific file on disk. Collection itself never fails — a missing
 * file is a warning, not an error.
 *
 * Configuration:
 *   stage.config.outputFile — Path relative to worktree to read (string, optional).
 *                             If set, reads that file. Otherwise reads ctx.store.commandOutput.
 *
 * Stores:
 *   ctx.store.collectedOutput — The collected content (string).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

export const executeCollectResults = async (
  stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const outputFile = stage.config?.outputFile as string | undefined;

  if (outputFile) {
    const fullPath = join(ctx.worktree, outputFile);

    if (!existsSync(fullPath)) {
      ctx.store.collectedOutput = `[warning] File not found: ${outputFile}`;
      return { ok: true };
    }

    try {
      ctx.store.collectedOutput = readFileSync(fullPath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.store.collectedOutput = `[warning] Could not read ${outputFile}: ${msg}`;
    }

    return { ok: true };
  }

  // No outputFile — fall back to commandOutput from store
  const commandOutput = ctx.store.commandOutput;
  ctx.store.collectedOutput = commandOutput != null ? String(commandOutput) : "";

  return { ok: true };
};
