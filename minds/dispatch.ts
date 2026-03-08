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
import { mindsPublish } from "./transport/minds-publish.ts";
import { startMindsBus, teardownMindsBus } from "./transport/minds-bus-lifecycle.ts";
import type { MindsBusLifecycleInfo } from "./transport/minds-bus-lifecycle.ts";
import { BusTransport } from "./transport/BusTransport.ts";
import type { Message } from "./transport/Transport.ts";

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
  /** Bus server URL (e.g. "http://localhost:7777"). When provided, brief delivery uses bus publish. */
  busUrl?: string;
  /** Ticket ID used to form the bus channel `minds-{ticketId}`. Required when busUrl is set. */
  ticketId?: string;
}

export interface WaitOptions {
  /** Poll interval in ms (default: 30000) — used for legacy tmux polling only */
  pollIntervalMs?: number;
  /** Total timeout in ms (default: 600000 = 10 min) */
  timeoutMs?: number;
  /** Bus server URL — when provided, subscribe to bus events instead of polling tmux */
  busUrl?: string;
  /** Bus channel to subscribe to (e.g. "minds-BRE-444") — required when busUrl is set */
  channel?: string;
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
 * 4a. When busUrl + ticketId provided: publishes DRONE_SPAWNED event over bus
 * 4b. Otherwise: sends brief message to drone pane via tmux-send.ts (legacy)
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

  if (options.busUrl && options.ticketId) {
    // Publish DRONE_SPAWNED event over bus
    const channel = `minds-${options.ticketId}`;
    await mindsPublish(options.busUrl, channel, "DRONE_SPAWNED", {
      mindName,
      brief,
    });
  } else {
    // Legacy: send brief to drone pane via tmux-send.ts
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
  }

  return {
    paneId: paneResult.drone_pane,
    worktree: paneResult.worktree,
    branch: paneResult.branch,
  };
}

/**
 * Wait for a drone to emit DRONE_COMPLETE on the bus (preferred)
 * or by polling tmux capture-pane (legacy fallback).
 *
 * When busUrl + channel are provided in options, subscribes to the bus and
 * waits for a DRONE_COMPLETE event with payload.mindName === mindName.
 *
 * Otherwise falls back to polling tmux capture-pane for the legacy
 * `MIND_COMPLETE @{mindName}` signal.
 */
export async function waitForCompletion(
  paneId: string,
  mindName: string,
  options: WaitOptions = {}
): Promise<CompletionResult> {
  if (options.busUrl && options.channel) {
    return waitForCompletionBus(mindName, options.busUrl, options.channel, options);
  }
  return waitForCompletionTmux(paneId, mindName, options);
}

/** Bus-based completion wait: subscribe to SSE channel, resolve on DRONE_COMPLETE. */
async function waitForCompletionBus(
  mindName: string,
  busUrl: string,
  channel: string,
  options: WaitOptions
): Promise<CompletionResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;

  // Immediate timeout — no events possible
  if (timeoutMs <= 0) {
    return { success: false };
  }

  const bus = new BusTransport(busUrl);

  return new Promise<CompletionResult>(async (resolve) => {
    let resolved = false;
    const done = (result: CompletionResult) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => done({ success: false }), timeoutMs);

    const unsub = await bus.subscribe(channel, (msg: Message) => {
      if (msg.type === "DRONE_COMPLETE") {
        const payload = msg.payload as Record<string, unknown>;
        if (payload?.mindName === mindName) {
          clearTimeout(timer);
          unsub();
          done({ success: true, output: JSON.stringify(msg.payload) });
        }
      }
    });
  });
}

/** Legacy tmux-based completion wait: poll capture-pane for MIND_COMPLETE signal. */
async function waitForCompletionTmux(
  paneId: string,
  mindName: string,
  options: WaitOptions
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
 * Starts the Minds bus lifecycle before dispatching. If options.dispatch.busUrl
 * is already provided (e.g. in tests), skips lifecycle startup and uses that URL.
 *
 * @param mindNames - Array of Mind names to dispatch
 * @param briefs    - Map of mindName → brief text
 * @param options   - Per-phase options for dispatch and wait, plus optional ticketId
 * @returns         Map of mindName → CompletionResult
 */
export async function dispatchWave(
  mindNames: string[],
  briefs: Record<string, string>,
  options: { dispatch?: DispatchOptions; wait?: WaitOptions; ticketId?: string } = {}
): Promise<Record<string, CompletionResult>> {
  const repoRoot = options.dispatch?.repoRoot ?? detectRepoRoot();
  const ticketId = options.ticketId ?? options.dispatch?.ticketId ?? "unknown";

  // Start bus lifecycle unless a busUrl is already injected (e.g. in tests)
  let lifecycle: MindsBusLifecycleInfo | undefined;
  let busUrl = options.dispatch?.busUrl;

  if (!busUrl) {
    const orchestratorPane = process.env.TMUX_PANE ?? "";
    lifecycle = await startMindsBus(repoRoot, orchestratorPane, ticketId);
    busUrl = lifecycle.busUrl;
  }

  const channel = `minds-${ticketId}`;

  try {
    // Dispatch all in parallel
    const dispatched = await Promise.all(
      mindNames.map(async (name) => {
        const brief = briefs[name];
        if (brief === undefined) throw new Error(`No brief provided for mind: "${name}"`);
        const result = await dispatchToMind(name, brief, {
          ...options.dispatch,
          repoRoot,
          busUrl,
          ticketId,
        });
        return { name, result };
      })
    );

    // Wait for all completions in parallel
    const completions = await Promise.all(
      dispatched.map(async ({ name, result }) => {
        const completion = await waitForCompletion(result.paneId, name, {
          ...options.wait,
          busUrl,
          channel,
        });
        return { name, completion };
      })
    );

    return Object.fromEntries(completions.map(({ name, completion }) => [name, completion]));
  } finally {
    if (lifecycle) {
      await teardownMindsBus(lifecycle);
    }
  }
}
