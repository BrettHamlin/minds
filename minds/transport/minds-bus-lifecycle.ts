// minds-bus-lifecycle.ts — Minds bus server lifecycle helpers (BRE-444)
//
// Provides start/teardown helpers for the Minds message bus.
// Channel convention: `minds-{ticketId}` (separate from pipeline's `pipeline-{ticketId}`).
//
// Reuses BusTransport for teardown (pid-based SIGTERM). Spawns server and bridge
// directly so the bridge subscribes to `minds-{ticketId}` — BusTransport.start()
// hardcodes the `pipeline-` prefix and cannot produce a `minds-` channel without
// this layer.
//
// CLI usage:
//   bun minds/transport/minds-bus-lifecycle.ts start --ticket BRE-444 [--pane %123]
//   bun minds/transport/minds-bus-lifecycle.ts teardown --bus-pid 123 --bridge-pid 456

import { BusTransport } from "./BusTransport.ts";
import * as path from "path";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { mindsRoot } from "../shared/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MindsBusLifecycleInfo {
  busUrl: string;
  busServerPid: number;
  bridgePid: number;
}

export interface MindsBusState {
  busUrl: string;
  busServerPid: number;
  bridgePid: number;
  ticketId: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// State file helpers (T001)
// ---------------------------------------------------------------------------

function busStatePath(repoRoot: string, ticketId: string): string {
  return path.join(repoRoot, ".minds", "state", `minds-bus-${ticketId}.json`);
}

export async function writeBusState(repoRoot: string, state: MindsBusState): Promise<void> {
  const stateDir = path.join(repoRoot, ".minds", "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(busStatePath(repoRoot, state.ticketId), JSON.stringify(state, null, 2));
}

export async function readBusState(repoRoot: string, ticketId: string): Promise<MindsBusState | null> {
  try {
    const raw = await fs.readFile(busStatePath(repoRoot, ticketId), "utf-8");
    return JSON.parse(raw) as MindsBusState;
  } catch {
    return null;
  }
}

export async function clearBusState(repoRoot: string, ticketId: string): Promise<void> {
  try {
    await fs.unlink(busStatePath(repoRoot, ticketId));
  } catch {
    // File may not exist — ignore
  }
}

// ---------------------------------------------------------------------------
// Orphan detection (T002)
// ---------------------------------------------------------------------------

/**
 * Scan .minds/state/minds-bus-*.json, check if PIDs are alive, return orphaned entries.
 * An entry is orphaned if any of its PIDs no longer respond to kill -0.
 */
export async function findOrphanedBusStates(repoRoot: string): Promise<MindsBusState[]> {
  const stateDir = path.join(repoRoot, ".minds", "state");
  let entries: string[];
  try {
    entries = await fs.readdir(stateDir);
  } catch {
    return [];
  }

  const stateFiles = entries.filter((f) => /^minds-bus-.+\.json$/.test(f));
  const orphans: MindsBusState[] = [];

  for (const file of stateFiles) {
    let state: MindsBusState;
    try {
      const raw = await fs.readFile(path.join(stateDir, file), "utf-8");
      state = JSON.parse(raw) as MindsBusState;
    } catch {
      continue; // Skip malformed files
    }

    let isOrphaned = false;
    for (const pid of [state.busServerPid, state.bridgePid]) {
      try {
        process.kill(pid, 0);
      } catch {
        isOrphaned = true;
        break;
      }
    }

    if (isOrphaned) {
      orphans.push(state);
    }
  }

  return orphans;
}

// ---------------------------------------------------------------------------
// Env injection (T003)
// ---------------------------------------------------------------------------

/**
 * Inject BUS_URL env var into a Claude Code spawn command string.
 * Matches the pattern used by BusTransport.injectAgentEnv().
 */
export function injectBusEnv(spawnCmd: string, busUrl: string): string {
  return spawnCmd.replace(
    "claude --dangerously-skip-permissions",
    `BUS_URL=${busUrl} claude --dangerously-skip-permissions`
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Spawn bus-server.ts as a detached background process.
 * Resolves with { pid, url } once BUS_READY is detected via stdout or bus-port file.
 *
 * Uses two detection strategies in parallel:
 * 1. stdout pipe — catches BUS_READY immediately (works in direct terminal)
 * 2. bus-port file poll — fallback for environments where stdout buffering
 *    prevents the pipe from delivering (e.g. inside Claude Code's Bash tool)
 */
function spawnBusServer(
  serverPath: string,
  cwd: string,
): Promise<{ pid: number; url: string }> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const proc = spawn("bun", [serverPath], {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      detached: true,
    });
    proc.unref();

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { process.kill(proc.pid!, "SIGTERM"); } catch { /* ignore */ }
      reject(new Error("Minds bus server startup timeout (5s)"));
    }, 5000);

    // Strategy 1: stdout pipe
    proc.stdout!.on("data", (data: Buffer) => {
      if (resolved) return;
      const match = data.toString().match(/BUS_READY port=(\d+)/);
      if (match) {
        resolved = true;
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        resolve({ pid: proc.pid!, url: `http://localhost:${port}` });
      }
    });

    // Strategy 2: poll .minds/bus-port file (bus-server.ts writes this before BUS_READY)
    const portFile = path.join(cwd, ".minds", "bus-port");
    const pollInterval = setInterval(async () => {
      if (resolved) { clearInterval(pollInterval); return; }
      try {
        const content = await fs.readFile(portFile, "utf-8");
        const port = parseInt(content.trim(), 10);
        if (!isNaN(port) && port > 0) {
          // Verify the server is actually responding
          try {
            const resp = await fetch(`http://localhost:${port}/status`);
            if (resp.ok) {
              resolved = true;
              clearTimeout(timeout);
              clearInterval(pollInterval);
              resolve({ pid: proc.pid!, url: `http://localhost:${port}` });
            }
          } catch { /* server not ready yet */ }
        }
      } catch { /* file not created yet */ }
    }, 200);

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(pollInterval);
      reject(new Error(`Minds bus server spawn error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(pollInterval);
      reject(new Error(`Minds bus server exited unexpectedly (code ${code})`));
    });
  });
}

/**
 * Spawn bus-signal-bridge.ts as a detached background process.
 * Returns the PID.
 */
function spawnBridge(
  bridgePath: string,
  busUrl: string,
  channel: string,
  orchestratorPane: string,
  cwd: string,
): number {
  const proc = spawn("bun", [bridgePath, busUrl, channel, orchestratorPane], {
    cwd,
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  return proc.pid!;
}

// ---------------------------------------------------------------------------
// ensureAggregator
// ---------------------------------------------------------------------------

/**
 * Ensure the status-aggregator is running. If not, spawn it as a detached
 * background process. The aggregator has its own singleton check — if already
 * running it exits immediately with AGGREGATOR_EXISTING.
 *
 * Returns the port the aggregator is listening on.
 */
export async function ensureAggregator(repoRoot: string): Promise<number> {
  const portFile = path.join(repoRoot, ".minds", "aggregator-port");

  // Check if already running
  try {
    const raw = await fs.readFile(portFile, "utf-8");
    const port = parseInt(raw.trim(), 10);
    if (!isNaN(port) && port > 0) {
      const resp = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return port;
    }
  } catch {
    // Not running or stale port file
  }

  // Spawn aggregator
  const aggregatorPath = path.join(path.dirname(new URL(import.meta.url).pathname), "status-aggregator.ts");
  const proc = spawn("bun", [aggregatorPath, "--port", "0"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "ignore"],
    detached: true,
  });
  proc.unref();

  // Wait for AGGREGATOR_READY
  return new Promise<number>((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      reject(new Error("Aggregator startup timeout (5s)"));
    }, 5000);

    proc.stdout!.on("data", (data: Buffer) => {
      if (resolved) return;
      const match = data.toString().match(/AGGREGATOR_(?:READY|EXISTING) port=(\d+)/);
      if (match) {
        resolved = true;
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        console.log(`Dashboard running on http://localhost:${port}/minds`);
        resolve(port);
      }
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error(`Aggregator spawn error: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// startMindsBus
// ---------------------------------------------------------------------------

/**
 * Start the bus server and signal bridge for a Minds ticket.
 * Also ensures the status-aggregator is running so it can pick up events.
 *
 * Uses channel `minds-{ticketId}` so that Minds traffic stays separate from
 * the collab pipeline channel (`pipeline-{ticketId}`).
 *
 * @param repoRoot         - Absolute path to the repo root
 * @param orchestratorPane - tmux pane ID of the orchestrator (for signal delivery)
 * @param ticketId         - Ticket ID (e.g. "BRE-444")
 * @returns { busUrl, busServerPid, bridgePid }
 */
export async function startMindsBus(
  repoRoot: string,
  orchestratorPane: string,
  ticketId: string,
): Promise<MindsBusLifecycleInfo> {
  // Ensure aggregator is running before starting the bus — otherwise events
  // emitted before the aggregator connects would be missed.
  await ensureAggregator(repoRoot);

  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const serverPath = path.join(thisDir, "bus-server.ts");
  const bridgePath = path.join(thisDir, "bus-signal-bridge.ts");

  // Remove stale bus-port file so the polling fallback doesn't pick up a dead port
  const portFile = path.join(repoRoot, ".minds", "bus-port");
  try { await fs.unlink(portFile); } catch { /* may not exist */ }

  const { pid: busServerPid, url: busUrl } = await spawnBusServer(serverPath, repoRoot);

  const channel = `minds-${ticketId}`;
  const bridgePid = spawnBridge(bridgePath, busUrl, channel, orchestratorPane, repoRoot);

  await writeBusState(repoRoot, {
    busUrl,
    busServerPid,
    bridgePid,
    ticketId,
    startedAt: new Date().toISOString(),
  });

  return { busUrl, busServerPid, bridgePid };
}

// ---------------------------------------------------------------------------
// teardownMindsBus
// ---------------------------------------------------------------------------

/**
 * Kill the bus server and signal bridge processes started by startMindsBus.
 * Reuses BusTransport's teardown logic (SIGTERM with logging per pid).
 *
 * @param pids - PIDs returned by startMindsBus
 */
export async function teardownMindsBus(pids: {
  busServerPid: number;
  bridgePid: number;
  repoRoot?: string;
  ticketId?: string;
}): Promise<void> {
  const transport = new BusTransport("", {
    busServerPid: pids.busServerPid,
    bridgePid: pids.bridgePid,
  });
  await transport.teardown();

  if (pids.repoRoot && pids.ticketId) {
    await clearBusState(pids.repoRoot, pids.ticketId);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  }

  if (command === "start") {
    const ticket = getArg("--ticket");
    const pane = getArg("--pane") ?? process.env.TMUX_PANE ?? "";

    if (!ticket) {
      console.error(
        JSON.stringify({
          error: "Usage: minds-bus-lifecycle.ts start --ticket <id> [--pane <pane-id>]",
        })
      );
      process.exit(1);
    }

    try {
      const info = await startMindsBus(process.cwd(), pane, ticket);
      const output = JSON.stringify(info) + "\n";
      process.stdout.write(output, () => process.exit(0));
      // Fallback exit if write callback never fires
      setTimeout(() => process.exit(0), 500);
    } catch (err) {
      console.error(JSON.stringify({ error: String(err) }));
      process.exit(1);
    }
  } else if (command === "teardown") {
    const busPidStr = getArg("--bus-pid");
    const bridgePidStr = getArg("--bridge-pid");

    if (!busPidStr || !bridgePidStr) {
      console.error(
        JSON.stringify({
          error: "Usage: minds-bus-lifecycle.ts teardown --bus-pid <pid> --bridge-pid <pid>",
        })
      );
      process.exit(1);
    }

    const busServerPid = parseInt(busPidStr, 10);
    const bridgePid = parseInt(bridgePidStr, 10);

    if (isNaN(busServerPid) || isNaN(bridgePid)) {
      console.error(JSON.stringify({ error: "PIDs must be integers" }));
      process.exit(1);
    }

    try {
      await teardownMindsBus({ busServerPid, bridgePid });
      console.log(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error(JSON.stringify({ error: String(err) }));
      process.exit(1);
    }
  } else {
    console.error(
      JSON.stringify({ error: "Usage: minds-bus-lifecycle.ts [start|teardown] ..." })
    );
    process.exit(1);
  }
}
