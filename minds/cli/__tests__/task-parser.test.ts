import { describe, expect, it } from "bun:test";
import { parseAndGroupTasks, buildDependencyGraph } from "../lib/task-parser.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TASKS_MULTI_MIND = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add LoadedPipeline type to minds/pipeline_core/types.ts — produces: LoadedPipeline at minds/pipeline_core/types.ts
- [ ] T002 @pipeline_core [P] Export resolveVariant() — produces: resolveVariant() at minds/pipeline_core/utils.ts

## @signals Tasks
- [ ] T003 @signals [P] Add signal resolver — produces: resolveSignal() at minds/signals/resolve-signal.ts

## @execution Tasks (depends on: @pipeline_core, @signals)
- [ ] T004 @execution Update phase-dispatch — consumes: LoadedPipeline from minds/pipeline_core/types.ts
- [ ] T005 @execution Use resolveSignal in handler — consumes: resolveSignal() from minds/signals/resolve-signal.ts
`;

const TASKS_INDEPENDENT = `
## @signals Tasks
- [ ] T001 @signals Add resolver at minds/signals/resolve.ts

## @config Tasks
- [ ] T002 @config Add config loader at minds/config/loader.ts
`;

const TASKS_SINGLE_MIND = `
## @transport Tasks
- [ ] T001 @transport Fix import paths
- [ ] T002 @transport [P] Add retry logic
- [ ] T003 @transport Update tests
`;

const TASKS_EMPTY = `
# Implementation Tasks

No tasks defined yet.
`;

// ─── parseAndGroupTasks ───────────────────────────────────────────────────────

describe("parseAndGroupTasks", () => {
  it("groups tasks by mind name", () => {
    const groups = parseAndGroupTasks(TASKS_MULTI_MIND);

    expect(groups).toHaveLength(3);
    expect(groups[0].mind).toBe("pipeline_core");
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[1].mind).toBe("signals");
    expect(groups[1].tasks).toHaveLength(1);
    expect(groups[2].mind).toBe("execution");
    expect(groups[2].tasks).toHaveLength(2);
  });

  it("extracts dependency info from section headers", () => {
    const groups = parseAndGroupTasks(TASKS_MULTI_MIND);

    // pipeline_core and signals have no deps
    expect(groups[0].dependencies).toEqual([]);
    expect(groups[1].dependencies).toEqual([]);

    // execution depends on pipeline_core and signals
    expect(groups[2].dependencies).toEqual(["pipeline_core", "signals"]);
  });

  it("preserves task IDs, descriptions, and parallel markers", () => {
    const groups = parseAndGroupTasks(TASKS_MULTI_MIND);
    const pcTasks = groups[0].tasks;

    expect(pcTasks[0].id).toBe("T001");
    expect(pcTasks[0].parallel).toBe(false);
    expect(pcTasks[0].description).toContain("LoadedPipeline");

    expect(pcTasks[1].id).toBe("T002");
    expect(pcTasks[1].parallel).toBe(true);
  });

  it("preserves produces/consumes annotations on grouped tasks", () => {
    const groups = parseAndGroupTasks(TASKS_MULTI_MIND);

    // T001 produces LoadedPipeline
    expect(groups[0].tasks[0].produces).toEqual({
      interface: "LoadedPipeline",
      path: "minds/pipeline_core/types.ts",
    });

    // T004 consumes LoadedPipeline
    expect(groups[2].tasks[0].consumes).toEqual({
      interface: "LoadedPipeline",
      path: "minds/pipeline_core/types.ts",
    });
  });

  it("handles independent minds (no dependencies)", () => {
    const groups = parseAndGroupTasks(TASKS_INDEPENDENT);

    expect(groups).toHaveLength(2);
    expect(groups[0].dependencies).toEqual([]);
    expect(groups[1].dependencies).toEqual([]);
  });

  it("handles a single mind with multiple tasks", () => {
    const groups = parseAndGroupTasks(TASKS_SINGLE_MIND);

    expect(groups).toHaveLength(1);
    expect(groups[0].mind).toBe("transport");
    expect(groups[0].tasks).toHaveLength(3);
  });

  it("returns empty array for content with no tasks", () => {
    const groups = parseAndGroupTasks(TASKS_EMPTY);
    expect(groups).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const groups = parseAndGroupTasks("");
    expect(groups).toEqual([]);
  });
});

// ─── buildDependencyGraph ─────────────────────────────────────────────────────

describe("buildDependencyGraph", () => {
  it("builds correct graph from groups with dependencies", () => {
    const groups = parseAndGroupTasks(TASKS_MULTI_MIND);
    const graph = buildDependencyGraph(groups);

    expect(graph).toEqual({
      execution: ["pipeline_core", "signals"],
    });
  });

  it("returns empty graph for independent minds", () => {
    const groups = parseAndGroupTasks(TASKS_INDEPENDENT);
    const graph = buildDependencyGraph(groups);

    expect(graph).toEqual({});
  });

  it("returns empty graph for single mind", () => {
    const groups = parseAndGroupTasks(TASKS_SINGLE_MIND);
    const graph = buildDependencyGraph(groups);

    expect(graph).toEqual({});
  });

  it("infers dependency from consumes/produces even without section header", () => {
    // @server-core consumes an interface produced by @blueprint-api
    // but has NO (depends on: ...) annotation — the wave planner must still
    // infer the dependency from the contract annotations.
    const tasks = `
## @blueprint-routes Tasks
- [ ] T001 @blueprint-routes Refactor route handlers

## @server-core Tasks
- [ ] T002 @server-core Update integration tests — consumes: ApiRouter from src/api/router.ts

## @blueprint-api Tasks
- [ ] T003 @blueprint-api Refactor API layer — produces: ApiRouter at src/api/router.ts
`;
    const groups = parseAndGroupTasks(tasks);
    const graph = buildDependencyGraph(groups);

    // server-core should depend on blueprint-api because it consumes ApiRouter
    expect(graph["server-core"]).toContain("blueprint-api");
  });

  it("merges explicit and inferred dependencies without duplicates", () => {
    const tasks = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add types — produces: LoadedPipeline at minds/pipeline_core/types.ts

## @execution Tasks (depends on: @pipeline_core)
- [ ] T002 @execution Use types — consumes: LoadedPipeline from minds/pipeline_core/types.ts
`;
    const groups = parseAndGroupTasks(tasks);
    const graph = buildDependencyGraph(groups);

    // pipeline_core should appear only once even though it's both explicit and inferred
    expect(graph["execution"]).toEqual(["pipeline_core"]);
  });

  it("does not add self-dependency from same-mind consumes/produces", () => {
    const tasks = `
## @engine Tasks
- [ ] T001 @engine Add parser — produces: Parser at src/parser.ts
- [ ] T002 @engine Use parser — consumes: Parser from src/parser.ts
`;
    const groups = parseAndGroupTasks(tasks);
    const graph = buildDependencyGraph(groups);

    expect(graph).toEqual({});
  });

  it("ignores consumes referencing a mind not in the current task groups", () => {
    const tasks = `
## @frontend Tasks
- [ ] T001 @frontend Update UI — consumes: ApiClient from src/api-client.ts
`;
    const groups = parseAndGroupTasks(tasks);
    const graph = buildDependencyGraph(groups);

    // No @backend mind in the groups, so no dependency should be inferred
    expect(graph).toEqual({});
  });
});
