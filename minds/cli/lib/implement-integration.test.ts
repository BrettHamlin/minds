/**
 * implement-integration.test.ts — Integration tests for the Mind-supervised review loop (BRE-477).
 *
 * Validates the contract between: mind-brief, drone-brief, MindsEventType, MindsStateTracker,
 * and the drone agent definition — without requiring a running bus server.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { buildMindBrief, buildMindBusPublishCmds } from "./mind-brief.ts";
import { buildDroneBrief } from "./drone-brief.ts";
import type { MindBriefParams, MindBusPublishCmds } from "./mind-brief.ts";
import type { MindTask } from "./implement-types.ts";
import { MindsEventType } from "../../transport/minds-events.ts";
import { MindsStateTracker } from "../../dashboard/state-tracker.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TASKS: MindTask[] = [
  { id: "T1", mind: "signals", description: "Add emit method", parallel: false },
  { id: "T2", mind: "signals", description: "Write unit tests", parallel: true },
];

const BUS_CMDS: MindBusPublishCmds = {
  started:        "bun minds/transport/minds-publish.ts --channel ch --type MIND_STARTED --payload '{}'",
  reviewStarted:  "bun minds/transport/minds-publish.ts --channel ch --type REVIEW_STARTED --payload '{}'",
  reviewFeedback: "bun minds/transport/minds-publish.ts --channel ch --type REVIEW_FEEDBACK --payload '{}'",
  complete:       "bun minds/transport/minds-publish.ts --channel ch --type MIND_COMPLETE --payload '{}'",
};

const BASE_MIND_PARAMS: MindBriefParams = {
  ticketId:            "BRE-477",
  mindName:            "signals",
  waveId:              "wave-1",
  featureDir:          "features/BRE-477",
  tasks:               TASKS,
  dependencies:        [],
  mindMdPath:          "/repo/minds/signals/MIND.md",
  memoryMdPath:        "/repo/minds/signals/MEMORY.md",
  maxReviewIterations: 3,
  worktreePath:        "/tmp/worktree-signals",
  busPublishCmds:      BUS_CMDS,
};

// ---------------------------------------------------------------------------
// 1. Mind brief completeness
// ---------------------------------------------------------------------------

describe("Mind brief completeness", () => {
  it("contains Domain Context section with MIND.md path", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("## Domain Context");
    expect(brief).toContain("/repo/minds/signals/MIND.md");
  });

  it("contains Memory section with MEMORY.md path", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("## Memory");
    expect(brief).toContain("/repo/minds/signals/MEMORY.md");
  });

  it("contains Drone Tasks section with formatted tasks", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("## Drone Tasks");
    expect(brief).toContain("- [ ] T1 Add emit method");
    expect(brief).toContain("- [ ] T2 [P] Write unit tests");
  });

  it("contains Review Loop Instructions referencing subagent_type, drone, and resume", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("## Review Loop Instructions");
    expect(brief).toContain("subagent_type: 'drone'");
    expect(brief).toContain("drone");
    expect(brief).toContain("resume");
  });

  it("contains Bus Commands section with MIND_STARTED, REVIEW_STARTED, REVIEW_FEEDBACK, MIND_COMPLETE", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("## Bus Commands");
    expect(brief).toContain("MIND_STARTED");
    expect(brief).toContain("REVIEW_STARTED");
    expect(brief).toContain("REVIEW_FEEDBACK");
    expect(brief).toContain("MIND_COMPLETE");
  });

  it("contains Memory Update section", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("## Memory Update");
  });

  it("contains the configured max review iterations value", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("Maximum iterations: 3");
  });

  it("respects custom maxReviewIterations", () => {
    const brief = buildMindBrief({ ...BASE_MIND_PARAMS, maxReviewIterations: 5 });
    expect(brief).toContain("Maximum iterations: 5");
  });
});

// ---------------------------------------------------------------------------
// 2. Drone brief purity — zero bus/signal references
// ---------------------------------------------------------------------------

describe("Drone brief purity", () => {
  const droneBrief = buildDroneBrief({
    ticketId:     "BRE-477",
    mindName:     "signals",
    waveId:       "wave-1",
    tasks:        TASKS,
    dependencies: [],
    featureDir:   "features/BRE-477",
  });

  it("does not contain DRONE_COMPLETE", () => {
    expect(droneBrief).not.toContain("DRONE_COMPLETE");
  });

  it("does not contain MIND_COMPLETE", () => {
    expect(droneBrief).not.toContain("MIND_COMPLETE");
  });

  it("does not contain 'bus' (case-insensitive)", () => {
    expect(droneBrief.toLowerCase()).not.toContain("bus");
  });

  it("does not contain 'publish' (case-insensitive)", () => {
    expect(droneBrief.toLowerCase()).not.toContain("publish");
  });

  it("does not contain 'Completion Signal'", () => {
    expect(droneBrief).not.toContain("Completion Signal");
  });
});

// ---------------------------------------------------------------------------
// 3. Bus listener MIND_COMPLETE filter — enum contract
// ---------------------------------------------------------------------------

describe("MindsEventType enum — MIND_COMPLETE filter contract", () => {
  it("MIND_COMPLETE exists in MindsEventType", () => {
    expect(MindsEventType.MIND_COMPLETE).toBeDefined();
    expect(MindsEventType.MIND_COMPLETE).toBe("MIND_COMPLETE");
  });

  it("DRONE_COMPLETE does NOT exist in MindsEventType", () => {
    expect((MindsEventType as Record<string, unknown>)["DRONE_COMPLETE"]).toBeUndefined();
  });

  it("review loop signals all exist in MindsEventType", () => {
    expect(MindsEventType.MIND_STARTED).toBe("MIND_STARTED");
    expect(MindsEventType.REVIEW_STARTED).toBe("REVIEW_STARTED");
    expect(MindsEventType.REVIEW_FEEDBACK).toBe("REVIEW_FEEDBACK");
  });
});

// ---------------------------------------------------------------------------
// 4. State tracker lifecycle
// ---------------------------------------------------------------------------

describe("MindsStateTracker lifecycle", () => {
  it("tracks the full MIND_STARTED → REVIEW_STARTED → REVIEW_FEEDBACK → MIND_COMPLETE lifecycle", () => {
    const tracker = new MindsStateTracker(); // no DB
    const ticketId = "BRE-477";
    const mindName = "signals";
    const waveId = "wave-1";

    // Seed a wave + drone via DRONE_SPAWNED so findDrone() has a record
    tracker.applyEvent({
      channel: `minds-${ticketId}`,
      from: "@orchestrator",
      type: MindsEventType.WAVE_STARTED,
      payload: { waveId },
      ticketId,
      mindName: "",
    });

    tracker.applyEvent({
      channel: `minds-${ticketId}`,
      from: "@orchestrator",
      type: MindsEventType.DRONE_SPAWNED,
      payload: { waveId, mindName },
      ticketId,
      mindName,
    });

    // MIND_STARTED → active
    tracker.applyEvent({
      channel: `minds-${ticketId}`,
      from: `@${mindName}`,
      type: MindsEventType.MIND_STARTED,
      payload: { mindName },
      ticketId,
      mindName,
    });

    const stateAfterStarted = tracker.getState(ticketId)!;
    const droneAfterStarted = stateAfterStarted.waves[0].drones.find((d) => d.mindName === mindName)!;
    expect(droneAfterStarted.status).toBe("active");

    // REVIEW_STARTED → reviewing
    tracker.applyEvent({
      channel: `minds-${ticketId}`,
      from: `@${mindName}`,
      type: MindsEventType.REVIEW_STARTED,
      payload: { mindName },
      ticketId,
      mindName,
    });

    const stateAfterReview = tracker.getState(ticketId)!;
    const droneAfterReview = stateAfterReview.waves[0].drones.find((d) => d.mindName === mindName)!;
    expect(droneAfterReview.status).toBe("reviewing");

    // REVIEW_FEEDBACK → active, reviewAttempts incremented
    tracker.applyEvent({
      channel: `minds-${ticketId}`,
      from: `@${mindName}`,
      type: MindsEventType.REVIEW_FEEDBACK,
      payload: { mindName },
      ticketId,
      mindName,
    });

    const stateAfterFeedback = tracker.getState(ticketId)!;
    const droneAfterFeedback = stateAfterFeedback.waves[0].drones.find((d) => d.mindName === mindName)!;
    expect(droneAfterFeedback.status).toBe("active");
    expect(droneAfterFeedback.reviewAttempts).toBe(1);

    // MIND_COMPLETE → complete
    tracker.applyEvent({
      channel: `minds-${ticketId}`,
      from: `@${mindName}`,
      type: MindsEventType.MIND_COMPLETE,
      payload: { waveId, mindName },
      ticketId,
      mindName,
    });

    const stateFinal = tracker.getState(ticketId)!;
    const droneFinal = stateFinal.waves[0].drones.find((d) => d.mindName === mindName)!;
    expect(droneFinal.status).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// 5. Custom agent validation — drone.md
// ---------------------------------------------------------------------------

describe("drone.md agent definition", () => {
  const droneMdPath = join(process.cwd(), ".claude", "agents", "drone.md");
  const droneContent = readFileSync(droneMdPath, "utf8");

  it("specifies model: sonnet", () => {
    expect(droneContent).toContain("model: sonnet");
  });

  it("includes required tools: Read, Edit, Write, Grep, Glob, Bash", () => {
    expect(droneContent).toContain("tools:");
    expect(droneContent).toContain("Read");
    expect(droneContent).toContain("Edit");
    expect(droneContent).toContain("Write");
    expect(droneContent).toContain("Grep");
    expect(droneContent).toContain("Glob");
    expect(droneContent).toContain("Bash");
  });

  it("does NOT include Agent in the tools list", () => {
    // Extract the tools section only (between "tools:" and the next "---" or "##")
    const toolsSectionMatch = droneContent.match(/tools:\s*([\s\S]*?)(?:\n---|\n##|$)/);
    const toolsSection = toolsSectionMatch ? toolsSectionMatch[1] : "";
    expect(toolsSection).not.toContain("Agent");
  });

  it("contains instructions about DRONE-BRIEF.md", () => {
    expect(droneContent).toContain("DRONE-BRIEF.md");
  });
});
