/**
 * Templates Mind — pure-data leaf Mind.
 *
 * Owns all distributable config, scripts, schemas, gate prompts, and pipeline
 * templates. No logic lives here — only data access.
 *
 * Leaf Mind: no children, no discoverChildren().
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const TEMPLATES_DIR = import.meta.dir;

function listTemplates(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(relative(TEMPLATES_DIR, full));
      }
    }
  }
  walk(TEMPLATES_DIR);
  return files.filter((f) => !f.startsWith("server.") && !f.includes("__tests__"));
}

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const req = workUnit.request.toLowerCase().trim();
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  // "list templates" — returns full file inventory
  if (req.startsWith("list templates")) {
    const files = listTemplates();
    return { status: "handled", result: { files } };
  }

  // "read template {path}" — returns file content
  if (req.startsWith("read template")) {
    const filePath = (ctx.path as string | undefined) ?? req.replace(/^read template\s*/i, "").trim();
    if (!filePath) {
      return { status: "handled", error: "Missing path. Provide context.path or append path to request." };
    }
    const abs = join(TEMPLATES_DIR, filePath);
    if (!existsSync(abs)) {
      return { status: "handled", error: `Template not found: ${filePath}` };
    }
    const content = readFileSync(abs, "utf-8");
    return { status: "handled", result: { path: filePath, content } };
  }

  // "get schema {name}" — returns JSON schema content
  if (req.startsWith("get schema")) {
    const name = (ctx.name as string | undefined) ?? req.replace(/^get schema\s*/i, "").trim();
    if (!name) {
      return { status: "handled", error: "Missing schema name. Provide context.name or append name to request." };
    }
    const candidates = [
      join(TEMPLATES_DIR, name),
      join(TEMPLATES_DIR, `${name}.schema.json`),
      join(TEMPLATES_DIR, `pipeline.${name}.schema.json`),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      return { status: "handled", error: `Schema not found: ${name}` };
    }
    const content = readFileSync(found, "utf-8");
    return { status: "handled", result: { name, schema: JSON.parse(content) } };
  }

  return { status: "escalate" };
}

export default createMind({
  name: "templates",
  domain: "Distributable config, scripts, schemas, gate prompts, and pipeline templates. Pure data — no logic.",
  keywords: ["template", "config", "schema", "script", "gate", "prompt", "pipeline", "defaults", "variants"],
  owns_files: ["minds/templates/"],
  capabilities: [
    "list templates",
    "read template content by path",
    "get JSON schema by name",
  ],
  handle,
});
