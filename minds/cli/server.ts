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
  const req = workUnit.request.toLowerCase().trim();
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  // "install package" — install a pipeline or pack by name
  if (req.startsWith("install package") || req.startsWith("install pipeline")) {
    const { install } = await import("./commands/pipelines/install.js");
    const name = ctx.name as string | undefined;
    if (!name) {
      return { status: "handled", error: "Missing context.name" };
    }
    await install([name], {});
    return { status: "handled", result: { ok: true } };
  }

  // "list packages" — list installed pipelines
  if (req.startsWith("list packages") || req.startsWith("list pipelines")) {
    const { list } = await import("./commands/pipelines/list.js");
    await list([], {});
    return { status: "handled", result: { ok: true } };
  }

  // "resolve repo path" — resolve a repo-id to its local path
  if (req.startsWith("resolve repo path") || req.startsWith("resolve repo")) {
    const { repo } = await import("./commands/repo/index.js");
    const repoId = ctx.repoId as string | undefined;
    if (!repoId) {
      return { status: "handled", error: "Missing context.repoId" };
    }
    await repo(["resolve", repoId], {});
    return { status: "handled", result: { ok: true } };
  }

  return { status: "escalate" };
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
  handle,
});
