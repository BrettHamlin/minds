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
    expect(brief).not.toContain("bus");
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

    expect(brief).not.toContain("## Dependencies");
  });

  it("includes dependencies section when deps exist", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "execution",
      waveId: "wave-2",
      tasks: SAMPLE_TASKS_WITH_CONTRACTS,
      dependencies: ["pipeline_core", "signals"],
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("## Dependencies");
    expect(brief).toContain("@pipeline_core");
    expect(brief).toContain("@signals");
    expect(brief).toContain("already been completed");
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
    expect(brief).toContain("bun test minds/pipeline_core/");
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
});
