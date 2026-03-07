/**
 * CLI Mind — collab binary, arg parsing, package registry, repo management.
 *
 * Owns: Both CLI entry points (src/cli/index.ts, cli/bin/collab.ts),
 * commands, lib (registry, resolver, integrity, lockfile, state, semver),
 * types, and CLI utilities (fs, git, version).
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "install package": {
      const { install } = await import("./commands/pipelines/install.js");
      const name = ctx.name as string | undefined;
      if (!name) {
        return { status: "handled", error: "Missing context.name" };
      }
      await install([name], {});
      return { status: "handled", result: { ok: true } };
    }

    case "list packages": {
      const { list } = await import("./commands/pipelines/list.js");
      await list([], {});
      return { status: "handled", result: { ok: true } };
    }

    case "resolve repo path": {
      const { repo } = await import("./commands/repo/index.js");
      const repoId = ctx.repoId as string | undefined;
      if (!repoId) {
        return { status: "handled", error: "Missing context.repoId" };
      }
      await repo(["resolve", repoId], {});
      return { status: "handled", result: { ok: true } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "cli",
  domain: "collab binary, arg parsing, package registry, repo management, and semver.",
  keywords: ["cli", "collab", "install", "package", "pipeline", "repo", "registry", "semver", "browse", "list"],
  owns_files: ["minds/cli/"],
  capabilities: [
    "install package",
    "list packages",
    "resolve repo path",
  ],
  exposes: ["install package", "list packages", "resolve repo path", "ensureDir utility"],
  consumes: [],
  handle,
});
