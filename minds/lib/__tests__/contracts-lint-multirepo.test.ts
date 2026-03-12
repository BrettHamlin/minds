/**
 * contracts-lint-multirepo.test.ts — Tests for multi-repo lint checks (MR-007).
 *
 * Verifies:
 * - repo_unknown: sectionRepo not in workspace aliases
 * - cross_repo_owns_mismatch: repo: backend with owns: frontend:src/
 * - one_mind_one_repo: mixed repo prefixes in one mind's owns
 * - ownership_overlap: only within same repo
 * - All existing lint tests pass with workspace undefined
 */

import { describe, test, expect } from "bun:test";
import { parseTasks, lintTasks, type ParsedTask } from "../contracts.ts";
import type { MindDescription } from "../../mind.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

const emptyRegistry: MindDescription[] = [];

function makeRegistry(...names: string[]): MindDescription[] {
  return names.map(name => ({
    name,
    description: `The ${name} mind`,
    owns_files: [`src/${name}/**`],
    produces: [],
    consumes: [],
  }));
}

// ── repo_unknown ────────────────────────────────────────────────────────────

describe("lintTasks — repo_unknown", () => {
  test("fires when sectionRepo not in workspace aliases", () => {
    const content = `## @api Tasks (repo: unknown-repo, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry, { repoAliases: ["backend", "frontend"] });
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(1);
    expect(repoErrors[0].message).toContain("unknown-repo");
    expect(repoErrors[0].message).toContain("backend, frontend");
  });

  test("does not fire when sectionRepo is in workspace aliases", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry, { repoAliases: ["backend", "frontend"] });
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(0);
  });

  test("does not fire when workspace is not provided", () => {
    const content = `## @api Tasks (repo: whatever, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(0);
  });

  test("does not fire when sectionRepo is undefined", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry, { repoAliases: ["backend"] });
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(0);
  });
});

// ── cross_repo_owns_mismatch ────────────────────────────────────────────────

describe("lintTasks — cross_repo_owns_mismatch", () => {
  test("fires when repo: backend but owns: frontend:src/", () => {
    const content = `## @api Tasks (repo: backend, owns: frontend:src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const mismatchErrors = result.errors.filter(e => e.type === "cross_repo_owns_mismatch");
    expect(mismatchErrors).toHaveLength(1);
    expect(mismatchErrors[0].message).toContain("backend");
    expect(mismatchErrors[0].message).toContain("frontend");
  });

  test("does not fire when repo and owns prefix match", () => {
    const content = `## @api Tasks (repo: backend, owns: backend:src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const mismatchErrors = result.errors.filter(e => e.type === "cross_repo_owns_mismatch");
    expect(mismatchErrors).toHaveLength(0);
  });

  test("does not fire when owns has no repo prefix", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const mismatchErrors = result.errors.filter(e => e.type === "cross_repo_owns_mismatch");
    expect(mismatchErrors).toHaveLength(0);
  });

  test("does not fire when no repo declared", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const mismatchErrors = result.errors.filter(e => e.type === "cross_repo_owns_mismatch");
    expect(mismatchErrors).toHaveLength(0);
  });
});

// ── one_mind_one_repo ───────────────────────────────────────────────────────

describe("lintTasks — one_mind_one_repo", () => {
  test("fires when mind has owns_files with mixed repo prefixes", () => {
    const content = `## @api Tasks (owns: backend:src/api/**, frontend:src/shared/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const repoErrors = result.errors.filter(e => e.type === "one_mind_one_repo");
    expect(repoErrors).toHaveLength(1);
    expect(repoErrors[0].message).toContain("backend");
    expect(repoErrors[0].message).toContain("frontend");
  });

  test("does not fire when all owns have same repo prefix", () => {
    const content = `## @api Tasks (owns: backend:src/api/**, backend:src/routes/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const repoErrors = result.errors.filter(e => e.type === "one_mind_one_repo");
    expect(repoErrors).toHaveLength(0);
  });

  test("does not fire with single owns entry", () => {
    const content = `## @api Tasks (owns: backend:src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const repoErrors = result.errors.filter(e => e.type === "one_mind_one_repo");
    expect(repoErrors).toHaveLength(0);
  });

  test("does not fire when no repo prefixes in owns", () => {
    const content = `## @api Tasks (owns: src/api/**, src/routes/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const repoErrors = result.errors.filter(e => e.type === "one_mind_one_repo");
    expect(repoErrors).toHaveLength(0);
  });
});

// ── ownership_overlap with repos ────────────────────────────────────────────

describe("lintTasks — ownership_overlap with repos", () => {
  test("paths in different repos do NOT overlap", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint

## @ui Tasks (repo: frontend, owns: src/api/**)
- [ ] T002 @ui Build page`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const overlapErrors = result.errors.filter(e => e.type === "ownership_overlap");
    expect(overlapErrors).toHaveLength(0);
  });

  test("paths in same repo DO overlap", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint

## @auth Tasks (repo: backend, owns: src/api/auth/**)
- [ ] T002 @auth Create auth`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const overlapErrors = result.errors.filter(e => e.type === "ownership_overlap");
    expect(overlapErrors.length).toBeGreaterThan(0);
  });

  test("paths without repo info still overlap-checked (backward compat)", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint

## @auth Tasks (owns: src/api/auth/**)
- [ ] T002 @auth Create auth`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const overlapErrors = result.errors.filter(e => e.type === "ownership_overlap");
    expect(overlapErrors.length).toBeGreaterThan(0);
  });
});

// ── backward compatibility ──────────────────────────────────────────────────

describe("lintTasks — backward compatibility", () => {
  test("all existing lint behavior works with workspace undefined", () => {
    const registry = makeRegistry("api");
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint at src/api/handler.ts`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry);
    // Should not throw, should run all existing checks
    expect(result).toBeDefined();
    expect(result.errors).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  test("dangling_consume still fires without workspace", () => {
    const content = `## @ui Tasks (owns: src/ui/**, depends on: @api)
- [ ] T001 @ui Build page (consumes: \`getUsers\` from src/api/routes.ts)`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry);
    const dangling = result.errors.filter(e => e.type === "dangling_consume");
    expect(dangling).toHaveLength(1);
  });
});
