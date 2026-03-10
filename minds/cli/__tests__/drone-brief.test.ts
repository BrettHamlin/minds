import { describe, expect, it } from "bun:test";
import { buildDroneBrief, buildBusPublishCmd } from "../lib/drone-brief.ts";
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

// ─── buildBusPublishCmd ──────────────────────────────────────────────────────

describe("buildBusPublishCmd", () => {
  it("builds a valid bus publish command", () => {
    const cmd = buildBusPublishCmd(
      "minds",
      "minds-BRE-123",
      "pipeline_core",
      "wave-1",
    );

    expect(cmd).toContain("bun minds/transport/minds-publish.ts");
    expect(cmd).toContain("--channel minds-BRE-123");
    expect(cmd).toContain("--type MIND_COMPLETE");
    expect(cmd).toContain('"mindName":"pipeline_core"');
    expect(cmd).toContain('"waveId":"wave-1"');
  });

  it("uses the correct mindsDir prefix", () => {
    const cmd = buildBusPublishCmd(
      "/home/user/.minds",
      "minds-BRE-456",
      "signals",
      "wave-2",
    );

    expect(cmd).toContain("bun /home/user/.minds/transport/minds-publish.ts");
  });
});

// ─── buildDroneBrief ────────────────────────────────────────────────────────

describe("buildDroneBrief", () => {
  const publishCmd = buildBusPublishCmd(
    "minds",
    "minds-BRE-123",
    "pipeline_core",
    "wave-1",
  );

  it("includes the mind name and ticket ID", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      busPublishCmd: publishCmd,
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
      busPublishCmd: publishCmd,
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("T001");
    expect(brief).toContain("T002");
    expect(brief).toContain("Add LoadedPipeline type");
    expect(brief).toContain("[P]");
  });

  it("includes the bus publish command for completion", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      busPublishCmd: publishCmd,
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("minds-publish.ts");
    expect(brief).toContain("MIND_COMPLETE");
    expect(brief).toContain("Completion Signal");
  });

  it("omits dependencies section when no deps", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-123",
      mindName: "pipeline_core",
      waveId: "wave-1",
      tasks: SAMPLE_TASKS,
      dependencies: [],
      busPublishCmd: publishCmd,
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
      busPublishCmd: publishCmd,
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
      busPublishCmd: publishCmd,
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
      busPublishCmd: publishCmd,
      featureDir: "specs/BRE-123-feature",
    });

    expect(brief).toContain("specs/BRE-123-feature");
  });
});
