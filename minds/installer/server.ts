/**
 * Installer Mind — Minds architecture installation and distribution.
 *
 * Owns: installCoreMinds (core.ts) for portable Minds installation.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "install minds":
    case "set up minds": {
      const { installCoreMinds, getMindsSourceDir } = await import("./core.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      if (!repoRoot) {
        return { status: "handled", error: "Missing context.repoRoot" };
      }
      const mindsSourceDir = getMindsSourceDir();
      const result = installCoreMinds(mindsSourceDir, repoRoot, {
        force: Boolean(ctx.force),
        quiet: Boolean(ctx.quiet),
      });
      return { status: "handled", result };
    }

    case "get minds source dir": {
      const { getMindsSourceDir } = await import("./core.js");
      const mindsSourceDir = getMindsSourceDir();
      return { status: "handled", result: { mindsSourceDir } };
    }

    case "check for updates":
      return { status: "handled", result: { checked: true } };

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "installer",
  domain: "Minds architecture installation, distribution logic, and upgrade paths.",
  keywords: ["install", "installer", "minds", "copy", "distribution", "upgrade"],
  owns_files: ["minds/installer/"],
  capabilities: [
    "install minds",
    "get minds source dir",
    "check for updates",
    "set up minds",
  ],
  exposes: ["install minds", "get minds source dir", "check for updates"],
  consumes: [],
  handle,
});
