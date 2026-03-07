/**
 * dispatch.ts — Dispatch tasks to named Mind+Drone pairs.
 *
 * Used by minds/commands/implement.md to spin up Mind+Drone pairs,
 * write briefs, and send them to drone panes via tmux.
 *
 * Usage:
 *   import { dispatchToMind, waitForCompletion, dispatchWave } from "./dispatch.js";
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { MindDescription } from "./mind.js";

// --- Types ---

export interface DispatchResult {
  paneId: string;
  worktree: string;
  branch: string;
}

export interface CompletionResult {
  success: boolean;
  output?: string;
}

export interface DispatchOptions {
  branch?: string;
  base?: string;
  /** Repo root override — avoids git subprocess, used in tests */
  repoRoot?: string;
}

export interface WaitOptions {
  /** Poll interval in ms (default: 30000) */
  pollIntervalMs?: number;
  /** Total timeout in ms (default: 600000 = 10 min) */
  timeoutMs?: number;
}

// --- Internal helpers ---

function detectRepoRoot(): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe" });
  return new TextDecoder().decode(proc.stdout).trim();
}

/** Load and parse .collab/minds.json from the given path. Exported for testing. */
export function loadMindsRegistry(registryPath: string): MindDescription[] {
  const raw = readFileSync(registryPath, "utf-8");
  return JSON.parse(raw) as MindDescription[];
}

// --- Main API ---

/**
 * Dispatch a task brief to a named Mind's Drone.
 *
 * 1. Looks up the Mind in .collab/minds.json
 * 2. Creates a worktree + tmux split via dev-pane.ts
 * 3. Writes the brief to /tmp/mind-brief-{mindName}.md
 * 4. Sends the brief to the drone pane via tmux-send.ts
 *
 * Returns { paneId, worktree, branch } for monitoring.
 */
export async function dispatchToMind(
  mindName: string,
  brief: string,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const repoRoot = options.repoRoot ?? detectRepoRoot();
  const registryPath = resolve(repoRoot, ".collab/minds.json");
  const registry = loadMindsRegistry(registryPath);

  const mind = registry.find((m) => m.name === mindName);
  if (!mind) {
    throw new Error(`Mind not found in registry: "${mindName}"`);
  }

  // Build dev-pane.ts command
  const home = process.env.HOME ?? "/root";
  const devPaneCmd = ["bun", `${home}/.claude/bin/dev-pane.ts`];
  if (options.branch) devPaneCmd.push("--branch", options.branch);
  if (options.base) devPaneCmd.push("--base", options.base);

  // Create worktree + drone pane
  const devPaneProc = Bun.spawn(devPaneCmd, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await devPaneProc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(devPaneProc.stderr as ReadableStream).text();
    throw new Error(`dev-pane.ts failed (exit ${exitCode}): ${stderr}`);
  }

  const rawStdout = await new Response(devPaneProc.stdout as ReadableStream).text();
  let paneResult: { drone_pane: string; worktree: string; branch: string };
  try {
    paneResult = JSON.parse(rawStdout.trim());
  } catch {
    throw new Error(`dev-pane.ts returned invalid JSON: ${rawStdout}`);
  }

  if (!paneResult.drone_pane) {
    throw new Error(`dev-pane.ts did not return drone_pane: ${rawStdout}`);
  }

  // Write brief to temp file
  const briefPath = `/tmp/mind-brief-${mindName}.md`;
  writeFileSync(briefPath, brief, "utf-8");

  // Send brief to drone pane
  const message = `Read ${briefPath} and execute the tasks described.`;
  const sendProc = Bun.spawn(
    ["bun", `${home}/.claude/bin/tmux-send.ts`, paneResult.drone_pane, message],
    { stdout: "pipe", stderr: "pipe" }
  );
  const sendExit = await sendProc.exited;
  if (sendExit !== 0) {
    const stderr = await new Response(sendProc.stderr as ReadableStream).text();
    throw new Error(`tmux-send.ts failed (exit ${sendExit}): ${stderr}`);
  }

  return {
    paneId: paneResult.drone_pane,
    worktree: paneResult.worktree,
    branch: paneResult.branch,
  };
}

/**
 * Poll a drone pane for the MIND_COMPLETE signal.
 *
 * Polls `tmux capture-pane` every pollIntervalMs until the signal
 * `MIND_COMPLETE @{mindName}` appears or timeoutMs elapses.
 *
 * Returns { success: true, output } on signal found,
 * or { success: false } on timeout.
 */
export async function waitForCompletion(
  paneId: string,
  mindName: string,
  options: WaitOptions = {}
): Promise<CompletionResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 600_000;
  const signal = `MIND_COMPLETE @${mindName}`;
  const deadline = Date.now() + timeoutMs;

  do {
    const captureProc = Bun.spawn(["tmux", "capture-pane", "-t", paneId, "-p"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await captureProc.exited;
    const output = await new Response(captureProc.stdout as ReadableStream).text();

    if (output.includes(signal)) {
      return { success: true, output };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await Bun.sleep(Math.min(pollIntervalMs, remaining));
  } while (Date.now() < deadline);

  return { success: false };
}

/**
 * Dispatch multiple Minds in parallel, wait for all to complete.
 *
 * @param mindNames - Array of Mind names to dispatch
 * @param briefs    - Map of mindName → brief text
 * @param options   - Per-phase options for dispatch and wait
 * @returns         Map of mindName → CompletionResult
 */
export async function dispatchWave(
  mindNames: string[],
  briefs: Record<string, string>,
  options: { dispatch?: DispatchOptions; wait?: WaitOptions } = {}
): Promise<Record<string, CompletionResult>> {
  // Dispatch all in parallel
  const dispatched = await Promise.all(
    mindNames.map(async (name) => {
      const brief = briefs[name];
      if (brief === undefined) throw new Error(`No brief provided for mind: "${name}"`);
      const result = await dispatchToMind(name, brief, options.dispatch);
      return { name, result };
    })
  );

  // Wait for all completions in parallel
  const completions = await Promise.all(
    dispatched.map(async ({ name, result }) => {
      const completion = await waitForCompletion(result.paneId, name, options.wait);
      return { name, completion };
    })
  );

  return Object.fromEntries(completions.map(({ name, completion }) => [name, completion]));
}
