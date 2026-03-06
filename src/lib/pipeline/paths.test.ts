/**
 * Unit tests for paths.ts — deterministic path construction.
 */

import { describe, test, expect } from "bun:test";
import { registryPath, signalQueuePath, findingsPath, resolutionsPath } from "./paths";

describe("registryPath", () => {
  test("builds correct registry path", () => {
    expect(registryPath("/repo", "BRE-123")).toBe(
      "/repo/.collab/state/pipeline-registry/BRE-123.json",
    );
  });

  test("handles ticket IDs with various formats", () => {
    expect(registryPath("/repo", "PROJ-999")).toBe(
      "/repo/.collab/state/pipeline-registry/PROJ-999.json",
    );
    expect(registryPath("/repo", "TEST-1")).toBe(
      "/repo/.collab/state/pipeline-registry/TEST-1.json",
    );
  });

  test("handles nested repoRoot paths", () => {
    expect(registryPath("/home/user/projects/myrepo", "BRE-428")).toBe(
      "/home/user/projects/myrepo/.collab/state/pipeline-registry/BRE-428.json",
    );
  });
});

describe("signalQueuePath", () => {
  test("builds correct signal queue path", () => {
    expect(signalQueuePath("/repo", "BRE-123")).toBe(
      "/repo/.collab/state/signal-queue/BRE-123.json",
    );
  });

  test("handles different ticket IDs", () => {
    expect(signalQueuePath("/repo", "PROJ-42")).toBe(
      "/repo/.collab/state/signal-queue/PROJ-42.json",
    );
  });
});

describe("findingsPath", () => {
  test("builds correct findings path for round 1", () => {
    expect(findingsPath("/feature", "clarify", 1)).toBe(
      "/feature/findings/clarify-round-1.json",
    );
  });

  test("builds correct findings path for round 2", () => {
    expect(findingsPath("/feature", "spec_critique", 2)).toBe(
      "/feature/findings/spec_critique-round-2.json",
    );
  });

  test("builds correct findings path for analyze phase", () => {
    expect(findingsPath("/specs/bre-428-path-utils", "analyze", 1)).toBe(
      "/specs/bre-428-path-utils/findings/analyze-round-1.json",
    );
  });
});

describe("resolutionsPath", () => {
  test("builds correct resolutions path for round 1", () => {
    expect(resolutionsPath("/feature", "clarify", 1)).toBe(
      "/feature/resolutions/clarify-round-1.json",
    );
  });

  test("builds correct resolutions path for round 2", () => {
    expect(resolutionsPath("/feature", "spec_critique", 2)).toBe(
      "/feature/resolutions/spec_critique-round-2.json",
    );
  });
});

