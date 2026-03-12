/**
 * implement-scaffold.test.ts — Unit tests for T020: scaffoldFromTasks integration in implement.ts.
 *
 * Since runImplement is a heavy orchestrator (bus, tmux, worktrees), we test
 * the scaffolding logic as a unit: given task groups and a registry, verify
 * that scaffoldFromTasks is called correctly and the registry is reloaded.
 *
 * The actual wiring is a thin call in implement.ts between Step 3 and Step 4.
 * These tests validate the contract that the wiring depends on.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { scaffoldFromTasks } from "../../../instantiate/lib/scaffold.js";
import { tempDir } from "./helpers/multi-repo-setup.ts";
import type { MindDescription } from "../../../mind.js";
import type { MindTaskGroup } from "../../lib/implement-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGroup(mind: string, ownsFiles?: string[], deps: string[] = []): MindTaskGroup {
  return {
    mind,
    tasks: [{ id: "T001", mind, description: "Do thing", parallel: false }],
    dependencies: deps,
    ownsFiles,
  };
}

// ---------------------------------------------------------------------------
// T020: scaffoldFromTasks integration contract
// ---------------------------------------------------------------------------

describe("T020: scaffoldFromTasks before wave execution", () => {
  let srcDir: string;
  let jsonDir: string;
  let jsonPath: string;

  beforeEach(() => {
    srcDir = tempDir();
    jsonDir = tempDir();
    jsonPath = join(jsonDir, "minds.json");
    // Seed an empty minds.json
    writeFileSync(jsonPath, "[]", "utf8");
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(jsonDir, { recursive: true, force: true });
  });

  it("scaffolds unregistered mind with owns: before waves would execute", async () => {
    // Simulate Step 1: load registry
    let registry: MindDescription[] = JSON.parse(readFileSync(jsonPath, "utf8"));
    const registeredMinds = new Set(registry.map((m) => m.name));

    // Simulate Step 3: parse tasks
    const taskGroups = [
      makeGroup("new-api", ["src/api/**"]),
    ];

    // Step 3b: scaffold unregistered minds (the code we're testing)
    const scaffoldResults = await scaffoldFromTasks(taskGroups, registry, {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // Verify scaffolding occurred
    expect(scaffoldResults.length).toBe(1);
    expect(scaffoldResults[0].registered).toBe(true);
    expect(existsSync(join(srcDir, "new-api"))).toBe(true);

    // Step 3b cont: reload registry
    registry = JSON.parse(readFileSync(jsonPath, "utf8"));
    const newRegisteredMinds = new Set(registry.map((m) => m.name));

    // AC: Registry is reloaded — the mind shows as registered
    expect(newRegisteredMinds.has("new-api")).toBe(true);

    // AC: The new entry has correct owns_files
    const apiEntry = registry.find((m) => m.name === "new-api");
    expect(apiEntry).toBeDefined();
    expect(apiEntry!.owns_files).toEqual(["src/api/**"]);
    expect(apiEntry!.source).toBe("task-scaffolded");
  });

  it("does not scaffold when all minds are already registered", async () => {
    // Pre-register the mind
    const existingRegistry: MindDescription[] = [{
      name: "existing-mind",
      domain: "existing",
      keywords: ["existing"],
      owns_files: ["src/existing/"],
      capabilities: [],
    }];
    writeFileSync(jsonPath, JSON.stringify(existingRegistry, null, 2), "utf8");

    const registry = existingRegistry;
    const taskGroups = [makeGroup("existing-mind", ["src/existing/**"])];

    const scaffoldResults = await scaffoldFromTasks(taskGroups, registry, {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // AC: No scaffolding occurs
    expect(scaffoldResults).toHaveLength(0);

    // Registry unchanged
    const reloaded: MindDescription[] = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].name).toBe("existing-mind");
  });

  it("scaffolds multiple unregistered minds and registry contains all after reload", async () => {
    const taskGroups = [
      makeGroup("new-api", ["src/api/**"]),
      makeGroup("new-models", ["src/models/**"]),
    ];

    const registry: MindDescription[] = [];
    const scaffoldResults = await scaffoldFromTasks(taskGroups, registry, {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    expect(scaffoldResults).toHaveLength(2);

    // Reload registry — both minds should be present
    const reloaded: MindDescription[] = JSON.parse(readFileSync(jsonPath, "utf8"));
    const names = reloaded.map((m) => m.name);
    expect(names).toContain("new-api");
    expect(names).toContain("new-models");
  });

  it("only scaffolds unregistered minds in a mixed group", async () => {
    const existingRegistry: MindDescription[] = [{
      name: "core",
      domain: "core",
      keywords: ["core"],
      owns_files: ["src/core/"],
      capabilities: [],
    }];
    writeFileSync(jsonPath, JSON.stringify(existingRegistry, null, 2), "utf8");

    const taskGroups = [
      makeGroup("core", ["src/core/**"]),      // registered — skip
      makeGroup("new-api", ["src/api/**"]),     // unregistered — scaffold
      makeGroup("no-owns"),                      // no owns — skip
    ];

    const scaffoldResults = await scaffoldFromTasks(taskGroups, existingRegistry, {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // Only new-api should be scaffolded
    expect(scaffoldResults).toHaveLength(1);
    expect(scaffoldResults[0].mindDir).toBe(join(srcDir, "new-api"));

    // Reload: core + new-api
    const reloaded: MindDescription[] = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(reloaded).toHaveLength(2);
    expect(reloaded.map((m) => m.name).sort()).toEqual(["core", "new-api"]);
  });
});
