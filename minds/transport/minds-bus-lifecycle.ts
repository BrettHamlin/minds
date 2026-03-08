// minds-bus-lifecycle.ts — Minds bus server lifecycle helpers (BRE-444)
//
// Provides start/teardown helpers for the Minds message bus.
// Channel convention: `minds-{ticketId}` (separate from collab's `pipeline-{ticketId}`).
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
  return path.join(repoRoot, ".collab", "state", `minds-bus-${ticketId}.json`);
}

export async function writeBusState(repoRoot: string, state: MindsBusState): Promise<void> {
  const stateDir = path.join(repoRoot, ".collab", "state");
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
 * Scan .collab/state/minds-bus-*.json, check if PIDs are alive, return orphaned entries.
 * An entry is orphaned if any of its PIDs no longer respond to kill -0.
 */
export async function findOrphanedBusStates(repoRoot: string): Promise<MindsBusState[]> {
  const stateDir = path.join(repoRoot, ".collab", "state");
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
 * Resolves with { pid, url } once BUS_READY is printed to stdout.
 */
function spawnBusServer(
  serverPath: string,
  cwd: string,
): Promise<{ pid: number; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", [serverPath], {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      detached: true,
    });
    proc.unref();

    const timeout = setTimeout(() => {
      try { process.kill(proc.pid!, "SIGTERM"); } catch { /* ignore */ }
      reject(new Error("Minds bus server startup timeout (5s)"));
    }, 5000);

    proc.stdout!.on("data", (data: Buffer) => {
      const match = data.toString().match(/BUS_READY port=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        resolve({ pid: proc.pid!, url: `http://localhost:${port}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Minds bus server spawn error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
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
// startMindsBus
// ---------------------------------------------------------------------------

/**
 * Start the bus server and signal bridge for a Minds ticket.
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
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const serverPath = path.join(thisDir, "bus-server.ts");
  const bridgePath = path.join(thisDir, "bus-signal-bridge.ts");

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
      console.log(JSON.stringify(info));
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
