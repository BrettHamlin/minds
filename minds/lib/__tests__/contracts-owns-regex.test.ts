/**
 * contracts-owns-regex.test.ts — Tests for the owns: regex fix in parseTasks() (MR-P2).
 * Verifies the regex does not greedily consume repo: clauses.
 */

import { describe, test, expect } from "bun:test";
import { parseTasks } from "../contracts.ts";

describe("parseTasks owns: regex (MR-P2)", () => {
  test("owns followed by repo: — repo clause not consumed as owns", () => {
    const content = `## @api Tasks (owns: src/api/**, repo: backend)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
  });

  test("repo before owns — owns still parsed correctly", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
  });

  test("repo-qualified owns path with colon", () => {
    const content = `## @api Tasks (owns: backend:src/api/**)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["backend:src/api/**"]);
  });

  test("owns + depends + repo all present", () => {
    const content = `## @api Tasks (owns: src/api/**, depends on: @auth, repo: backend)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
    expect(tasks[0].sectionHasDepsHeader).toBe(true);
    expect(tasks[0].sectionDeclaredDeps).toEqual(["auth"]);
  });

  test("multiple owns values without repo", () => {
    const content = `## @api Tasks (owns: src/api/**, src/routes/**)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**", "src/routes/**"]);
  });

  test("owns with no repo — existing behavior preserved", () => {
    const content = `## @api Tasks (owns: src/api/**)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
  });

  test("no owns annotation — empty owns array", () => {
    const content = `## @api Tasks\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual([]);
  });

  test("repo: with spaces before colon still terminates owns", () => {
    const content = `## @api Tasks (owns: src/api/**, repo : backend)\n- [ ] T001 @api Implement endpoint`;
    const tasks = parseTasks(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
  });
});
