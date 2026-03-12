import { describe, expect, it } from "bun:test";
import { parseAndGroupTasks, buildDependencyGraph } from "./task-parser.ts";

// ─── T002/T014: parseAndGroupTasks with ownsFiles ───────────────────────────

describe("parseAndGroupTasks ownsFiles (T002)", () => {
  it("populates ownsFiles from section header owns: annotation", () => {
    const content = `
## @new_api Tasks (owns: src/api/**, src/models/**)
- [ ] T001 @new_api Create routes
- [ ] T002 @new_api Create models
`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].mind).toBe("new_api");
    expect(groups[0].ownsFiles).toEqual(["src/api/**", "src/models/**"]);
    expect(groups[0].tasks).toHaveLength(2);
  });

  it("leaves ownsFiles undefined when no owns: annotation", () => {
    const content = `
## @pipeline_core Tasks
- [ ] T001 @pipeline_core Do thing
`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].ownsFiles).toBeUndefined();
  });

  it("handles owns: combined with depends on:", () => {
    const content = `
## @new_api Tasks (owns: src/api/**, depends on: @core)
- [ ] T001 @new_api Create routes
`;
    const groups = parseAndGroupTasks(content);
    expect(groups[0].ownsFiles).toEqual(["src/api/**"]);
    expect(groups[0].dependencies).toEqual(["core"]);
  });

  it("handles multiple groups with mixed owns: presence", () => {
    const content = `
## @existing Tasks
- [ ] T001 @existing Update existing code

## @new_mind Tasks (owns: src/new/**)
- [ ] T002 @new_mind Create new feature
`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(2);

    const existing = groups.find((g) => g.mind === "existing")!;
    expect(existing.ownsFiles).toBeUndefined();

    const newMind = groups.find((g) => g.mind === "new_mind")!;
    expect(newMind.ownsFiles).toEqual(["src/new/**"]);
  });
});

// ─── T014: Edge cases for ownsFiles ──────────────────────────────────────────

describe("parseAndGroupTasks ownsFiles edge cases (T014)", () => {
  it("handles empty owns: annotation gracefully (no glob after colon)", () => {
    // Edge case: someone writes (owns: ) with nothing after colon
    const content = `
## @api Tasks (owns: )
- [ ] T001 @api Create routes
`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(1);
    // Empty owns: should result in undefined (no valid globs parsed)
    expect(groups[0].ownsFiles).toBeUndefined();
  });

  it("handles multiple groups where each has distinct ownsFiles", () => {
    const content = `
## @auth Tasks (owns: src/auth/**)
- [ ] T001 @auth Create JWT

## @db Tasks (owns: src/db/**, src/migrations/**)
- [ ] T002 @db Create schema

## @api Tasks (owns: src/api/**)
- [ ] T003 @api Create endpoints
`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(3);

    const auth = groups.find((g) => g.mind === "auth")!;
    expect(auth.ownsFiles).toEqual(["src/auth/**"]);

    const db = groups.find((g) => g.mind === "db")!;
    expect(db.ownsFiles).toEqual(["src/db/**", "src/migrations/**"]);

    const api = groups.find((g) => g.mind === "api")!;
    expect(api.ownsFiles).toEqual(["src/api/**"]);
  });

  it("handles depends on: with owns: in reversed order", () => {
    const content = `
## @api Tasks (depends on: @core, @auth, owns: src/api/**)
- [ ] T001 @api Build routes
`;
    const groups = parseAndGroupTasks(content);
    expect(groups[0].ownsFiles).toEqual(["src/api/**"]);
    expect(groups[0].dependencies).toEqual(["core", "auth"]);
  });

  it("single glob owns: produces single-element array", () => {
    const content = `
## @api Tasks (owns: src/api/**)
- [ ] T001 @api Build routes
`;
    const groups = parseAndGroupTasks(content);
    expect(groups[0].ownsFiles).toEqual(["src/api/**"]);
    expect(groups[0].ownsFiles).toHaveLength(1);
  });
});

// ─── Existing functionality preserved ────────────────────────────────────────

describe("parseAndGroupTasks existing behavior", () => {
  it("groups tasks by mind and extracts dependencies", () => {
    const content = `
## @core Tasks
- [ ] T001 @core Setup base

## @api Tasks (depends on: @core)
- [ ] T002 @api Build endpoints
- [ ] T003 @api Add middleware
`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(2);

    const core = groups.find((g) => g.mind === "core")!;
    expect(core.tasks).toHaveLength(1);
    expect(core.dependencies).toEqual([]);

    const api = groups.find((g) => g.mind === "api")!;
    expect(api.tasks).toHaveLength(2);
    expect(api.dependencies).toEqual(["core"]);
  });

  it("builds dependency graph correctly", () => {
    const content = `
## @core Tasks
- [ ] T001 @core Setup base

## @api Tasks (depends on: @core)
- [ ] T002 @api Build endpoints
`;
    const groups = parseAndGroupTasks(content);
    const deps = buildDependencyGraph(groups);
    expect(deps).toEqual({ api: ["core"] });
  });
});
