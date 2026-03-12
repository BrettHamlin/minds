import { describe, expect, test } from "bun:test";
import { parseTasks } from "../contracts.ts";
import { parseAndGroupTasks } from "../../cli/lib/task-parser.ts";

describe("parseTasks — repo: annotation", () => {
  test("parses repo: from section header", () => {
    const content = `## @api Tasks (repo: backend)
- [ ] T001 @api Create users endpoint`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionRepo).toBe("backend");
  });

  test("parses repo: alongside owns:", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create users endpoint`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionRepo).toBe("backend");
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
  });

  test("parses repo: alongside owns: and depends on:", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**, depends on: @auth)
- [ ] T001 @api Create users endpoint`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionRepo).toBe("backend");
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
    expect(tasks[0].sectionDeclaredDeps).toEqual(["auth"]);
  });

  test("parses owns: without repo: — sectionRepo is undefined", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create users endpoint`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionRepo).toBeUndefined();
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
  });

  test("no parenthetical — sectionRepo is undefined", () => {
    const content = `## @api Tasks
- [ ] T001 @api Create users endpoint`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionRepo).toBeUndefined();
  });

  test("repo with hyphen in alias", () => {
    const content = `## @ui Tasks (repo: my-frontend)
- [ ] T001 @ui Build page`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sectionRepo).toBe("my-frontend");
  });

  test("multiple sections with different repos", () => {
    const content = `## @api Tasks (repo: backend)
- [ ] T001 @api Create endpoint

## @ui Tasks (repo: frontend)
- [ ] T002 @ui Build page`;
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].sectionRepo).toBe("backend");
    expect(tasks[1].sectionRepo).toBe("frontend");
  });

  test("repo: does not bleed into owns: match", () => {
    const content = `## @api Tasks (owns: src/api/**, repo: backend)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    expect(tasks[0].sectionOwnsFiles).toEqual(["src/api/**"]);
    expect(tasks[0].sectionRepo).toBe("backend");
  });
});

describe("parseAndGroupTasks — repo surfacing", () => {
  test("surfaces sectionRepo onto MindTaskGroup.repo", () => {
    const content = `## @api Tasks (repo: backend)
- [ ] T001 @api Create endpoint`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(1);
    expect(groups[0].repo).toBe("backend");
  });

  test("surfaces repo onto individual MindTask.repo", () => {
    const content = `## @api Tasks (repo: backend)
- [ ] T001 @api Create endpoint`;
    const groups = parseAndGroupTasks(content);
    expect(groups[0].tasks[0].repo).toBe("backend");
  });

  test("group without repo: has repo undefined", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const groups = parseAndGroupTasks(content);
    expect(groups[0].repo).toBeUndefined();
  });

  test("multiple groups with different repos", () => {
    const content = `## @api Tasks (repo: backend)
- [ ] T001 @api Create endpoint

## @ui Tasks (repo: frontend, depends on: @api)
- [ ] T002 @ui Build page`;
    const groups = parseAndGroupTasks(content);
    expect(groups).toHaveLength(2);
    expect(groups[0].repo).toBe("backend");
    expect(groups[1].repo).toBe("frontend");
  });
});
