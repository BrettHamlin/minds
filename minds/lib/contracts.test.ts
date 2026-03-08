import { describe, expect, it } from "bun:test";
import {
  generateContracts,
  lintTasks,
  parseTasks,
  type LintResult,
  type ParsedTask,
} from "./contracts.ts";

// Minimal MindDescription shape for tests — avoids importing from mind.ts
// which pulls in MCP dependencies.
interface MinimalMind {
  name: string;
  owns_files: string[];
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TASKS_WITH_ANNOTATIONS = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add LoadedPipeline type to minds/pipeline_core/types.ts — produces: LoadedPipeline at minds/pipeline_core/types.ts
- [ ] T002 @pipeline_core [P] Export resolveVariant() — produces: resolveVariant() at minds/pipeline_core/utils.ts

## @signals Tasks
- [ ] T003 @signals [P] Add signal resolver — produces: resolveSignal() at minds/signals/resolve-signal.ts

## @execution Tasks (depends on: @pipeline_core, @signals)
- [ ] T004 @execution Update phase-dispatch — consumes: LoadedPipeline from minds/pipeline_core/types.ts
- [ ] T005 @execution Use resolveSignal in handler — consumes: resolveSignal() from minds/signals/resolve-signal.ts
`;

const TASKS_PLAIN = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add LoadedPipeline type to minds/pipeline_core/types.ts
- [x] T002 @pipeline_core [P] Update utils.ts with helpers
`;

const TASKS_INDEPENDENT = `
## @signals Tasks
- [ ] T001 @signals Add resolver at minds/signals/resolve.ts — produces: resolveSignal() at minds/signals/resolve.ts

## @config Tasks
- [ ] T002 @config Add config loader at minds/config/loader.ts — produces: loadConfig() at minds/config/loader.ts
`;

const REGISTRY: MinimalMind[] = [
  { name: "pipeline_core", owns_files: ["minds/pipeline_core/"] },
  { name: "signals", owns_files: ["minds/signals/"] },
  { name: "execution", owns_files: ["minds/execution/"] },
  { name: "config", owns_files: ["minds/config/"] },
];

// ─── parseTasks ───────────────────────────────────────────────────────────────

describe("parseTasks", () => {
  it("parses task IDs, @mind tags, [P] markers, and produces/consumes annotations", () => {
    const tasks = parseTasks(TASKS_WITH_ANNOTATIONS);

    expect(tasks).toHaveLength(5);

    const t001 = tasks.find((t) => t.id === "T001")!;
    expect(t001.id).toBe("T001");
    expect(t001.mind).toBe("pipeline_core");
    expect(t001.parallel).toBe(false);
    expect(t001.produces).toEqual({
      interface: "LoadedPipeline",
      path: "minds/pipeline_core/types.ts",
    });
    expect(t001.consumes).toBeUndefined();
    expect(t001.sectionHasDepsHeader).toBe(false);

    const t002 = tasks.find((t) => t.id === "T002")!;
    expect(t002.parallel).toBe(true);
    expect(t002.produces?.interface).toBe("resolveVariant()");

    const t004 = tasks.find((t) => t.id === "T004")!;
    expect(t004.mind).toBe("execution");
    expect(t004.consumes).toEqual({
      interface: "LoadedPipeline",
      path: "minds/pipeline_core/types.ts",
    });
    expect(t004.sectionHasDepsHeader).toBe(true);
    expect(t004.sectionDeclaredDeps).toEqual(["pipeline_core", "signals"]);
  });

  it("handles tasks with no produces/consumes (plain tasks)", () => {
    const tasks = parseTasks(TASKS_PLAIN);

    expect(tasks).toHaveLength(2);

    const t001 = tasks[0];
    expect(t001.id).toBe("T001");
    expect(t001.mind).toBe("pipeline_core");
    expect(t001.parallel).toBe(false);
    expect(t001.produces).toBeUndefined();
    expect(t001.consumes).toBeUndefined();

    const t002 = tasks[1];
    expect(t002.parallel).toBe(true);
    expect(t002.produces).toBeUndefined();
  });
});

// ─── generateContracts ────────────────────────────────────────────────────────

describe("generateContracts", () => {
  it("builds correct contract entries from parsed tasks", () => {
    const tasks = parseTasks(TASKS_WITH_ANNOTATIONS);
    const report = generateContracts(tasks);

    // Should have 2 contracts: LoadedPipeline and resolveSignal()
    expect(report.contracts).toHaveLength(2);

    const lp = report.contracts.find((c) => c.interface === "LoadedPipeline")!;
    expect(lp.producer).toBe("pipeline_core");
    expect(lp.path).toBe("minds/pipeline_core/types.ts");
    expect(lp.consumers).toContain("execution");

    const rs = report.contracts.find((c) => c.interface === "resolveSignal()")!;
    expect(rs.producer).toBe("signals");
    expect(rs.consumers).toContain("execution");
  });

  it("computes correct wave ordering via topological sort", () => {
    const tasks = parseTasks(TASKS_WITH_ANNOTATIONS);
    const report = generateContracts(tasks);

    // pipeline_core and signals have no deps → Wave 1
    // execution depends on both → Wave 2
    expect(report.waves).toHaveLength(2);
    expect(report.waves[0].sort()).toEqual(["pipeline_core", "signals"]);
    expect(report.waves[1]).toEqual(["execution"]);

    expect(report.dependencies["execution"]).toEqual(
      expect.arrayContaining(["pipeline_core", "signals"])
    );
  });

  it("handles independent Minds (all Wave 1)", () => {
    const tasks = parseTasks(TASKS_INDEPENDENT);
    const report = generateContracts(tasks);

    expect(report.waves).toHaveLength(1);
    expect(report.waves[0].sort()).toEqual(["config", "signals"]);
    expect(Object.keys(report.dependencies)).toHaveLength(0);
  });
});

// ─── lintTasks ────────────────────────────────────────────────────────────────

describe("lintTasks", () => {
  it("flags dangling_consume: consumes with no matching produces", () => {
    const content = `
## @execution Tasks (depends on: @signals)
- [ ] T001 @execution Use resolveSignal — consumes: resolveSignal() from minds/signals/resolve.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const err = result.errors.find((e) => e.type === "dangling_consume");
    expect(err).toBeDefined();
    expect(err!.task).toBe("T001");
    expect(err!.message).toContain("resolveSignal()");
  });

  it("flags boundary_violation: file paths outside Mind's owns_files", () => {
    const content = `
## @signals Tasks
- [ ] T001 @signals Modify minds/execution/handler.ts to add logging
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const err = result.errors.find((e) => e.type === "boundary_violation");
    expect(err).toBeDefined();
    expect(err!.task).toBe("T001");
    expect(err!.message).toContain("minds/execution/handler.ts");
  });

  it("flags cross_mind_leakage: @mind_name in task description body", () => {
    const content = `
## @execution Tasks
- [ ] T001 @execution Update handler — after @signals creates the resolver, call it
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const err = result.errors.find((e) => e.type === "cross_mind_leakage");
    expect(err).toBeDefined();
    expect(err!.task).toBe("T001");
    expect(err!.message).toContain("@signals");
  });

  it("does NOT flag @mind_name in the task's own @mind tag or in consumes: paths", () => {
    const content = `
## @signals Tasks
- [ ] T001 @signals Add resolver at minds/signals/resolve.ts — produces: resolveSignal() at minds/signals/resolve.ts

## @execution Tasks (depends on: @signals)
- [ ] T002 @execution Use signal resolver — consumes: resolveSignal() from minds/signals/resolve.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const leakageErrors = result.errors.filter(
      (e) => e.type === "cross_mind_leakage"
    );
    expect(leakageErrors).toHaveLength(0);
  });

  it("flags missing_dependency_header: section without depends-on when tasks consume", () => {
    const content = `
## @signals Tasks
- [ ] T001 @signals Add resolver — produces: resolveSignal() at minds/signals/resolve.ts

## @execution Tasks
- [ ] T002 @execution Use resolveSignal — consumes: resolveSignal() from minds/signals/resolve.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const err = result.errors.find(
      (e) => e.type === "missing_dependency_header"
    );
    expect(err).toBeDefined();
    expect(err!.task).toBe("T002");
  });

  it("warns about unused_produce: produces with no consumer", () => {
    const content = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add LoadedPipeline — produces: LoadedPipeline at minds/pipeline_core/types.ts
- [ ] T002 @pipeline_core Add unusedHelper — produces: unusedHelper() at minds/pipeline_core/utils.ts
`;
    const tasks = parseTasks(content);
    // T001 and T002 both produce but nothing consumes them → both are warnings
    const result = lintTasks(tasks, REGISTRY as any);

    const unusedWarnings = result.warnings.filter(
      (w) => w.type === "unused_produce"
    );
    expect(unusedWarnings.length).toBeGreaterThanOrEqual(1);
    const t002Warn = unusedWarnings.find((w) => w.task === "T002");
    expect(t002Warn).toBeDefined();
    expect(t002Warn!.message).toContain("unusedHelper()");
  });

  it("warns about extra_dependency_header: declared dep not consumed", () => {
    const content = `
## @signals Tasks
- [ ] T001 @signals Add resolver — produces: resolveSignal() at minds/signals/resolve.ts

## @execution Tasks (depends on: @signals, @config)
- [ ] T002 @execution Use resolveSignal — consumes: resolveSignal() from minds/signals/resolve.ts
`;
    // execution declares dependency on @config but consumes nothing from config
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const extraWarn = result.warnings.find(
      (w) => w.type === "extra_dependency_header"
    );
    expect(extraWarn).toBeDefined();
    expect(extraWarn!.message).toContain("@config");
  });

  it("does NOT flag boundary_violation when task mentions its own Mind's directory", () => {
    // Regression: @observability task mentioning minds/observability/ was falsely flagged
    // because the regex strips the trailing slash from the path before comparison.
    const content = `
## @observability Tasks
- [ ] T001 @observability Add run duration computation to minds/observability/classify-run.ts
`;
    const registry = [
      { name: "observability", owns_files: ["minds/observability/"] },
    ];
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry as any);

    const boundaryErrors = result.errors.filter(
      (e) => e.type === "boundary_violation"
    );
    expect(boundaryErrors).toHaveLength(0);
  });

  it("passes clean tasks with valid: true and no errors or warnings", () => {
    const content = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Add LoadedPipeline type to minds/pipeline_core/types.ts — produces: LoadedPipeline at minds/pipeline_core/types.ts

## @execution Tasks (depends on: @pipeline_core)
- [ ] T002 @execution Use LoadedPipeline in minds/execution/handler.ts — consumes: LoadedPipeline from minds/pipeline_core/types.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
