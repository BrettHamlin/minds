/**
 * poller.ts — Captures tmux pane output and detects completion patterns.
 */

import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────

export interface PollResult {
  status: "running" | "success" | "failure" | "stalled" | "timeout";
  output: string;
  markers: string[];
  elapsedMs: number;
}

export interface PollPatterns {
  success: RegExp[];
  failure: RegExp[];
}

export interface PollOptions {
  timeoutMs: number;
  pollIntervalMs: number;
  scrollback: number;
  stallThresholdMs: number;
}

// ── Default Patterns ───────────────────────────────────────────────────

export const TASKS_PATTERNS: PollPatterns = {
  success: [/Total task count:/i, /tasks\.md/, /valid.*true/i],
  failure: [/still failing after/i, /Error:/i, /valid.*false/i],
};

export const IMPLEMENT_PATTERNS: PollPatterns = {
  success: [/All waves merged successfully/i, /Implementation complete\./i],
  failure: [
    /Implementation completed with errors/i,
    /completed with failures/i,
    /failed with exit code/i,
    /Wave \d+ did not complete/i,
    /Merge failed/i,
    /Error starting bus/i,
    /port.*already in use/i,
    /EADDRINUSE/i,
    /FATAL:/i,
  ],
};

// ── Capture ────────────────────────────────────────────────────────────

/**
 * Capture pane content via the Tmux.ts CLI.
 * Exported for testability — tests can override this.
 */
export async function capturePaneOutput(
  paneTarget: string,
  scrollback: number,
  gravitasRoot: string,
): Promise<string> {
  const tmuxScript = join(gravitasRoot, "minds", "execution", "Tmux.ts");
  const proc = Bun.spawn(
    ["bun", tmuxScript, "capture", "--window", paneTarget, "--scrollback", String(scrollback)],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return "";
  return stdout;
}

// ── Poll Loop ──────────────────────────────────────────────────────────

/**
 * Extract only new content that appeared after the baseline snapshot.
 *
 * Strategy: the baseline is the pane content captured BEFORE a command is sent.
 * Each poll captures the full scrollback. We find where the baseline ends in the
 * current capture and only scan what follows. This prevents matching patterns
 * from old scrollback (previous sessions, prior commands).
 *
 * We match on the last N lines of the baseline to handle minor reflow/trimming
 * that tmux may do to the scrollback buffer.
 */
export function extractNewContent(fullOutput: string, baseline: string): string {
  if (!baseline) return fullOutput;

  // Use the last N lines of the baseline as an anchor to find where the
  // baseline ends in the current capture. Everything after that is new.
  // We try the last 5 lines first, falling back to fewer if needed.
  // This handles tmux trimming old scrollback from the top.
  const baselineLines = baseline.split("\n");
  // Remove trailing empty lines (tmux often adds whitespace at the end)
  while (baselineLines.length > 0 && baselineLines[baselineLines.length - 1].trim() === "") {
    baselineLines.pop();
  }

  if (baselineLines.length === 0) return fullOutput;

  // Try progressively shorter anchors (last 5, 4, 3, 2, 1 lines)
  const maxAnchor = Math.min(5, baselineLines.length);
  for (let len = maxAnchor; len >= 1; len--) {
    const anchor = baselineLines.slice(-len).join("\n");
    const anchorIndex = fullOutput.indexOf(anchor);
    if (anchorIndex !== -1) {
      return fullOutput.slice(anchorIndex + anchor.length);
    }
  }

  // Baseline anchor not found — the scrollback has been entirely
  // replaced with new content, so everything is new.
  return fullOutput;
}

export async function pollForCompletion(
  paneTarget: string,
  patterns: PollPatterns,
  opts: PollOptions,
  gravitasRoot: string,
  captureImpl: typeof capturePaneOutput = capturePaneOutput,
  baseline: string = "",
): Promise<PollResult> {
  const startTime = Date.now();
  let lastOutput = "";
  let lastChangeTime = startTime;

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= opts.timeoutMs) {
      return { status: "timeout", output: lastOutput, markers: [], elapsedMs: elapsed };
    }

    const fullOutput = await captureImpl(paneTarget, opts.scrollback, gravitasRoot);
    const newOutput = extractNewContent(fullOutput, baseline);

    // Check failure FIRST — failure takes priority over success.
    // If both patterns match, we want to report failure, not false success.
    const failureMarkers: string[] = [];
    for (const re of patterns.failure) {
      if (re.test(newOutput)) failureMarkers.push(re.source);
    }
    if (failureMarkers.length > 0) {
      return { status: "failure", output: fullOutput, markers: failureMarkers, elapsedMs: Date.now() - startTime };
    }

    // Check for success patterns
    const successMarkers: string[] = [];
    for (const re of patterns.success) {
      if (re.test(newOutput)) successMarkers.push(re.source);
    }
    if (successMarkers.length > 0) {
      return { status: "success", output: fullOutput, markers: successMarkers, elapsedMs: Date.now() - startTime };
    }

    // Stall detection: no new output for stallThresholdMs
    if (fullOutput !== lastOutput) {
      lastChangeTime = Date.now();
      lastOutput = fullOutput;
    } else if (Date.now() - lastChangeTime >= opts.stallThresholdMs) {
      return { status: "stalled", output: fullOutput, markers: [], elapsedMs: Date.now() - startTime };
    }

    await Bun.sleep(opts.pollIntervalMs);
  }
}
