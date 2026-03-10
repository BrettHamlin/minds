import { describe, it, expect } from "bun:test";
import { buildMindBrief, buildMindBusPublishCmds } from "./mind-brief.ts";
import type { MindBriefParams } from "./mind-brief.ts";
import type { MindTask } from "./implement-types.ts";

const TASKS: MindTask[] = [
  { id: "T1", mind: "signals", description: "Add emit method", parallel: false },
  { id: "T2", mind: "signals", description: "Write unit tests", parallel: true },
];

const BASE_PARAMS: MindBriefParams = {
  ticketId: "BRE-471",
  mindName: "signals",
  waveId: "wave-1",
  featureDir: "features/BRE-471",
  tasks: TASKS,
  dependencies: [],
  worktreePath: "/tmp/worktree-signals",
};

describe("buildMindBrief", () => {
  it("has YAML frontmatter with name, role, scope", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("---\nname: Work Order");
    expect(output).toContain("role: Ephemeral task assignment");
    expect(output).toContain("scope: Changes per run");
  });

  it("contains Work Order header with mind name", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("Work Order: @signals");
  });

  it("contains metadata table with ticket, wave, feature, worktree", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("| **Ticket** | BRE-471 |");
    expect(output).toContain("| **Wave** | wave-1 |");
    expect(output).toContain("| **Feature** | features/BRE-471 |");
    expect(output).toContain("| **Worktree** | /tmp/worktree-signals |");
  });

  it("does not contain domain context or memory sections (moved to CLAUDE.md)", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).not.toContain("## Domain Context");
    expect(output).not.toContain("## Memory");
    expect(output).not.toContain("MIND.md");
    expect(output).not.toContain("MEMORY.md");
  });

  it("does not contain review loop instructions (moved to CLAUDE.md)", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).not.toContain("## Review Loop");
    expect(output).not.toContain("subagent_type");
    expect(output).not.toContain("Maximum iterations");
  });

  it("does not contain memory update section (moved to CLAUDE.md)", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).not.toContain("## Memory Update");
  });

  it("does not contain bus commands section (moved to CLAUDE.md)", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).not.toContain("## Bus Commands");
    expect(output).not.toContain("MIND_STARTED");
    expect(output).not.toContain("MIND_COMPLETE");
  });

  it("contains drone tasks section with formatted task list", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("Drone Tasks");
    expect(output).toContain("- [ ] T1 Add emit method");
    expect(output).toContain("- [ ] T2 [P] Write unit tests");
  });

  it("includes dependencies section when dependencies are present", () => {
    const output = buildMindBrief({ ...BASE_PARAMS, dependencies: ["transport", "router"] });
    expect(output).toContain("Dependencies");
    expect(output).toContain("@transport");
    expect(output).toContain("@router");
  });

  it("omits dependencies section when no dependencies", () => {
    const output = buildMindBrief({ ...BASE_PARAMS, dependencies: [] });
    expect(output).not.toContain("Dependencies");
  });

  it("contains pointer back to CLAUDE.md operating manual", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("CLAUDE.md");
    expect(output).toContain("Review Loop");
  });

  it("contains completion criteria section", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("Completion Criteria");
    expect(output).toContain("all tests pass");
  });
});

describe("buildMindBusPublishCmds", () => {
  it("returns all 4 commands", () => {
    const cmds = buildMindBusPublishCmds(
      "/repo/minds",
      "minds-BRE-471",
      "signals",
      "wave-1",
    );
    expect(cmds.started).toBeDefined();
    expect(cmds.reviewStarted).toBeDefined();
    expect(cmds.reviewFeedback).toBeDefined();
    expect(cmds.complete).toBeDefined();
  });

  it("uses MIND_STARTED signal type", () => {
    const cmds = buildMindBusPublishCmds("/repo/minds", "ch", "signals", "wave-1");
    expect(cmds.started).toContain("--type MIND_STARTED");
  });

  it("uses REVIEW_STARTED signal type", () => {
    const cmds = buildMindBusPublishCmds("/repo/minds", "ch", "signals", "wave-1");
    expect(cmds.reviewStarted).toContain("--type REVIEW_STARTED");
  });

  it("uses REVIEW_FEEDBACK signal type", () => {
    const cmds = buildMindBusPublishCmds("/repo/minds", "ch", "signals", "wave-1");
    expect(cmds.reviewFeedback).toContain("--type REVIEW_FEEDBACK");
  });

  it("uses MIND_COMPLETE signal type", () => {
    const cmds = buildMindBusPublishCmds("/repo/minds", "ch", "signals", "wave-1");
    expect(cmds.complete).toContain("--type MIND_COMPLETE");
  });

  it("includes mindName and waveId in payload", () => {
    const cmds = buildMindBusPublishCmds("/repo/minds", "ch", "signals", "wave-2");
    const expectedPayload = JSON.stringify({ mindName: "signals", waveId: "wave-2" });
    expect(cmds.complete).toContain(expectedPayload);
    expect(cmds.started).toContain(expectedPayload);
  });

  it("uses the provided mindsDir in the command path", () => {
    const cmds = buildMindBusPublishCmds("/custom/minds", "ch", "signals", "wave-1");
    expect(cmds.complete).toContain("/custom/minds/transport/minds-publish.ts");
  });

  it("uses the provided channel", () => {
    const cmds = buildMindBusPublishCmds("/repo/minds", "minds-BRE-999", "signals", "wave-1");
    expect(cmds.complete).toContain("--channel minds-BRE-999");
  });
});
