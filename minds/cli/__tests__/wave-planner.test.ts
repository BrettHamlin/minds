import { describe, expect, it, spyOn } from "bun:test";
import { computeWaves, formatWavePlan } from "../lib/wave-planner.ts";
import { parseAndGroupTasks } from "../lib/task-parser.ts";
import { buildDependencyGraph } from "../lib/task-parser.ts";
import type { MindTaskGroup } from "../lib/implement-types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TASKS_THREE_WAVES = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add types

## @signals Tasks
- [ ] T002 @signals Add resolver

## @execution Tasks (depends on: @pipeline_core, @signals)
- [ ] T003 @execution Update dispatch

## @router Tasks (depends on: @execution)
- [ ] T004 @router Update routes
`;

const TASKS_ALL_INDEPENDENT = `
## @signals Tasks
- [ ] T001 @signals Add resolver

## @config Tasks
- [ ] T002 @config Add loader

## @transport Tasks
- [ ] T003 @transport Fix paths
`;

const TASKS_CHAIN = `
## @a Tasks
- [ ] T001 @a Step one

## @b Tasks (depends on: @a)
- [ ] T002 @b Step two

## @c Tasks (depends on: @b)
- [ ] T003 @c Step three
`;

// ─── computeWaves ─────────────────────────────────────────────────────────────

describe("computeWaves", () => {
  it("puts independent minds in wave 1", () => {
    const groups = parseAndGroupTasks(TASKS_ALL_INDEPENDENT);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(1);
    expect(waves[0].id).toBe("wave-1");
    expect(waves[0].minds).toEqual(["config", "signals", "transport"]); // sorted
  });

  it("computes two waves: independent -> dependent", () => {
    const groups = parseAndGroupTasks(`
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add types

## @signals Tasks
- [ ] T002 @signals Add resolver

## @execution Tasks (depends on: @pipeline_core, @signals)
- [ ] T003 @execution Update dispatch
`);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(2);
    expect(waves[0].minds).toEqual(["pipeline_core", "signals"]);
    expect(waves[1].minds).toEqual(["execution"]);
  });

  it("computes three waves for a longer chain", () => {
    const groups = parseAndGroupTasks(TASKS_THREE_WAVES);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(3);
    expect(waves[0].minds).toEqual(["pipeline_core", "signals"]);
    expect(waves[1].minds).toEqual(["execution"]);
    expect(waves[2].minds).toEqual(["router"]);
  });

  it("computes linear chain as separate waves", () => {
    const groups = parseAndGroupTasks(TASKS_CHAIN);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(3);
    expect(waves[0].minds).toEqual(["a"]);
    expect(waves[1].minds).toEqual(["b"]);
    expect(waves[2].minds).toEqual(["c"]);
  });

  it("wave IDs are sequential: wave-1, wave-2, ...", () => {
    const groups = parseAndGroupTasks(TASKS_THREE_WAVES);
    const waves = computeWaves(groups);

    expect(waves.map((w) => w.id)).toEqual(["wave-1", "wave-2", "wave-3"]);
  });

  it("throws on cycle", () => {
    const groups: MindTaskGroup[] = [
      { mind: "a", tasks: [{ id: "T001", mind: "a", description: "x", parallel: false }], dependencies: ["b"] },
      { mind: "b", tasks: [{ id: "T002", mind: "b", description: "y", parallel: false }], dependencies: ["a"] },
    ];

    expect(() => computeWaves(groups)).toThrow(/Cycle detected/);
  });

  it("handles single mind (one wave)", () => {
    const groups = parseAndGroupTasks(`
## @transport Tasks
- [ ] T001 @transport Fix paths
`);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(1);
    expect(waves[0].minds).toEqual(["transport"]);
  });
});

// ─── produces/consumes inference ──────────────────────────────────────────────

describe("buildDependencyGraph — contract inference", () => {
  it("infers dependency from consumes/produces even without explicit depends on", () => {
    // @server-core consumes an interface produced by @blueprint-api,
    // but has no (depends on: @blueprint-api) annotation.
    const groups: MindTaskGroup[] = [
      {
        mind: "blueprint-routes",
        tasks: [{ id: "T001", mind: "blueprint-routes", description: "Add routes", parallel: false }],
        dependencies: [],
      },
      {
        mind: "blueprint-api",
        tasks: [{
          id: "T002", mind: "blueprint-api", description: "Add API endpoints", parallel: false,
          produces: { interface: "BlueprintAPI", path: "src/api/blueprint.ts" },
        }],
        dependencies: [],
      },
      {
        mind: "server-core",
        tasks: [{
          id: "T003", mind: "server-core", description: "Add integration tests", parallel: false,
          consumes: { interface: "BlueprintAPI", path: "src/api/blueprint.ts" },
        }],
        dependencies: [], // No explicit depends on — this is the bug scenario
      },
    ];

    const deps = buildDependencyGraph(groups);

    // server-core should depend on blueprint-api via contract inference
    expect(deps["server-core"]).toContain("blueprint-api");
  });

  it("does not create self-dependency when producer and consumer are same mind", () => {
    const groups: MindTaskGroup[] = [
      {
        mind: "api",
        tasks: [
          { id: "T001", mind: "api", description: "Add endpoint", parallel: false,
            produces: { interface: "UserAPI", path: "src/api/user.ts" } },
          { id: "T002", mind: "api", description: "Add tests", parallel: false,
            consumes: { interface: "UserAPI", path: "src/api/user.ts" } },
        ],
        dependencies: [],
      },
    ];

    const deps = buildDependencyGraph(groups);
    expect(deps["api"]).toBeUndefined();
  });

  it("merges explicit and inferred dependencies without duplicates", () => {
    const groups: MindTaskGroup[] = [
      {
        mind: "core",
        tasks: [{ id: "T001", mind: "core", description: "Add types", parallel: false,
          produces: { interface: "CoreTypes", path: "src/types.ts" } }],
        dependencies: [],
      },
      {
        mind: "consumer",
        tasks: [{ id: "T002", mind: "consumer", description: "Use types", parallel: false,
          consumes: { interface: "CoreTypes", path: "src/types.ts" } }],
        dependencies: ["core"], // Explicit AND inferred
      },
    ];

    const deps = buildDependencyGraph(groups);
    // Should have exactly one entry, not a duplicate
    expect(deps["consumer"]).toEqual(["core"]);
  });

  it("inferred dependency correctly orders waves", () => {
    const groups: MindTaskGroup[] = [
      {
        mind: "blueprint-routes",
        tasks: [{ id: "T001", mind: "blueprint-routes", description: "Add routes", parallel: false }],
        dependencies: [],
      },
      {
        mind: "blueprint-api",
        tasks: [{
          id: "T002", mind: "blueprint-api", description: "Add API", parallel: false,
          produces: { interface: "BlueprintAPI", path: "src/api/blueprint.ts" },
        }],
        dependencies: ["blueprint-routes"],
      },
      {
        mind: "server-core",
        tasks: [{
          id: "T003", mind: "server-core", description: "Integration tests", parallel: false,
          consumes: { interface: "BlueprintAPI", path: "src/api/blueprint.ts" },
        }],
        dependencies: [], // Missing explicit dep — should be inferred
      },
    ];

    const waves = computeWaves(groups);

    // blueprint-routes in wave-1, blueprint-api in wave-2, server-core in wave-3
    // (server-core depends on blueprint-api via inference)
    expect(waves.length).toBeGreaterThanOrEqual(2);

    // Find which wave server-core is in
    const serverCoreWaveIdx = waves.findIndex((w) => w.minds.includes("server-core"));
    const blueprintApiWaveIdx = waves.findIndex((w) => w.minds.includes("blueprint-api"));

    // server-core must be in a LATER wave than blueprint-api
    expect(serverCoreWaveIdx).toBeGreaterThan(blueprintApiWaveIdx);
  });
});

describe("buildDependencyGraph — unresolved dependency warning", () => {
  it("warns when depends on references a mind not in task groups", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});

    const groups: MindTaskGroup[] = [
      {
        mind: "server-core",
        tasks: [{ id: "T001", mind: "server-core", description: "Test", parallel: false }],
        dependencies: ["nonexistent-mind"],
      },
    ];

    buildDependencyGraph(groups);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("@nonexistent-mind is not in the task groups"),
    );

    spy.mockRestore();
  });
});

// ─── formatWavePlan ───────────────────────────────────────────────────────────

describe("formatWavePlan", () => {
  it("renders a human-readable plan", () => {
    const groups = parseAndGroupTasks(TASKS_ALL_INDEPENDENT);
    const waves = computeWaves(groups);
    const plan = formatWavePlan(waves, groups);

    expect(plan).toContain("wave-1");
    expect(plan).toContain("@signals");
    expect(plan).toContain("@config");
    expect(plan).toContain("@transport");
    expect(plan).toContain("1 task(s)");
  });

  it("shows task IDs and truncated descriptions", () => {
    const groups = parseAndGroupTasks(TASKS_THREE_WAVES);
    const waves = computeWaves(groups);
    const plan = formatWavePlan(waves, groups);

    expect(plan).toContain("T001");
    expect(plan).toContain("T002");
    expect(plan).toContain("T003");
    expect(plan).toContain("T004");
  });
});
