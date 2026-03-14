/**
 * implement-merge-skip.test.ts — Tests for BRE-625: Skip merge for non-code minds.
 *
 * Non-code minds (build/test pipelines) don't produce code changes to merge.
 * The merge loop should skip them and record ok: true.
 */

import { describe, test, expect } from "bun:test";
import { groupDronesByRepo } from "../implement.ts";
import { producesCode } from "../../../lib/supervisor/pipeline-templates.ts";
import type { MindInfo } from "../../lib/implement-types.ts";
import type { MindDescription } from "../../../mind.ts";

// ---------------------------------------------------------------------------
// MindInfo with pipelineTemplate
// ---------------------------------------------------------------------------

describe("MindInfo pipelineTemplate field", () => {
  test("MindInfo accepts pipelineTemplate", () => {
    const info: MindInfo = {
      mindName: "builder",
      waveId: "wave-1",
      paneId: "%10",
      worktree: "/tmp/wt",
      branch: "minds/BRE-999-builder",
      pipelineTemplate: "build",
    };
    expect(info.pipelineTemplate).toBe("build");
  });

  test("MindInfo pipelineTemplate defaults to undefined (code)", () => {
    const info: MindInfo = {
      mindName: "coder",
      waveId: "wave-1",
      paneId: "%10",
      worktree: "/tmp/wt",
      branch: "minds/BRE-999-coder",
    };
    expect(info.pipelineTemplate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Merge skip logic
// ---------------------------------------------------------------------------

describe("merge skip for non-code minds", () => {
  function makeMind(overrides?: Partial<MindDescription>): MindDescription {
    return {
      name: "test",
      domain: "testing",
      keywords: [],
      owns_files: [],
      capabilities: [],
      ...overrides,
    };
  }

  test("code mind produces code — should be merged", () => {
    const desc = makeMind({ pipeline_template: "code" });
    expect(producesCode(desc)).toBe(true);
  });

  test("default (no template) produces code — should be merged", () => {
    const desc = makeMind();
    expect(producesCode(desc)).toBe(true);
  });

  test("build mind does NOT produce code — should skip merge", () => {
    const desc = makeMind({ pipeline_template: "build" });
    expect(producesCode(desc)).toBe(false);
  });

  test("test mind does NOT produce code — should skip merge", () => {
    const desc = makeMind({ pipeline_template: "test" });
    expect(producesCode(desc)).toBe(false);
  });

  test("custom pipeline with code stages produces code", () => {
    const desc = makeMind({
      pipeline: [
        { type: "spawn-drone" },
        { type: "wait-completion" },
        { type: "git-diff" },
        { type: "run-tests" },
      ],
    });
    expect(producesCode(desc)).toBe(true);
  });

  test("custom pipeline without code stages does not produce code", () => {
    const desc = makeMind({
      pipeline: [
        { type: "spawn-drone" },
        { type: "wait-completion" },
        { type: "run-command" },
        { type: "collect-results" },
      ],
    });
    expect(producesCode(desc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// groupDronesByRepo with pipelineTemplate
// ---------------------------------------------------------------------------

describe("groupDronesByRepo preserves pipelineTemplate", () => {
  test("groups drones with mixed pipeline templates", () => {
    const drones: MindInfo[] = [
      { mindName: "coder", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1" },
      { mindName: "builder", waveId: "w1", paneId: "%2", worktree: "/w2", branch: "b2", pipelineTemplate: "build" },
      { mindName: "tester", waveId: "w1", paneId: "%3", worktree: "/w3", branch: "b3", pipelineTemplate: "test" },
    ];

    const grouped = groupDronesByRepo(drones);
    const defaultGroup = grouped.get("__default__")!;
    expect(defaultGroup).toHaveLength(3);
    expect(defaultGroup[0].pipelineTemplate).toBeUndefined();
    expect(defaultGroup[1].pipelineTemplate).toBe("build");
    expect(defaultGroup[2].pipelineTemplate).toBe("test");
  });

  test("groups drones with repo and pipelineTemplate", () => {
    const drones: MindInfo[] = [
      { mindName: "api_coder", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1", repo: "backend" },
      { mindName: "api_builder", waveId: "w1", paneId: "%2", worktree: "/w2", branch: "b2", repo: "backend", pipelineTemplate: "build" },
    ];

    const grouped = groupDronesByRepo(drones);
    const backendGroup = grouped.get("backend")!;
    expect(backendGroup).toHaveLength(2);
    expect(backendGroup[0].pipelineTemplate).toBeUndefined();
    expect(backendGroup[1].pipelineTemplate).toBe("build");
  });
});

// ---------------------------------------------------------------------------
// Simulated merge skip decision
// ---------------------------------------------------------------------------

describe("merge skip decision logic", () => {
  function shouldSkipMerge(drone: MindInfo, registry: MindDescription[]): boolean {
    if (drone.pipelineTemplate && drone.pipelineTemplate !== "code") {
      const regEntry = registry.find(m => m.name === drone.mindName);
      const isNonCode = regEntry ? !producesCode(regEntry) : true;
      return isNonCode;
    }
    return false;
  }

  const registry: MindDescription[] = [
    { name: "coder", domain: "core", keywords: [], owns_files: ["src/**"], capabilities: [] },
    { name: "builder", domain: "build", keywords: [], owns_files: ["**"], capabilities: [], pipeline_template: "build" },
    { name: "tester", domain: "qa", keywords: [], owns_files: ["**"], capabilities: [], pipeline_template: "test" },
    { name: "custom_code", domain: "ops", keywords: [], owns_files: ["ops/**"], capabilities: [],
      pipeline: [{ type: "spawn-drone" }, { type: "wait-completion" }, { type: "git-diff" }, { type: "llm-review" }] },
  ];

  test("code mind (default) is NOT skipped", () => {
    const drone: MindInfo = { mindName: "coder", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1" };
    expect(shouldSkipMerge(drone, registry)).toBe(false);
  });

  test("code mind (explicit) is NOT skipped", () => {
    const drone: MindInfo = { mindName: "coder", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1", pipelineTemplate: "code" };
    expect(shouldSkipMerge(drone, registry)).toBe(false);
  });

  test("build mind IS skipped", () => {
    const drone: MindInfo = { mindName: "builder", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1", pipelineTemplate: "build" };
    expect(shouldSkipMerge(drone, registry)).toBe(true);
  });

  test("test mind IS skipped", () => {
    const drone: MindInfo = { mindName: "tester", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1", pipelineTemplate: "test" };
    expect(shouldSkipMerge(drone, registry)).toBe(true);
  });

  test("unknown mind with non-code template IS skipped (safe default)", () => {
    const drone: MindInfo = { mindName: "unknown", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1", pipelineTemplate: "build" };
    expect(shouldSkipMerge(drone, registry)).toBe(true);
  });

  test("custom pipeline with code stages is NOT skipped even with non-standard template name", () => {
    // custom_code has an explicit pipeline with git-diff + llm-review (code stages)
    // But pipelineTemplate is not set on the drone — so it's not skipped
    const drone: MindInfo = { mindName: "custom_code", waveId: "w1", paneId: "%1", worktree: "/w1", branch: "b1" };
    expect(shouldSkipMerge(drone, registry)).toBe(false);
  });
});
