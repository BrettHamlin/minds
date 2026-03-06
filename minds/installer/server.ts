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
  const req = workUnit.request.toLowerCase().trim();
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  // "install pipeline" — install templates into a repo root
  if (req.startsWith("install pipeline") || req.startsWith("install templates")) {
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

  // "get file mappings" — return the template directory path
  if (req.startsWith("get file mappings") || req.startsWith("get template dir")) {
    const { getTemplateDir } = await import("./core.js");
    const templateDir = getTemplateDir();
    return { status: "handled", result: { templateDir } };
  }

  // "check for updates" — check if installer needs updating (stub; upgrade logic in collab-install.ts)
  if (req.startsWith("check for updates")) {
    return { status: "handled", result: { checked: true } };
  }

  return { status: "escalate" };
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
  ],
  handle,
});
