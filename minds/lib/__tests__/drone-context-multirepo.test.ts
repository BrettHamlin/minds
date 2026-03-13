/**
 * drone-context-multirepo.test.ts — Tests for multi-repo drone context (MR-013).
 *
 * Verifies:
 * - DRONE-BRIEF shows repo in header table when provided
 * - DRONE-BRIEF omits repo row when no alias
 * - DRONE-BRIEF shows custom test command
 * - DRONE-BRIEF shows default bun test when no custom command
 */

import { describe, test, expect } from "bun:test";
import { buildDroneBrief } from "../../cli/lib/drone-brief.ts";
import type { MindTask } from "../../cli/lib/implement-types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_TASKS: MindTask[] = [
  { id: "T001", mind: "api", description: "Create endpoint", parallel: false },
];

const BASE_PARAMS = {
  ticketId: "BRE-100",
  mindName: "api",
  waveId: "wave-1",
  tasks: SAMPLE_TASKS,
  dependencies: [],
  featureDir: "specs/BRE-100-feature",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildDroneBrief — multi-repo context (MR-013)", () => {
  test("includes repo in header table when provided", () => {
    const brief = buildDroneBrief({ ...BASE_PARAMS, repo: "backend" });
    expect(brief).toContain("**Repo**");
    expect(brief).toContain("backend");
  });

  test("omits repo row when no alias", () => {
    const brief = buildDroneBrief({ ...BASE_PARAMS });
    expect(brief).not.toContain("**Repo**");
  });

  test("shows custom test command", () => {
    const brief = buildDroneBrief({
      ...BASE_PARAMS,
      testCommand: "npm test -- --scope=api",
    });
    expect(brief).toContain("npm test -- --scope=api");
    expect(brief).not.toContain("bun test minds/api/");
  });

  test("shows default bun test when no custom command", () => {
    const brief = buildDroneBrief({ ...BASE_PARAMS });
    expect(brief).toContain("bun test minds/api/");
  });

  test("custom test command with mindsDir uses custom over default", () => {
    const brief = buildDroneBrief({
      ...BASE_PARAMS,
      mindsDir: "/abs/path/minds",
      testCommand: "pytest tests/",
    });
    expect(brief).toContain("pytest tests/");
    expect(brief).not.toContain("bun test");
  });

  test("default test command uses mindsDir when provided", () => {
    const brief = buildDroneBrief({
      ...BASE_PARAMS,
      mindsDir: "/abs/path/minds",
    });
    expect(brief).toContain("bun test /abs/path/minds/api/");
  });
});
