/**
 * tests/unit/task-phases.test.ts
 *
 * Tests for parseTaskPhases() utility (BRE-429 Violation #6).
 */

import { describe, test, expect } from "bun:test";
import { parseTaskPhases } from "../../minds/pipeline_core/task-phases";

describe("parseTaskPhases: no phase sections", () => {
  test("returns empty array when content has no ## Phase N: headings", () => {
    const content = "# Tasks\n- [ ] do something\n- [x] done thing\n";
    expect(parseTaskPhases(content)).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseTaskPhases("")).toEqual([]);
  });
});

describe("parseTaskPhases: single phase", () => {
  test("parses a single phase with correct counts", () => {
    const content = [
      "## Phase 1: Setup",
      "- [ ] task one",
      "- [x] task done",
      "- [X] task Done2",
    ].join("\n");

    const phases = parseTaskPhases(content);
    expect(phases).toHaveLength(1);
    expect(phases[0]).toEqual({
      number: 1,
      title: "Setup",
      total: 3,
      complete: 2,
      incomplete: 1,
    });
  });

  test("counts only task lines (ignores non-task lines)", () => {
    const content = [
      "## Phase 1: Core",
      "Some description text",
      "- [ ] actual task",
      "### Sub-heading",
      "More text",
      "- [x] done task",
    ].join("\n");

    const phases = parseTaskPhases(content);
    expect(phases[0].total).toBe(2);
    expect(phases[0].incomplete).toBe(1);
    expect(phases[0].complete).toBe(1);
  });

  test("handles all-complete phase", () => {
    const content = "## Phase 2: Done\n- [x] t1\n- [X] t2\n";
    const phases = parseTaskPhases(content);
    expect(phases[0]).toMatchObject({ incomplete: 0, complete: 2, total: 2 });
  });

  test("handles all-incomplete phase", () => {
    const content = "## Phase 3: Pending\n- [ ] t1\n- [ ] t2\n- [ ] t3\n";
    const phases = parseTaskPhases(content);
    expect(phases[0]).toMatchObject({ incomplete: 3, complete: 0, total: 3 });
  });
});

describe("parseTaskPhases: multiple phases", () => {
  test("parses multiple phases in order", () => {
    const content = [
      "## Phase 1: Setup",
      "- [ ] setup task",
      "## Phase 2: Core",
      "- [x] core done",
      "- [ ] core todo",
      "## Phase 3: Polish",
      "- [x] p1",
      "- [x] p2",
    ].join("\n");

    const phases = parseTaskPhases(content);
    expect(phases).toHaveLength(3);
    expect(phases[0]).toMatchObject({ number: 1, title: "Setup", total: 1, incomplete: 1, complete: 0 });
    expect(phases[1]).toMatchObject({ number: 2, title: "Core", total: 2, incomplete: 1, complete: 1 });
    expect(phases[2]).toMatchObject({ number: 3, title: "Polish", total: 2, incomplete: 0, complete: 2 });
  });

  test("stops counting for a phase at a non-Phase ## heading", () => {
    const content = [
      "## Phase 1: Setup",
      "- [ ] task one",
      "## Notes",
      "- [ ] should NOT be counted",
    ].join("\n");

    const phases = parseTaskPhases(content);
    expect(phases).toHaveLength(1);
    expect(phases[0].incomplete).toBe(1);
  });

  test("title preserves text after phase number", () => {
    const content = "## Phase 10: Very Long Title With Spaces\n- [ ] t\n";
    const phases = parseTaskPhases(content);
    expect(phases[0].title).toBe("Very Long Title With Spaces");
    expect(phases[0].number).toBe(10);
  });
});

describe("parseTaskPhases: nextIncompletePhase helper pattern", () => {
  test("finds first phase with incomplete tasks", () => {
    const content = [
      "## Phase 1: Done",
      "- [x] complete",
      "## Phase 2: Working",
      "- [ ] todo",
      "## Phase 3: Later",
      "- [ ] later",
    ].join("\n");

    const phases = parseTaskPhases(content);
    const nextIncomplete = phases.find((p) => p.incomplete > 0)?.number ?? null;
    expect(nextIncomplete).toBe(2);
  });

  test("returns null when all phases are complete", () => {
    const content = [
      "## Phase 1: Done",
      "- [x] t1",
      "## Phase 2: Done",
      "- [x] t2",
    ].join("\n");

    const phases = parseTaskPhases(content);
    const nextIncomplete = phases.find((p) => p.incomplete > 0)?.number ?? null;
    expect(nextIncomplete).toBeNull();
  });
});

// ── analyze-task-phases CLI: argument validation ─────────────────────────────

describe("analyze-task-phases CLI: argument validation", () => {
  const { join } = require("path");
  const { spawnSync } = require("child_process");
  const PROJECT_ROOT = join(import.meta.dir, "../..");

  test("exits with error when no arguments provided", () => {
    const result = spawnSync("bun", [
      "minds/execution/analyze-task-phases.ts",
    ], { encoding: "utf-8", cwd: PROJECT_ROOT });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  test("exits with error when first arg is a flag (not ticket ID)", () => {
    const result = spawnSync("bun", [
      "minds/execution/analyze-task-phases.ts",
      "--help",
    ], { encoding: "utf-8", cwd: PROJECT_ROOT });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("First argument must be a ticket ID");
  });
});
