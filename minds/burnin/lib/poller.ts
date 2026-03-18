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
    /Wave \d+ did not complete/i,
    /Merge failed/i,
    /Error starting bus/i,
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

export async function pollForCompletion(
  paneTarget: string,
  patterns: PollPatterns,
  opts: PollOptions,
  gravitasRoot: string,
  captureImpl: typeof capturePaneOutput = capturePaneOutput,
): Promise<PollResult> {
  const startTime = Date.now();
  let lastOutput = "";
  let lastChangeTime = startTime;

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= opts.timeoutMs) {
      return { status: "timeout", output: lastOutput, markers: [], elapsedMs: elapsed };
    }

    const output = await captureImpl(paneTarget, opts.scrollback, gravitasRoot);

    // Check for success patterns
    const successMarkers: string[] = [];
    for (const re of patterns.success) {
      if (re.test(output)) successMarkers.push(re.source);
    }
    if (successMarkers.length > 0) {
      return { status: "success", output, markers: successMarkers, elapsedMs: Date.now() - startTime };
    }

    // Check for failure patterns
    const failureMarkers: string[] = [];
    for (const re of patterns.failure) {
      if (re.test(output)) failureMarkers.push(re.source);
    }
    if (failureMarkers.length > 0) {
      return { status: "failure", output, markers: failureMarkers, elapsedMs: Date.now() - startTime };
    }

    // Stall detection: no new output for stallThresholdMs
    if (output !== lastOutput) {
      lastChangeTime = Date.now();
      lastOutput = output;
    } else if (Date.now() - lastChangeTime >= opts.stallThresholdMs) {
      return { status: "stalled", output, markers: [], elapsedMs: Date.now() - startTime };
    }

    await Bun.sleep(opts.pollIntervalMs);
  }
}
