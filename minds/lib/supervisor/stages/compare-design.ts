/**
 * compare-design.ts — Pipeline stage that runs visual verification.
 *
 * Takes screenshots of the live page and mockup using Playwright CLI (deterministic),
 * then passes both images to claude -p for visual comparison (multimodal LLM).
 *
 * No-op when `supervisorConfig.mockupInfo` is not set.
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import type { ReviewFinding } from "../supervisor-types.ts";

// ---------------------------------------------------------------------------
// Screenshot helpers (deterministic — no LLM)
// ---------------------------------------------------------------------------

/**
 * Take a screenshot of a URL or local file using Playwright CLI.
 * Returns the path to the screenshot, or an error message.
 */
function takeScreenshot(source: string, outputPath: string): { ok: boolean; error?: string } {
  // Expand ~ to HOME for local files
  let url = source;
  if (!source.startsWith("http://") && !source.startsWith("https://")) {
    const expanded = source.replace(/^~/, process.env.HOME ?? "");
    const abs = resolve(expanded);
    if (!existsSync(abs)) {
      return { ok: false, error: `File not found: ${source}` };
    }
    url = `file://${abs}`;
  }

  const result = Bun.spawnSync(
    ["npx", "playwright", "screenshot", url, outputPath, "--full-page"],
    { stdout: "pipe", stderr: "pipe", timeout: 30_000 },
  );

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    return { ok: false, error: `Playwright screenshot failed: ${stderr || `exit code ${result.exitCode}`}` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Visual comparison prompt
// ---------------------------------------------------------------------------

function buildVisualComparisonPrompt(liveScreenshotPath: string, mockupScreenshotPath: string): string {
  return `You are comparing two screenshots of a web page.

Image 1 (live page): Read the file at ${liveScreenshotPath}
Image 2 (design mockup): Read the file at ${mockupScreenshotPath}

Read both images and visually compare them. Look for differences in:
1. Layout — missing sections, wrong panel order, different grid/flex structure
2. Colors — background colors, text colors, border colors, accent colors
3. Typography — wrong font family, font size, font weight
4. Spacing — padding, margins, gaps between elements
5. Components — missing buttons, icons, inputs, cards, toggles
6. Content — missing labels, wrong text, missing headings
7. Visual indicators — status dots, badges, change markers

If the pages match (no meaningful visual differences), output exactly:
NO_DIFFERENCES

If there ARE differences, output a summary line followed by numbered findings:

SUMMARY: N layout differences, N color differences, N missing elements

- VF001: <description>
  HAVE: <what the live page shows>
  WANT: <what the mockup shows>
  FIX: <exactly what code change to make, including file path>

Be specific — reference exact CSS properties, hex colors, pixel values where visible.
Do NOT output anything else — just NO_DIFFERENCES or the summary + findings.`;
}

// ---------------------------------------------------------------------------
// Output parsing (exported for reuse by implement.ts)
// ---------------------------------------------------------------------------

/**
 * Parse the compare-design output into a list of differences.
 * Expects either "NO_DIFFERENCES" or a list of "- VF001: ..." items with HAVE/WANT/FIX.
 */
export function parseCompareDesignOutput(raw: string): {
  passed: boolean;
  differences: string[];
} {
  const trimmed = raw.trim();

  if (trimmed === "NO_DIFFERENCES" || trimmed.includes("NO_DIFFERENCES")) {
    return { passed: true, differences: [] };
  }

  // Extract lines starting with "- " (the actionable fix items)
  const differences: string[] = [];
  for (const line of trimmed.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("- ")) {
      differences.push(stripped.slice(2).trim());
    }
  }

  // If no "- " lines found but output isn't NO_DIFFERENCES, treat entire output as one difference
  if (differences.length === 0 && trimmed.length > 0) {
    differences.push(trimmed);
  }

  return { passed: false, differences };
}

// ---------------------------------------------------------------------------
// Standalone runner (for implement.ts post-merge check)
// ---------------------------------------------------------------------------

/**
 * Run compare-design as a standalone check (not inside a pipeline).
 * Takes screenshots, calls claude -p, returns parsed results.
 */
export async function runCompareDesign(
  serverUrl: string,
  routePath: string,
  mockupPath: string,
  callLlmReview: (prompt: string, timeoutMs: number) => Promise<string>,
): Promise<{ passed: boolean; differences: string[] }> {
  const liveUrl = `${serverUrl}${routePath}`;
  const liveScreenshot = "/tmp/compare-live.png";
  const mockupScreenshot = "/tmp/compare-mockup.png";

  const liveResult = takeScreenshot(liveUrl, liveScreenshot);
  if (!liveResult.ok) {
    return {
      passed: false,
      differences: [`VF001: Page unreachable. HAVE: ${liveResult.error}. WANT: Full page renders at ${liveUrl}. FIX: Ensure the module is loaded and the route is registered.`],
    };
  }

  const mockupResult = takeScreenshot(mockupPath, mockupScreenshot);
  if (!mockupResult.ok) {
    return { passed: false, differences: [`Mockup screenshot failed: ${mockupResult.error}`] };
  }

  const prompt = buildVisualComparisonPrompt(liveScreenshot, mockupScreenshot);
  const output = await callLlmReview(prompt, 120_000);

  try { unlinkSync(liveScreenshot); } catch {}
  try { unlinkSync(mockupScreenshot); } catch {}

  return parseCompareDesignOutput(output);
}

// ---------------------------------------------------------------------------
// Stage executor
// ---------------------------------------------------------------------------

export const executeCompareDesign = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { mockupInfo } = ctx.supervisorConfig;

  // No-op when no mockup is configured
  if (!mockupInfo) {
    if (ctx.checkResults) {
      ctx.checkResults.compareDesignPass = true;
    }
    return { ok: true };
  }

  // Step 1: Take screenshots with Playwright CLI (deterministic)
  const liveUrl = `${mockupInfo.serverUrl}${mockupInfo.routePath}`;
  const liveScreenshot = "/tmp/compare-live.png";
  const mockupScreenshot = "/tmp/compare-mockup.png";

  const liveResult = takeScreenshot(liveUrl, liveScreenshot);
  if (!liveResult.ok) {
    // Page unreachable — this IS a finding (404, connection refused, etc.)
    if (ctx.checkResults) ctx.checkResults.compareDesignPass = false;
    return {
      ok: false,
      findings: [{
        file: "(visual-verification)",
        line: 0,
        severity: "error",
        message: `VF001: Page unreachable. HAVE: ${liveResult.error}. WANT: Full page renders at ${liveUrl}. FIX: Ensure the module is loaded and the route is registered.`,
      }],
      error: `Visual verification: live page unreachable — ${liveResult.error}`,
    };
  }

  const mockupResult = takeScreenshot(mockupInfo.mockupPath, mockupScreenshot);
  if (!mockupResult.ok) {
    return {
      ok: false,
      error: `Visual verification: mockup screenshot failed — ${mockupResult.error}`,
    };
  }

  // Step 2: Pass both screenshots to claude -p for visual comparison
  const prompt = buildVisualComparisonPrompt(liveScreenshot, mockupScreenshot);

  const output = await ctx.deps.callLlmReview(prompt, 120_000);

  // Cleanup screenshots
  try { unlinkSync(liveScreenshot); } catch {}
  try { unlinkSync(mockupScreenshot); } catch {}

  const { passed, differences } = parseCompareDesignOutput(output);

  if (passed) {
    if (ctx.checkResults) {
      ctx.checkResults.compareDesignPass = true;
    }
    return { ok: true };
  }

  // Each difference line is already actionable — pass straight to the drone as findings
  const findings: ReviewFinding[] = differences.map((diff) => ({
    file: "(visual-verification)",
    line: 0,
    severity: "error" as const,
    message: diff,
  }));

  if (ctx.checkResults) {
    ctx.checkResults.compareDesignPass = false;
  }

  return {
    ok: false,
    findings,
    error: `Visual verification: ${differences.length} difference(s) found`,
  };
};
