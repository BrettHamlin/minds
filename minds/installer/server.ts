/**
 * Installer Mind — file mapping, distribution logic, install hooks, upgrade paths.
 *
 * Owns: installTemplates (core.ts), collab.install.ts runtime installer.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "run installer":
    case "install collab scripts":
    case "set up collab":
    case "install pipeline": {
      const { installTemplates, getTemplateDir } = await import("./core.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      if (!repoRoot) {
        return { status: "handled", error: "Missing context.repoRoot" };
      }
      const templateDir = getTemplateDir();
      const result = installTemplates(templateDir, repoRoot, {
        force: Boolean(ctx.force),
        quiet: Boolean(ctx.quiet),
      });
      return { status: "handled", result };
    }

    case "get file mappings": {
      const { getTemplateDir } = await import("./core.js");
      const templateDir = getTemplateDir();
      return { status: "handled", result: { templateDir } };
    }

    case "check for updates":
      return { status: "handled", result: { checked: true } };

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "installer",
  domain: "File mapping, distribution logic, install hooks, and upgrade paths for collab installation.",
  keywords: ["install", "installer", "template", "file", "mapping", "upgrade", "distribution", "copy"],
  owns_files: ["minds/installer/"],
  capabilities: [
    "install pipeline",
    "get file mappings",
    "check for updates",
    "run installer",
    "install collab scripts",
    "set up collab",
  ],
  exposes: ["install pipeline", "get file mappings", "check for updates"],
  consumes: ["cli/ensureDir"],
  handle,
});
