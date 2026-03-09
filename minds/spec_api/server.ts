/**
 * SpecAPI Mind — HTTP REST API gateway for spec creation workflows.
 *
 * Parent Mind: discovers SpecEngine as a child via discoverChildren().
 * Delegates all business logic to SpecEngine via handle().
 * Also runs the Express HTTP server (see index.ts).
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";
import { discoverChildren } from "../discovery.js";
import type { ChildProcess } from "../discovery.js";
import { setEngine } from "./engine.js";

let _specEngine: ChildProcess | null = null;

async function ensureEngine(): Promise<ChildProcess> {
  if (!_specEngine) {
    const discovery = await discoverChildren(import.meta.dir);
    _specEngine = discovery.children.find(c => c.description.name === "spec_engine") ?? null;
    if (_specEngine) setEngine(_specEngine);
  }
  if (!_specEngine) throw new Error("SpecEngine child not found");
  return _specEngine;
}

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  try {
    const engine = await ensureEngine();
    const result = await engine.handle(workUnit.request, workUnit.context);
    return result as WorkResult;
  } catch (error) {
    return {
      status: "handled",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default createMind({
  name: "spec_api",
  domain: "HTTP REST API gateway for spec creation workflows. Delegates business logic to SpecEngine child.",
  keywords: ["http", "api", "rest", "endpoint", "request", "response", "spec", "specfactory"],
  owns_files: ["minds/spec_api/"],
  capabilities: [
    "serve HTTP REST endpoints",
    "route requests to SpecEngine",
    "validate HTTP inputs",
    "format HTTP responses",
  ],
  exposes: ["serve HTTP REST endpoints", "route requests to SpecEngine"],
  consumes: ["spec_engine child Mind"],
  handle,
});
