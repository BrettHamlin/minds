// minds-teardown.ts — Teardown CLI for Minds bus processes (BRE-446)
//
// Reads .collab/state/minds-bus-{ticketId}.json, SIGTERMs all PIDs,
// then clears the state file.
//
// Usage:
//   bun minds/transport/minds-teardown.ts --ticket BRE-446
//   bun minds/transport/minds-teardown.ts --cleanup-orphans

import {
  readBusState,
  clearBusState,
  findOrphanedBusStates,
  teardownMindsBus,
} from "./minds-bus-lifecycle.ts";

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();

  if (hasFlag(args, "--cleanup-orphans")) {
    const orphans = await findOrphanedBusStates(repoRoot);

    if (orphans.length === 0) {
      console.log(JSON.stringify({ ok: true, torn_down: 0, message: "No orphaned bus states found" }));
      process.exit(0);
    }

    let tornDown = 0;
    const errors: string[] = [];

    for (const state of orphans) {
      try {
        await teardownMindsBus({
          busServerPid: state.busServerPid,
          bridgePid: state.bridgePid,
          repoRoot,
          ticketId: state.ticketId,
        });
        tornDown++;
        console.error(`Torn down orphaned bus for ticket ${state.ticketId}`);
      } catch (err) {
        errors.push(`${state.ticketId}: ${String(err)}`);
      }
    }

    if (errors.length > 0) {
      console.error(JSON.stringify({ error: "Some teardowns failed", details: errors }));
      process.exit(1);
    }

    console.log(JSON.stringify({ ok: true, torn_down: tornDown }));
    process.exit(0);
  }

  const ticket = getArg(args, "--ticket");

  if (!ticket) {
    console.error(
      JSON.stringify({
        error: "Usage: minds-teardown.ts --ticket <TICKET_ID>\n       minds-teardown.ts --cleanup-orphans",
      })
    );
    process.exit(1);
  }

  const state = await readBusState(repoRoot, ticket);

  if (!state) {
    console.error(JSON.stringify({ error: `No bus state found for ticket ${ticket}` }));
    process.exit(1);
  }

  try {
    await teardownMindsBus({
      busServerPid: state.busServerPid,
      bridgePid: state.bridgePid,
      repoRoot,
      ticketId: state.ticketId,
    });
    console.log(JSON.stringify({ ok: true, ticket, busServerPid: state.busServerPid, bridgePid: state.bridgePid }));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}
