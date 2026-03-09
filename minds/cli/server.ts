/**
 * CLI Mind — minds binary, arg parsing, Minds installation.
 *
 * Owns: CLI entry points (minds/cli/index.ts, minds/cli/bin/minds.ts),
 * commands (minds-init).
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "init minds": {
      const { runMindsInit } = await import("./commands/minds-init.js");
      const force = Boolean(ctx.force);
      const quiet = Boolean(ctx.quiet);
      await runMindsInit({ force, quiet });
      return { status: "handled", result: { ok: true } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "cli",
  domain: "Minds CLI binary, arg parsing, and installation commands.",
  keywords: ["cli", "minds", "install", "init"],
  owns_files: ["minds/cli/"],
  capabilities: [
    "init minds",
  ],
  exposes: ["init minds"],
  consumes: [],
  handle,
});
