/**
 * eval-score.ts — Stage executor for eval-factory code quality scoring.
 *
 * Phase 1: observation-only. Computes scores, logs them, appends to history.
 * Always returns ok: true (no enforcement). Findings are informational.
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import type { ReviewFinding } from "../supervisor-types.ts";

// Dynamic import for eval-factory (file: dependency)
// These are imported at function call time to handle cases where eval-factory isn't installed
async function getEvalFactory() {
  const { computeScore } = await import("eval-factory/scoring");
  const { parseDiffFilePaths, filterScorableFiles, aggregateScores, appendHistoryEntry } = await import("eval-factory/supervisor");
  const { getProfile, detectLanguage } = await import("eval-factory/lang");
  return { computeScore, parseDiffFilePaths, filterScorableFiles, aggregateScores, appendHistoryEntry, getProfile, detectLanguage };
}

export const executeEvalScore = async (
  stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { supervisorConfig: config, checkResults, worktree } = ctx;

  if (!checkResults?.diff) {
    // No diff available — skip silently
    return { ok: true };
  }

  let ef: Awaited<ReturnType<typeof getEvalFactory>>;
  try {
    ef = await getEvalFactory();
  } catch (err) {
    // eval-factory not installed — skip gracefully
    return { ok: true, findings: [{
      file: "(eval-factory)",
      line: 0,
      severity: "warning",
      message: `eval-factory not available: ${err instanceof Error ? err.message : String(err)}`,
    }] };
  }

  try {
    // 1. Extract changed files from diff
    const changedFiles = ef.parseDiffFilePaths(checkResults.diff);
    if (changedFiles.length === 0) {
      return { ok: true };
    }

    // 2. Detect language and get profile for test pattern filtering
    const repoRoot = config.mindRepoRoot ?? config.repoRoot;
    const language = ef.detectLanguage(changedFiles[0]);
    let testPatterns: RegExp[] = [];
    let langProfile: ReturnType<typeof ef.getProfile> | undefined;
    try {
      langProfile = ef.getProfile(language);
      const rawPatterns = langProfile.discovery?.testPatterns ?? [];
      testPatterns = rawPatterns.map((p: string) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    } catch {
      // No profile for this language — use default test patterns
      testPatterns = [/\.test\./i, /\.spec\./i, /__tests__/i];
    }

    // 3. Filter to scorable files (exclude tests, config, binary, etc.)
    const extensions = changedFiles
      .map(f => f.split('.').pop()?.toLowerCase())
      .filter(Boolean) as string[];
    const uniqueExtensions = [...new Set(extensions)].map(e => `.${e}`);

    const scorableFiles = ef.filterScorableFiles(changedFiles, {
      extensions: uniqueExtensions,
      testPatterns,
    });

    if (scorableFiles.length === 0) {
      return { ok: true };
    }

    // 4. Score each file
    const fileScores: Array<{ file: string; score: number; lineCount: number; signals: Record<string, number> }> = [];

    for (const filePath of scorableFiles) {
      const absolutePath = join(worktree, filePath);
      let content: string;
      try {
        content = readFileSync(absolutePath, "utf-8");
      } catch {
        continue; // File deleted or not readable
      }

      const result = await ef.computeScore(content, langProfile ? { profile: langProfile } : {});
      fileScores.push({
        file: filePath,
        score: result.score,
        lineCount: content.split("\n").length,
        signals: Object.fromEntries(result.signals.map(s => [s.signal, s.score])),
      });
    }

    if (fileScores.length === 0) {
      return { ok: true };
    }

    // 5. Aggregate scores
    const aggregate = ef.aggregateScores(fileScores);

    // 6. Store in context for downstream stages (LLM review prompt injection)
    ctx.store.evalScore = aggregate;

    // 7. Append to history (observation-only)
    try {
      ef.appendHistoryEntry(repoRoot, {
        timestamp: new Date().toISOString(),
        mindName: config.mindName,
        score: aggregate.score,
        fileCount: aggregate.fileCount,
        aggregationMethod: aggregate.aggregationMethod,
        files: aggregate.files.map(f => ({ file: f.file, score: f.score })),
      });
    } catch {
      // History write failure is non-fatal in Phase 1
    }

    // 8. Build informational findings
    const findings: ReviewFinding[] = [];

    // Overall score finding
    findings.push({
      file: "(eval-factory)",
      line: 0,
      severity: "warning",
      message: `Code quality score: ${aggregate.score}/100 (${aggregate.fileCount} files, method: ${aggregate.aggregationMethod})`,
    });

    // Flag low-scoring files
    for (const fileScore of aggregate.files) {
      if (fileScore.score < 50) {
        findings.push({
          file: fileScore.file,
          line: 0,
          severity: "warning",
          message: `Low quality score: ${fileScore.score}/100`,
        });
      }
    }

    // Phase 1: always pass (observation-only)
    return {
      ok: true,
      findings,
    };
  } catch (err) {
    // eval-factory scoring failure is non-fatal
    return {
      ok: true,
      findings: [{
        file: "(eval-factory)",
        line: 0,
        severity: "warning",
        message: `eval-factory scoring failed: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
};
