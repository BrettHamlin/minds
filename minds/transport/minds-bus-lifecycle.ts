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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MindsBusLifecycleInfo {
  busUrl: string;
  busServerPid: number;
  bridgePid: number;
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
}): Promise<void> {
  const transport = new BusTransport("", {
    busServerPid: pids.busServerPid,
    bridgePid: pids.bridgePid,
  });
  await transport.teardown();
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
