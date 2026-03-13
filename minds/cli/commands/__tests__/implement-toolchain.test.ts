/**
 * implement-toolchain.test.ts -- Per-repo toolchain resolution tests (MR-024).
 *
 * Verifies that per-repo installCommand and testCommand from the workspace
 * manifest are correctly threaded through to drone briefs and workspace resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadWorkspace } from "../../../shared/workspace-loader.ts";
import { buildDroneBrief } from "../../lib/drone-brief.ts";
import { resolveRepoBaseBranch } from "../implement.ts";
import {
  createMultiRepoFixture,
  saveAndClearWorkspaceEnv,
  type MultiRepoFixture,
} from "./helpers/multi-repo-setup.ts";
import type { MindDescription } from "../../../mind.ts";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("per-repo toolchain resolution (MR-024)", () => {
  let fixture: MultiRepoFixture;
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveAndClearWorkspaceEnv();

    fixture = createMultiRepoFixture({
      backendMinds: [
        { name: "api", domain: "backend", keywords: ["api"], owns_files: ["src/**"], capabilities: [] },
      ],
      frontendMinds: [
        { name: "ui", domain: "frontend", keywords: ["ui"], owns_files: ["src/**"], capabilities: [] },
      ],
      repoOverrides: {
        backend: { testCommand: "npm test", installCommand: "npm install" },
        frontend: { testCommand: "bun test", installCommand: "bun install" },
      },
    });
  });

  afterEach(() => {
    fixture.cleanup();
    restoreEnv();
  });

  test("workspace manifest preserves per-repo toolchain commands", () => {
    const ws = loadWorkspace(fixture.frontendRoot);

    expect(ws.manifest).not.toBeNull();
    const backendRepo = ws.manifest!.repos.find((r) => r.alias === "backend");
    const frontendRepo = ws.manifest!.repos.find((r) => r.alias === "frontend");

    expect(backendRepo).toBeDefined();
    expect(backendRepo!.testCommand).toBe("npm test");
    expect(backendRepo!.installCommand).toBe("npm install");

    expect(frontendRepo).toBeDefined();
    expect(frontendRepo!.testCommand).toBe("bun test");
    expect(frontendRepo!.installCommand).toBe("bun install");
  });

  test("drone brief uses backend testCommand for backend mind", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-TC-100",
      mindName: "api",
      waveId: "wave-1",
      tasks: [{ id: "T001", mind: "api", description: "Create endpoint", parallel: false }],
      dependencies: [],
      featureDir: "/tmp/specs/BRE-TC-100",
      repo: "backend",
      testCommand: "npm test",
    });

    expect(brief).toContain("npm test");
    expect(brief).not.toContain("bun test");
    expect(brief).toContain("| **Repo** | backend |");
  });

  test("drone brief uses frontend testCommand for frontend mind", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-TC-100",
      mindName: "ui",
      waveId: "wave-1",
      tasks: [{ id: "T001", mind: "ui", description: "Build component", parallel: false }],
      dependencies: [],
      featureDir: "/tmp/specs/BRE-TC-100",
      repo: "frontend",
      testCommand: "bun test",
    });

    expect(brief).toContain("bun test");
    expect(brief).toContain("| **Repo** | frontend |");
  });

  test("drone brief uses default bun test when no testCommand provided", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-TC-100",
      mindName: "core",
      waveId: "wave-1",
      tasks: [{ id: "T001", mind: "core", description: "Do thing", parallel: false }],
      dependencies: [],
      featureDir: "/tmp/specs/BRE-TC-100",
    });

    // Default: bun test minds/<mindName>/
    expect(brief).toContain("bun test");
    expect(brief).toContain("minds/core/");
    expect(brief).not.toContain("| **Repo**");
  });

  test("toolchain can be resolved from manifest for each repo alias", () => {
    const ws = loadWorkspace(fixture.frontendRoot);

    // Simulates how implement.ts resolves toolchain per drone
    function resolveTestCommand(repoAlias: string): string | undefined {
      if (!ws.manifest) return undefined;
      const repo = ws.manifest.repos.find((r) => r.alias === repoAlias);
      return repo?.testCommand;
    }

    expect(resolveTestCommand("backend")).toBe("npm test");
    expect(resolveTestCommand("frontend")).toBe("bun test");
    expect(resolveTestCommand("nonexistent")).toBeUndefined();
  });
});

describe("per-repo defaultBranch override (MR-024)", () => {
  let fixture: MultiRepoFixture;
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveAndClearWorkspaceEnv();

    fixture = createMultiRepoFixture({
      backendMinds: [
        { name: "api", domain: "backend", keywords: ["api"], owns_files: ["src/**"], capabilities: [] },
      ],
      frontendMinds: [
        { name: "ui", domain: "frontend", keywords: ["ui"], owns_files: ["src/**"], capabilities: [] },
      ],
      repoOverrides: {
        backend: { defaultBranch: "develop" },
        // frontend has no defaultBranch override
      },
    });
  });

  afterEach(() => {
    fixture.cleanup();
    restoreEnv();
  });

  test("backend resolves to its custom defaultBranch", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    expect(resolveRepoBaseBranch("backend", ws, "main")).toBe("develop");
  });

  test("frontend falls back to global default when no per-repo override", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    expect(resolveRepoBaseBranch("frontend", ws, "main")).toBe("main");
  });

  test("__default__ always returns fallback regardless of manifest", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    expect(resolveRepoBaseBranch("__default__", ws, "main")).toBe("main");
  });
});
