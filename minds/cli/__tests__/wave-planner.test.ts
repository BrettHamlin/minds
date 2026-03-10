import { describe, expect, it } from "bun:test";
import { computeWaves, formatWavePlan } from "../lib/wave-planner.ts";
import { parseAndGroupTasks } from "../lib/task-parser.ts";
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
