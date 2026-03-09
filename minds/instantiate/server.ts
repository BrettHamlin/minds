/**
 * Instantiate Mind — scaffold new Minds in dev and installed repos.
 *
 * Single intent: create-mind
 * Takes name + domain, scaffolds MIND.md + server.ts + lib/, registers in minds.json.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "@minds/server-base.js";
import type { WorkUnit, WorkResult } from "@minds/mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "create mind": {
      const { scaffoldMind } = await import("./lib/scaffold.js");

      const name = ctx.name as string | undefined;
      const domain = ctx.domain as string | undefined;

      if (!name) {
        return { status: "handled", error: "create mind: missing context.name" };
      }
      if (!domain) {
        return { status: "handled", error: "create mind: missing context.domain" };
      }

      try {
        const result = await scaffoldMind(name, domain);
        return {
          status: "handled",
          result: {
            mindDir: result.mindDir,
            files: result.files,
            registered: result.registered,
            mindsJson: result.mindsJson,
          },
        };
      } catch (err) {
        return {
          status: "handled",
          error: `create mind: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "instantiate",
  domain: "Mind lifecycle — scaffolding new Minds in any repo. Creates MIND.md, server.ts, and lib/ directory, and registers the new Mind in minds.json.",
  keywords: ["instantiate", "scaffold", "create", "mind", "new", "generate", "init"],
  owns_files: ["minds/instantiate/"],
  capabilities: ["create mind"],
  exposes: ["create mind"],
  consumes: [],
  handle,
});
