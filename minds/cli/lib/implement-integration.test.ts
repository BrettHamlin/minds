/**
 * implement-integration.test.ts — Integration tests for the Mind-supervised review loop (BRE-477).
 *
 * Validates the contract between: mind-brief, drone-brief, CLAUDE.md (assembleClaudeContent),
 * MindsEventType, MindsStateTracker, and the drone agent definition.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { buildMindBrief } from "./mind-brief.ts";
import { buildDroneBrief } from "./drone-brief.ts";
import type { MindBriefParams } from "./mind-brief.ts";
import type { MindBusPublishCmds } from "./mind-brief.ts";
import type { MindTask } from "./implement-types.ts";
import { MindsEventType } from "../../transport/minds-events.ts";
import { MindsStateTracker } from "../../dashboard/state-tracker.ts";
import { assembleClaudeContent } from "../../lib/mind-pane.ts";

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
  ticketId:       "BRE-477",
  mindName:       "signals",
  waveId:         "wave-1",
  featureDir:     "features/BRE-477",
  tasks:          TASKS,
  dependencies:   [],
  worktreePath:   "/tmp/worktree-signals",
};

// ---------------------------------------------------------------------------
// 1. CLAUDE.md (assembleClaudeContent) — structure, inline bus, memory
// ---------------------------------------------------------------------------

describe("CLAUDE.md (assembleClaudeContent) completeness", () => {
  const fakeRepoRoot = "/tmp/fake-repo-for-integration-tests";

  it("contains 🧠 Mind identity with emojis", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("🧠 @signals Mind (supervisor)");
  });

  it("has YAML frontmatter", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("---\nname: Mind Operating Manual");
  });

  it("front-loads file boundary as first heading", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    const firstHeading = content.match(/^# .+/m)?.[0];
    expect(firstHeading).toContain("File Boundary");
  });

  it("empty file boundary explains unrestricted access", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("unrestricted file access");
  });

  it("contains voice table with 🧠 and 🛸 roles", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("| Role | Emoji | Example |");
    expect(content).toContain("🧠");
    expect(content).toContain("🛸");
  });

  it("suppresses contracts section when none defined", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).not.toContain("# 📋 Contracts");
    expect(content).not.toContain("Honor these exactly");
  });

  it("contains Review Loop with ━━━ step separators", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("# 🔁 Review Loop");
    expect(content).toContain("━━━ 1. READ ━━━");
    expect(content).toContain("━━━ 3. SPAWN ━━━");
    expect(content).toContain("━━━ 7. VERDICT ━━━");
  });

  it("inlines bus commands when provided", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477", BUS_CMDS);
    expect(content).toContain("--type MIND_STARTED");
    expect(content).toContain("--type REVIEW_STARTED");
    expect(content).toContain("--type REVIEW_FEEDBACK");
    expect(content).toContain("--type MIND_COMPLETE");
  });

  it("inlines memory flush at approval step with sub-step labels", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    const verdictSection = content.split("━━━ 7. VERDICT ━━━")[1] ?? "";
    expect(verdictSection).toContain("write-cli.ts --mind signals");
    expect(verdictSection).toContain("a. Flush memory");
    expect(verdictSection).toContain("b. Signal completion");
  });

  it("max iterations is 10 with explicit action defined", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("max 10 iterations");
    expect(content).toContain("Max iterations (10) reached");
    expect(content).toContain("Approve with warnings");
  });

  it("git diff uses resolved base branch, not placeholder", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("git diff main...HEAD");
    expect(content).not.toContain("{base}");
  });

  it("contains Memory section with search-cli, write-cli, and do/don't table", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("# 💾 Memory");
    expect(content).toContain("search-cli.ts --mind signals");
    expect(content).toContain("write-cli.ts --mind signals");
    expect(content).toContain("| ✅ Write | ❌ Don't Write |");
  });

  it("memory write-cli annotated as same command from step 7a", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    const memorySection = content.split("# 💾 Memory")[1] ?? "";
    expect(memorySection).toContain("same command as Review Loop step 7a");
  });

  it("states drone does not have memory access (singular)", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    expect(content).toContain("🛸 Drone does NOT have memory access");
  });

  it("uses absolute paths for all commands", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-477");
    // All CLI paths should be absolute.
    // fakeRepoRoot has no minds/cli/ → resolves to .minds/ (installed-repo convention)
    expect(content).toContain(`${fakeRepoRoot}/.minds/memory/lib/search-cli.ts`);
    expect(content).toContain(`${fakeRepoRoot}/.minds/memory/lib/write-cli.ts`);
    expect(content).toContain(`${fakeRepoRoot}/.minds/signals/`);
  });
});

// ---------------------------------------------------------------------------
// 2. Mind brief — lean work order only (no bus commands, no identity/standards)
// ---------------------------------------------------------------------------

describe("Mind brief is lean work order", () => {
  it("has YAML frontmatter", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("---\nname: Work Order");
  });

  it("contains pointer back to CLAUDE.md operating manual", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("CLAUDE.md");
    expect(brief).toContain("Review Loop");
  });

  it("contains Work Order header with metadata table", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("Work Order: @signals");
    expect(brief).toContain("| **Ticket** | BRE-477 |");
    expect(brief).toContain("| **Wave** | wave-1 |");
  });

  it("contains Drone Tasks with formatted tasks", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("Drone Tasks");
    expect(brief).toContain("- [ ] T1 Add emit method");
    expect(brief).toContain("- [ ] T2 [P] Write unit tests");
  });

  it("contains completion criteria", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).toContain("Completion Criteria");
    expect(brief).toContain("all tests pass");
  });

  it("does NOT contain Bus Commands (moved to CLAUDE.md)", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).not.toContain("## Bus Commands");
    expect(brief).not.toContain("MIND_STARTED");
    expect(brief).not.toContain("MIND_COMPLETE");
  });

  it("does NOT contain review loop instructions (in CLAUDE.md)", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).not.toContain("## Review Loop");
    expect(brief).not.toContain("subagent_type");
    expect(brief).not.toContain("Maximum iterations");
  });

  it("does NOT contain Domain Context section (in CLAUDE.md)", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).not.toContain("## Domain Context");
    expect(brief).not.toContain("MIND.md");
  });

  it("does NOT contain Memory section (in CLAUDE.md)", () => {
    const brief = buildMindBrief(BASE_MIND_PARAMS);
    expect(brief).not.toContain("## Memory Update");
    expect(brief).not.toContain("MEMORY.md");
  });
});

// ---------------------------------------------------------------------------
// 3. Drone brief purity — zero bus/signal references
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
// 4. Bus listener MIND_COMPLETE filter — enum contract
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
// 5. State tracker lifecycle
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
// 6. Custom agent validation — drone.md
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
    const toolsSectionMatch = droneContent.match(/tools:\s*([\s\S]*?)(?:\n---|\n##|$)/);
    const toolsSection = toolsSectionMatch ? toolsSectionMatch[1] : "";
    expect(toolsSection).not.toContain("Agent");
  });

  it("contains instructions about DRONE-BRIEF.md", () => {
    expect(droneContent).toContain("DRONE-BRIEF.md");
  });
});
