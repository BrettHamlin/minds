/**
 * Tmux client — shared tmux utilities for pipelang runner and orchestrator.
 *
 * Provides both a low-level functional API (used by pipelang runner) and
 * the core operations used by orchestrator scripts via Tmux.ts CLI.
 */

import { spawnSync } from "bun";

// ============================================================================
// Low-level functional API (used by pipelang runner)
// ============================================================================

/** Simple pipelang signal format: [SIGNAL] SIGNAL_NAME */
const PIPELANG_SIGNAL_RE = /\[SIGNAL\]\s+([A-Z][A-Z0-9_]+)/;

export function tmux(...args: string[]): { out: string; ok: boolean } {
  const r = spawnSync(["tmux", ...args]);
  return {
    out: new TextDecoder().decode(r.stdout).trim(),
    ok: r.exitCode === 0,
  };
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send text to a tmux pane and then submit with C-m.
 * A 1 second delay between the text and C-m is the battle-tested default
 * for Claude Code tmux automation — 100ms is too fast and causes missed submits.
 */
export async function sendToPane(paneId: string, text: string, delayMs = 1000): Promise<void> {
  tmux("send-keys", "-t", paneId, text);
  await sleepMs(delayMs);
  tmux("send-keys", "-t", paneId, "C-m");
}

/**
 * Open a new tmux window in `session` running `windowCmd`.
 * Returns the pane ID (%N) on success, null after 3 failed attempts.
 *
 * Reliability fix: retries with exponential back-off (100ms -> 200ms -> 400ms).
 */
export async function openAgentPane(
  session: string,
  windowName: string,
  windowCmd: string,
  workDir: string
): Promise<string | null> {
  const delays = [100, 200, 400];

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = tmux(
      "new-window",
      "-t",
      session,
      "-n",
      windowName,
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-c",
      workDir,
      windowCmd
    );

    if (r.ok && /^%\d+$/.test(r.out)) {
      return r.out;
    }

    if (attempt < 2) {
      await sleepMs(delays[attempt]);
    }
  }

  return null;
}

/**
 * Poll `capture-pane` every 250ms until one of `allowedSignals` appears in the
 * pane output or `timeoutMs` expires.
 */
export async function pollForSignal(
  paneId: string,
  allowedSignals: string[],
  timeoutMs: number
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { out, ok } = tmux("capture-pane", "-t", paneId, "-p", "-S", "-500");

    if (ok) {
      for (const line of out.split("\n")) {
        const m = line.match(PIPELANG_SIGNAL_RE);
        if (m && allowedSignals.includes(m[1])) {
          return m[1];
        }
      }
    }

    await sleepMs(250);
  }

  return null;
}

// ============================================================================
// TmuxClient class (higher-level orchestrator API)
// ============================================================================

export interface TmuxClientOptions {
  /** Default delay (ms) between text and C-m in sendKeys. Default: 1000 */
  defaultDelayMs?: number;
}

/**
 * Higher-level tmux client for orchestrator use.
 * Wraps the functional API with instance state (current pane target etc.)
 */
export class TmuxClient {
  private readonly defaultDelayMs: number;

  constructor(opts: TmuxClientOptions = {}) {
    this.defaultDelayMs = opts.defaultDelayMs ?? 1000;
  }

  /** Run a raw tmux command and return its output */
  run(...args: string[]): { out: string; ok: boolean } {
    return tmux(...args);
  }

  /** Send text to a pane, then submit with C-m after delayMs */
  async sendKeys(paneId: string, text: string, delayMs?: number): Promise<void> {
    return sendToPane(paneId, text, delayMs ?? this.defaultDelayMs);
  }

  /** Capture the current content of a pane */
  capturePane(paneId: string, lines = 500): string {
    const { out } = tmux("capture-pane", "-t", paneId, "-p", "-S", `-${lines}`);
    return out;
  }

  /** Check whether a pane exists */
  paneExists(paneId: string): boolean {
    return tmux("display-message", "-t", paneId, "-p", "#{pane_id}").ok;
  }

  /** Open an agent pane in a new window and return its pane ID, or null on failure */
  openAgentPane(
    session: string,
    windowName: string,
    windowCmd: string,
    workDir: string
  ): Promise<string | null> {
    return openAgentPane(session, windowName, windowCmd, workDir);
  }

  /**
   * Split an existing pane horizontally and run a command in the new pane.
   * Returns the new pane ID (%N) on success, null on failure.
   * @param targetPane - Pane to split (e.g. %123)
   * @param cmd - Command to run in the new pane
   * @param percentage - Percentage of width for the new pane (default 70)
   */
  splitPane(targetPane: string, cmd: string, percentage = 70): string | null {
    const args = [
      "split-window",
      "-h",
      "-t", targetPane,
      "-p", String(percentage),
      "-P",
      "-F", "#{pane_id}",
      cmd,
    ];
    const r = tmux(...args);
    if (r.ok && /^%\d+$/.test(r.out)) {
      return r.out;
    }
    return null;
  }

  /** Poll a pane for one of the allowed signals */
  pollForSignal(
    paneId: string,
    allowedSignals: string[],
    timeoutMs: number
  ): Promise<string | null> {
    return pollForSignal(paneId, allowedSignals, timeoutMs);
  }

  /** Sleep for ms milliseconds */
  sleep(ms: number): Promise<void> {
    return sleepMs(ms);
  }
}
