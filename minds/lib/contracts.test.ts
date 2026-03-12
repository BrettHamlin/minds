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

    // T002 is checked [x] so it's skipped — only T001 remains
    expect(tasks).toHaveLength(1);

    const t001 = tasks[0];
    expect(t001.id).toBe("T001");
    expect(t001.mind).toBe("pipeline_core");
    expect(t001.parallel).toBe(false);
    expect(t001.produces).toBeUndefined();
    expect(t001.consumes).toBeUndefined();
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

// ─── T001: parseTasks owns: annotation ────────────────────────────────────────

describe("parseTasks owns: annotation (T001)", () => {
  it("parses owns: annotation from section header", () => {
    const content = `
## @new_mind Tasks (owns: src/api/**, src/models/**)
- [ ] T001 @new_mind Do thing
`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**", "src/models/**"]);
  });

  it("handles combined owns: and depends on: (owns first)", () => {
    const content = `
## @new_mind Tasks (owns: src/api/**, depends on: @core)
- [ ] T001 @new_mind Do thing
`;
    const tasks = parseTasks(content);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
    expect(tasks[0].sectionHasDepsHeader).toBe(true);
    expect(tasks[0].sectionDeclaredDeps).toEqual(["core"]);
  });

  it("handles combined depends on: and owns: (depends first)", () => {
    const content = `
## @new_mind Tasks (depends on: @core, owns: src/api/**)
- [ ] T001 @new_mind Do thing
`;
    const tasks = parseTasks(content);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
    expect(tasks[0].sectionHasDepsHeader).toBe(true);
    expect(tasks[0].sectionDeclaredDeps).toEqual(["core"]);
  });

  it("produces empty sectionOwnsFiles when no owns: annotation", () => {
    const content = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Do thing
`;
    const tasks = parseTasks(content);
    expect(tasks[0].sectionOwnsFiles).toEqual([]);
  });

  it("carries sectionOwnsFiles to all tasks in section", () => {
    const content = `
## @new_mind Tasks (owns: src/api/**)
- [ ] T001 @new_mind First task
- [ ] T002 @new_mind Second task
`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
    expect(tasks[1].sectionOwnsFiles).toEqual(["src/api/**"]);
  });

  it("existing depends on: only parsing is unchanged", () => {
    const tasks = parseTasks(TASKS_WITH_ANNOTATIONS);
    const t004 = tasks.find((t) => t.id === "T004")!;
    expect(t004.sectionHasDepsHeader).toBe(true);
    expect(t004.sectionDeclaredDeps).toEqual(["pipeline_core", "signals"]);
    expect(t004.sectionOwnsFiles).toEqual([]);
  });
});

// ─── T003: ownership_overlap lint check ──────────────────────────────────────

describe("lintTasks ownership_overlap (T003)", () => {
  it("flags overlapping ownership between two task minds", () => {
    const content = `
## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create routes

## @auth Tasks (owns: src/api/auth/**)
- [ ] T002 @auth Create auth middleware
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const err = result.errors.find((e) => e.type === "ownership_overlap");
    expect(err).toBeDefined();
    expect(err!.message).toContain("@api");
    expect(err!.message).toContain("@auth");
  });

  it("does not flag non-overlapping ownership", () => {
    const content = `
## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create routes

## @models Tasks (owns: src/models/**)
- [ ] T002 @models Create models
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const overlapErrors = result.errors.filter((e) => e.type === "ownership_overlap");
    expect(overlapErrors).toHaveLength(0);
  });

  it("flags overlap between task mind and registry mind", () => {
    const content = `
## @new_mind Tasks (owns: minds/signals/extra/**)
- [ ] T001 @new_mind Add extra signal utils
`;
    const registry: MinimalMind[] = [
      { name: "signals", owns_files: ["minds/signals/"] },
    ];
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry as any);

    const err = result.errors.find((e) => e.type === "ownership_overlap");
    expect(err).toBeDefined();
  });

  it("does not self-overlap when same mind appears once", () => {
    const content = `
## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create routes
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const overlapErrors = result.errors.filter((e) => e.type === "ownership_overlap");
    expect(overlapErrors).toHaveLength(0);
  });
});

// ─── T004: unregistered_no_owns lint check ──────────────────────────────────

describe("lintTasks unregistered_no_owns (T004)", () => {
  it("flags unregistered mind without owns: annotation", () => {
    const content = `
## @new_mind Tasks
- [ ] T001 @new_mind Do something
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const err = result.errors.find((e) => e.type === "unregistered_no_owns");
    expect(err).toBeDefined();
    expect(err!.message).toContain("@new_mind");
  });

  it("does not flag unregistered mind WITH owns: annotation", () => {
    const content = `
## @new_mind Tasks (owns: src/foo/**)
- [ ] T001 @new_mind Do something
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const unregErrors = result.errors.filter((e) => e.type === "unregistered_no_owns");
    expect(unregErrors).toHaveLength(0);
  });

  it("does not flag registered mind without owns: annotation", () => {
    const content = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Do something in minds/pipeline_core/foo.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const unregErrors = result.errors.filter((e) => e.type === "unregistered_no_owns");
    expect(unregErrors).toHaveLength(0);
  });
});

// ─── T005: overly_broad_owns warning ────────────────────────────────────────

describe("lintTasks overly_broad_owns (T005)", () => {
  it("warns on bare ** glob", () => {
    const content = `
## @greedy Tasks (owns: **)
- [ ] T001 @greedy Own everything
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const warn = result.warnings.find((w) => w.type === "overly_broad_owns");
    expect(warn).toBeDefined();
    expect(warn!.message).toContain("**");
  });

  it("warns on bare * glob", () => {
    const content = `
## @greedy Tasks (owns: *)
- [ ] T001 @greedy Own root
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const warn = result.warnings.find((w) => w.type === "overly_broad_owns");
    expect(warn).toBeDefined();
  });

  it("warns on single-segment path like src/", () => {
    const content = `
## @greedy Tasks (owns: src/)
- [ ] T001 @greedy Own src
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const warn = result.warnings.find((w) => w.type === "overly_broad_owns");
    expect(warn).toBeDefined();
    expect(warn!.message).toContain("src/");
  });

  it("does NOT warn on specific path like src/api/**", () => {
    const content = `
## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create routes
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const broadWarnings = result.warnings.filter((w) => w.type === "overly_broad_owns");
    expect(broadWarnings).toHaveLength(0);
  });
});

// ─── T006: path_traversal rejection ─────────────────────────────────────────

describe("lintTasks path_traversal (T006)", () => {
  it("rejects owns: glob containing ..", () => {
    const content = `
## @evil Tasks (owns: src/../etc/passwd)
- [ ] T001 @evil Escape sandbox
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const err = result.errors.find((e) => e.type === "path_traversal");
    expect(err).toBeDefined();
    expect(err!.message).toContain("..");
  });

  it("does not reject normal paths", () => {
    const content = `
## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create routes
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const traversalErrors = result.errors.filter((e) => e.type === "path_traversal");
    expect(traversalErrors).toHaveLength(0);
  });
});

// ─── T007: owns_conflict lint check ─────────────────────────────────────────

describe("lintTasks owns_conflict (T007)", () => {
  it("flags when task owns: differs from registry owns_files", () => {
    const content = `
## @api_mind Tasks (owns: src/api/**)
- [ ] T001 @api_mind Do thing in src/api/foo.ts
`;
    const registry: MinimalMind[] = [
      { name: "api_mind", owns_files: ["src/api/"] },
    ];
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry as any);

    const err = result.errors.find((e) => e.type === "owns_conflict");
    expect(err).toBeDefined();
    expect(err!.message).toContain("src/api/**");
    expect(err!.message).toContain("src/api/");
  });

  it("does not flag when no owns: annotation on registered mind", () => {
    const content = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Do thing in minds/pipeline_core/foo.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const conflictErrors = result.errors.filter((e) => e.type === "owns_conflict");
    expect(conflictErrors).toHaveLength(0);
  });

  it("does not flag when owns: matches registry exactly", () => {
    const content = `
## @pipeline_core Tasks (owns: minds/pipeline_core/)
- [ ] T001 @pipeline_core Do thing in minds/pipeline_core/foo.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const conflictErrors = result.errors.filter((e) => e.type === "owns_conflict");
    expect(conflictErrors).toHaveLength(0);
  });
});

// ─── T013: Additional coverage for combined annotations through lint ─────────

describe("lintTasks with combined annotations (T013)", () => {
  it("lint correctly processes tasks with owns: and depends on: combined (owns first)", () => {
    const content = `
## @core Tasks (owns: src/core/**)
- [ ] T001 @core Setup base — produces: CoreConfig at src/core/config.ts

## @api Tasks (owns: src/api/**, depends on: @core)
- [ ] T002 @api Build endpoints — consumes: CoreConfig from src/core/config.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    // Should be valid — no lint errors expected (deps declared, no overlap, both have owns:)
    const overlapErrors = result.errors.filter((e) => e.type === "ownership_overlap");
    expect(overlapErrors).toHaveLength(0);
    const unregErrors = result.errors.filter((e) => e.type === "unregistered_no_owns");
    expect(unregErrors).toHaveLength(0);
  });

  it("lint correctly processes tasks with depends on: and owns: combined (depends first)", () => {
    const content = `
## @core Tasks (owns: src/core/**)
- [ ] T001 @core Setup base — produces: CoreConfig at src/core/config.ts

## @api Tasks (depends on: @core, owns: src/api/**)
- [ ] T002 @api Build endpoints — consumes: CoreConfig from src/core/config.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    // Both minds have owns:, no overlap, deps satisfied
    const overlapErrors = result.errors.filter((e) => e.type === "ownership_overlap");
    expect(overlapErrors).toHaveLength(0);
    const unregErrors = result.errors.filter((e) => e.type === "unregistered_no_owns");
    expect(unregErrors).toHaveLength(0);
  });
});

// ─── T013: Edge cases for ownership_overlap ──────────────────────────────────

describe("lintTasks ownership_overlap edge cases (T013)", () => {
  it("flags overlap between two registry minds (no task owns: involved)", () => {
    const content = `
## @signals Tasks
- [ ] T001 @signals Do work

## @signals_extra Tasks
- [ ] T002 @signals_extra Do other work
`;
    const registry: MinimalMind[] = [
      { name: "signals", owns_files: ["minds/signals/"] },
      { name: "signals_extra", owns_files: ["minds/signals/extra/"] },
    ];
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry as any);

    const err = result.errors.find((e) => e.type === "ownership_overlap");
    expect(err).toBeDefined();
  });

  it("flags overlap with multiple globs where only one pair overlaps", () => {
    const content = `
## @mind_a Tasks (owns: src/api/**, src/shared/**)
- [ ] T001 @mind_a Do A

## @mind_b Tasks (owns: src/models/**, src/shared/utils/**)
- [ ] T002 @mind_b Do B
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    // src/shared/** and src/shared/utils/** overlap
    const overlapErrors = result.errors.filter((e) => e.type === "ownership_overlap");
    expect(overlapErrors.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── T013: Edge cases for path_traversal ─────────────────────────────────────

describe("lintTasks path_traversal edge cases (T013)", () => {
  it("rejects nested path traversal with multiple .. segments", () => {
    const content = `
## @evil Tasks (owns: src/../../etc/shadow)
- [ ] T001 @evil Escape deeper
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const err = result.errors.find((e) => e.type === "path_traversal");
    expect(err).toBeDefined();
  });

  it("does not reject paths containing dots that are not traversal (e.g. ..config)", () => {
    const content = `
## @api Tasks (owns: src/api.config/**)
- [ ] T001 @api Configure
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const traversalErrors = result.errors.filter((e) => e.type === "path_traversal");
    expect(traversalErrors).toHaveLength(0);
  });
});

// ─── T013: Edge cases for overly_broad_owns ──────────────────────────────────

describe("lintTasks overly_broad_owns edge cases (T013)", () => {
  it("does NOT warn on two-segment path like src/api/", () => {
    const content = `
## @api Tasks (owns: src/api/)
- [ ] T001 @api Do work
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const broadWarnings = result.warnings.filter((w) => w.type === "overly_broad_owns");
    expect(broadWarnings).toHaveLength(0);
  });

  it("warns on single-segment path with different name like lib/", () => {
    const content = `
## @all Tasks (owns: lib/)
- [ ] T001 @all Do work
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const warn = result.warnings.find((w) => w.type === "overly_broad_owns");
    expect(warn).toBeDefined();
  });
});

// ─── T013: Edge cases for unregistered_no_owns ──────────────────────────────

describe("lintTasks unregistered_no_owns edge cases (T013)", () => {
  it("flags multiple unregistered minds without owns:", () => {
    const content = `
## @new_a Tasks
- [ ] T001 @new_a Do A

## @new_b Tasks
- [ ] T002 @new_b Do B
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, []);

    const unregErrors = result.errors.filter((e) => e.type === "unregistered_no_owns");
    expect(unregErrors).toHaveLength(2);
  });
});

// ─── T013: Edge cases for owns_conflict ──────────────────────────────────────

describe("lintTasks owns_conflict edge cases (T013)", () => {
  it("flags conflict when annotation has extra globs beyond registry", () => {
    const content = `
## @pipeline_core Tasks (owns: minds/pipeline_core/, minds/pipeline_core/extra/)
- [ ] T001 @pipeline_core Do thing in minds/pipeline_core/foo.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const err = result.errors.find((e) => e.type === "owns_conflict");
    expect(err).toBeDefined();
  });

  it("does not flag unregistered mind with owns: (no registry entry to conflict with)", () => {
    const content = `
## @brand_new Tasks (owns: src/brand_new/**)
- [ ] T001 @brand_new Do thing
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, REGISTRY as any);

    const conflictErrors = result.errors.filter((e) => e.type === "owns_conflict");
    expect(conflictErrors).toHaveLength(0);
  });
});
