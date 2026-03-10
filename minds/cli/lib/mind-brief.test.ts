import { describe, it, expect } from "bun:test";
import { buildMindBrief, buildMindBusPublishCmds } from "./mind-brief.ts";
import type { MindBriefParams, MindBusPublishCmds } from "./mind-brief.ts";
import type { MindTask } from "./implement-types.ts";

const TASKS: MindTask[] = [
  { id: "T1", mind: "signals", description: "Add emit method", parallel: false },
  { id: "T2", mind: "signals", description: "Write unit tests", parallel: true },
];

const BUS_CMDS: MindBusPublishCmds = {
  started: "bun minds/transport/minds-publish.ts --channel ch --type MIND_STARTED --payload '{}'",
  reviewStarted: "bun minds/transport/minds-publish.ts --channel ch --type REVIEW_STARTED --payload '{}'",
  reviewFeedback: "bun minds/transport/minds-publish.ts --channel ch --type REVIEW_FEEDBACK --payload '{}'",
  complete: "bun minds/transport/minds-publish.ts --channel ch --type MIND_COMPLETE --payload '{}'",
};

const BASE_PARAMS: MindBriefParams = {
  ticketId: "BRE-471",
  mindName: "signals",
  waveId: "wave-1",
  featureDir: "features/BRE-471",
  tasks: TASKS,
  dependencies: [],
  mindMdPath: "/repo/minds/signals/MIND.md",
  memoryMdPath: "/repo/minds/signals/MEMORY.md",
  maxReviewIterations: 3,
  worktreePath: "/tmp/worktree-signals",
  busPublishCmds: BUS_CMDS,
};

describe("buildMindBrief", () => {
  it("contains the header with ticket, wave, and mind name", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("# Mind Brief: @signals");
    expect(output).toContain("Ticket: BRE-471");
    expect(output).toContain("Wave: wave-1");
  });

  it("contains domain context section referencing mindMdPath", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("## Domain Context");
    expect(output).toContain("Read your MIND.md at: /repo/minds/signals/MIND.md");
  });

  it("contains memory section referencing memoryMdPath", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("## Memory");
    expect(output).toContain("Read your MEMORY.md at: /repo/minds/signals/MEMORY.md");
  });

  it("contains drone tasks section with formatted task list", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("## Drone Tasks");
    expect(output).toContain("- [ ] T1 Add emit method");
    expect(output).toContain("- [ ] T2 [P] Write unit tests");
  });

  it("contains review loop instructions referencing subagent_type: 'drone'", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("## Review Loop Instructions");
    expect(output).toContain("subagent_type: 'drone'");
  });

  it("contains maxReviewIterations in review loop instructions", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("Maximum iterations: 3");

    const customOutput = buildMindBrief({ ...BASE_PARAMS, maxReviewIterations: 5 });
    expect(customOutput).toContain("Maximum iterations: 5");
  });

  it("uses default maxReviewIterations of 3 when not specified", () => {
    const params = { ...BASE_PARAMS };
    delete (params as any).maxReviewIterations;
    const output = buildMindBrief(params);
    expect(output).toContain("Maximum iterations: 3");
  });

  it("contains bus commands section with all 4 commands", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("## Bus Commands");
    expect(output).toContain(BUS_CMDS.started);
    expect(output).toContain(BUS_CMDS.reviewStarted);
    expect(output).toContain(BUS_CMDS.reviewFeedback);
    expect(output).toContain(BUS_CMDS.complete);
  });

  it("contains memory update section", () => {
    const output = buildMindBrief(BASE_PARAMS);
    expect(output).toContain("## Memory Update");
    expect(output).toContain("/repo/minds/signals/MEMORY.md");
  });

  it("includes dependencies section when dependencies are present", () => {
    const output = buildMindBrief({ ...BASE_PARAMS, dependencies: ["transport", "router"] });
    expect(output).toContain("## Dependencies");
    expect(output).toContain("@transport");
    expect(output).toContain("@router");
  });

  it("omits dependencies section when no dependencies", () => {
    const output = buildMindBrief({ ...BASE_PARAMS, dependencies: [] });
    expect(output).not.toContain("## Dependencies");
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
