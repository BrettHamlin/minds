/**
 * implement-types-repo.test.ts — Tests for repo field additions (MR-003).
 * Verifies all types accept optional repo field and validateMindDescription works.
 */

import { describe, test, expect } from "bun:test";
import type {
  MindTask,
  MindTaskGroup,
  DroneInfo,
  MindInfo,
  ImplementResult,
} from "../implement-types.ts";
import { validateMindDescription, type MindDescription } from "../../../mind.ts";
import type { SupervisorConfig } from "../../../lib/supervisor/supervisor-types.ts";

describe("MR-003: repo field on core interfaces", () => {
  // ── MindTask ─────────────────────────────────────────────────────────────

  test("MindTask without repo compiles and works", () => {
    const task: MindTask = {
      id: "T001",
      mind: "api",
      description: "implement endpoint",
      parallel: false,
    };
    expect(task.repo).toBeUndefined();
  });

  test("MindTask with repo compiles and works", () => {
    const task: MindTask = {
      id: "T001",
      mind: "api",
      description: "implement endpoint",
      parallel: false,
      repo: "backend",
    };
    expect(task.repo).toBe("backend");
  });

  // ── MindTaskGroup ────────────────────────────────────────────────────────

  test("MindTaskGroup without repo compiles", () => {
    const group: MindTaskGroup = {
      mind: "api",
      tasks: [],
      dependencies: [],
    };
    expect(group.repo).toBeUndefined();
  });

  test("MindTaskGroup with repo compiles", () => {
    const group: MindTaskGroup = {
      mind: "api",
      tasks: [],
      dependencies: [],
      repo: "backend",
    };
    expect(group.repo).toBe("backend");
  });

  // ── DroneInfo ────────────────────────────────────────────────────────────

  test("DroneInfo without repo compiles", () => {
    const info: DroneInfo = {
      mindName: "api",
      waveId: "wave-1",
      paneId: "%1",
      worktree: "/tmp/wt",
      branch: "minds/BRE-1-api",
    };
    expect(info.repo).toBeUndefined();
  });

  test("DroneInfo with repo compiles", () => {
    const info: DroneInfo = {
      mindName: "api",
      waveId: "wave-1",
      paneId: "%1",
      worktree: "/tmp/wt",
      branch: "minds/BRE-1-api",
      repo: "backend",
    };
    expect(info.repo).toBe("backend");
  });

  // ── MindInfo ─────────────────────────────────────────────────────────────

  test("MindInfo without repo compiles", () => {
    const info: MindInfo = {
      mindName: "api",
      waveId: "wave-1",
      paneId: "%1",
      worktree: "/tmp/wt",
      branch: "minds/BRE-1-api",
    };
    expect(info.repo).toBeUndefined();
  });

  test("MindInfo with repo compiles", () => {
    const info: MindInfo = {
      mindName: "api",
      waveId: "wave-1",
      paneId: "%1",
      worktree: "/tmp/wt",
      branch: "minds/BRE-1-api",
      repo: "backend",
    };
    expect(info.repo).toBe("backend");
  });

  // ── ImplementResult.mergeResults ─────────────────────────────────────────

  test("mergeResults element without repo compiles", () => {
    const result: ImplementResult = {
      ok: true,
      wavesCompleted: 1,
      totalWaves: 1,
      mindsSpawned: [],
      mergeResults: [{ mind: "api", ok: true }],
      errors: [],
    };
    expect(result.mergeResults[0].repo).toBeUndefined();
  });

  test("mergeResults element with repo compiles", () => {
    const result: ImplementResult = {
      ok: true,
      wavesCompleted: 1,
      totalWaves: 1,
      mindsSpawned: [],
      mergeResults: [{ mind: "api", ok: true, repo: "backend" }],
      errors: [],
    };
    expect(result.mergeResults[0].repo).toBe("backend");
  });

  // ── SupervisorConfig ─────────────────────────────────────────────────────

  test("SupervisorConfig accepts new multi-repo fields", () => {
    const config: Partial<SupervisorConfig> = {
      repo: "backend",
      mindRepoRoot: "/path/to/backend",
      testCommand: "npm test",
      installCommand: "npm install",
    };
    expect(config.repo).toBe("backend");
    expect(config.mindRepoRoot).toBe("/path/to/backend");
    expect(config.testCommand).toBe("npm test");
    expect(config.installCommand).toBe("npm install");
  });

  test("SupervisorConfig without multi-repo fields still works", () => {
    const config: Partial<SupervisorConfig> = {
      mindName: "api",
      ticketId: "BRE-1",
    };
    expect(config.repo).toBeUndefined();
    expect(config.mindRepoRoot).toBeUndefined();
    expect(config.testCommand).toBeUndefined();
    expect(config.installCommand).toBeUndefined();
  });
});

// ── validateMindDescription ──────────────────────────────────────────────────

describe("validateMindDescription with repo field", () => {
  const baseMind: MindDescription = {
    name: "api",
    domain: "backend",
    keywords: ["api"],
    owns_files: ["src/api/**"],
    capabilities: ["handle requests"],
  };

  test("accepts MindDescription without repo", () => {
    expect(validateMindDescription(baseMind)).toBe(true);
  });

  test("accepts MindDescription with string repo", () => {
    expect(validateMindDescription({ ...baseMind, repo: "backend" })).toBe(true);
  });

  test("rejects MindDescription with non-string repo", () => {
    expect(validateMindDescription({ ...baseMind, repo: 123 })).toBe(false);
  });

  test("rejects MindDescription with boolean repo", () => {
    expect(validateMindDescription({ ...baseMind, repo: true })).toBe(false);
  });

  test("rejects MindDescription with empty string repo", () => {
    expect(validateMindDescription({ ...baseMind, repo: "" })).toBe(false);
  });
});
