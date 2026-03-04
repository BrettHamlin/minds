#!/usr/bin/env bun
/**
 * teardown-bus.ts — Kill bus server + bridges for a completed pipeline
 *
 * Usage:
 *   bun teardown-bus.ts <TICKET_ID>
 *
 * Reads bus_server_pid, bridge_pid, command_bridge_pid from registry.
 * Sends SIGTERM to each. Removes .collab/bus-port if it exists.
 * Silent on errors (process may already be dead).
 * Always exits 0 — non-fatal cleanup step.
 */

import * as fs from "fs";
import * as path from "path";
import {
  getRepoRoot,
  readJsonFile,
  getRegistryPath,
} from "../../../lib/pipeline";
import { resolveTransportPath } from "../../../lib/resolve-transport";

// ---------------------------------------------------------------------------
// Core logic (exported for testing)
// ---------------------------------------------------------------------------

export interface TeardownOpts {
  busServerPid?: number;
  bridgePid?: number;
  commandBridgePid?: number;
  busPortFile?: string;
}

/**
 * Kill the bus server and signal/command bridge processes, then remove
 * the bus port file. Non-fatal: silently handles already-dead processes.
 *
 * Delegates process termination to BusTransport.teardown() which encapsulates
 * the lifecycle kill logic.
 */
export async function teardownBusPids(opts: TeardownOpts): Promise<void> {
  const { busServerPid, bridgePid, commandBridgePid, busPortFile } = opts;

  // Delegate process killing to BusTransport.teardown()
  const { BusTransport } = await import(resolveTransportPath("BusTransport.ts"));
  const transport = new BusTransport("", { busServerPid, bridgePid, commandBridgePid });
  await transport.teardown();

  if (busPortFile && fs.existsSync(busPortFile)) {
    try {
      fs.unlinkSync(busPortFile);
      console.error(`Removed bus port file: ${busPortFile}`);
    } catch (err) {
      console.error(`Failed to remove bus port file: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const [ticketId] = process.argv.slice(2);

  if (!ticketId) {
    console.error("Usage: teardown-bus.ts <TICKET_ID>");
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
  const regPath = getRegistryPath(registryDir, ticketId);
  const registry = readJsonFile(regPath);

  if (!registry) {
    console.error(`No registry found for ${ticketId} — nothing to teardown`);
    process.exit(0);
  }

  await teardownBusPids({
    busServerPid: registry.bus_server_pid as number | undefined,
    bridgePid: registry.bridge_pid as number | undefined,
    commandBridgePid: registry.command_bridge_pid as number | undefined,
    busPortFile: path.join(repoRoot, ".collab", "bus-port"),
  });

  process.exit(0);
}
