import { describe, expect, it } from "bun:test";
import { buildDroneBrief } from "../lib/drone-brief.ts";
import type { MindTask } from "../lib/implement-types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_TASKS: MindTask[] = [
  {
    id: "T001",
    mind: "pipeline_core",
    description: "Add LoadedPipeline type to minds/pipeline_core/types.ts",
    parallel: false,
  },
  {
    id: "T002",
    mind: "pipeline_core",
    description: "Export resolveVariant()",
    parallel: true,
  },
];

const SAMPLE_TASKS_WITH_CONTRACTS: MindTask[] = [
  {
    id: "T004",
    mind: "execution",
    description: "Update phase-dispatch — consumes: LoadedPipeline from minds/pipeline_core/types.ts",
    parallel: false,
    consumes: { interface: "LoadedPipeline", path: "minds/pipeline_core/types.ts" },
  },
];

// ─── buildDroneBrief ────────────────────────────────────────────────────────

describe("buildDroneBrief", () => {
  it("includes the mind name and ticket ID", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("@pipeline_core");
    expect(brief).toContain("BRE-123");
    expect(brief).toContain("wave-1");
  });

  it("lists all task IDs and descriptions", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("T001");
    expect(brief).toContain("T002");
    expect(brief).toContain("Add LoadedPipeline type");
    expect(brief).toContain("[P]");
  });

  it("has no bus or signal references", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).not.toContain("minds-publish.ts");
    expect(brief).not.toContain("MIND_COMPLETE");
    expect(brief).not.toContain("Completion Signal");
  });

  it("omits dependencies section when no deps", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).not.toContain("Dependencies");
  });

  it("includes dependencies section with emoji when deps exist", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "execution",
      waveId: "wave-2",
      tasks: SAMPLE_TASKS_WITH_CONTRACTS,
      dependencies: ["pipeline_core", "signals"],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("🔗 Dependencies");
    expect(brief).toContain("@pipeline_core");
    expect(brief).toContain("@signals");
    expect(brief).toContain("completed and merged");
  });

  it("includes TDD instructions", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("TDD");
    expect(brief).toContain("bun test");
    expect(brief).toContain("pipeline_core/");
  });

  it("includes feature directory path", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("specs/BRE-123-feature");
  });

  it("has YAML frontmatter with name, role, scope", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("---\nname: Drone Brief");
    expect(brief).toContain("role: Implementation tasks for the 🛸 Drone");
    expect(brief).toContain("scope: Complete all tasks");
  });

  it("contains pointer back to agent definition", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain(".claude/agents/drone.md");
    expect(brief).toContain("compacted");
  });

  it("contains completion criteria", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("Completion Criteria");
    expect(brief).toContain("all tests pass");
  });

  it("uses absolute mindsDir for test command when provided", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
      mindsDir: "/home/user/repo/minds",
    });

    expect(brief).toContain("bun test /home/user/repo/minds/pipeline_core/");
    expect(brief).not.toContain("bun test minds/pipeline_core/");
  });

  it("falls back to relative path when mindsDir not provided", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("bun test minds/pipeline_core/");
  });

  it("uses emoji anchors on section headers", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: ["signals"],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("## 📋 Tasks");
    expect(brief).toContain("## ✅ Completion Criteria");
    expect(brief).toContain("## 🔗 Dependencies");
    expect(brief).toContain("## 🔧 Instructions");
  });
});
