import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { publishMindSpawned, assembleClaudeContent } from "./mind-pane.ts";
import { MindsEventType } from "../transport/minds-events.ts";
import type { MindBusPublishCmds } from "../cli/lib/mind-brief.ts";

// ---------------------------------------------------------------------------
// mind-pane.ts — assembleClaudeContent tests
// ---------------------------------------------------------------------------

const BUS_CMDS: MindBusPublishCmds = {
  started: "bun /repo/minds/transport/minds-publish.ts --channel minds-BRE-500 --type MIND_STARTED --payload '{\"mindName\":\"signals\",\"waveId\":\"wave-1\"}'",
  reviewStarted: "bun /repo/minds/transport/minds-publish.ts --channel minds-BRE-500 --type REVIEW_STARTED --payload '{\"mindName\":\"signals\",\"waveId\":\"wave-1\"}'",
  reviewFeedback: "bun /repo/minds/transport/minds-publish.ts --channel minds-BRE-500 --type REVIEW_FEEDBACK --payload '{\"mindName\":\"signals\",\"waveId\":\"wave-1\"}'",
  complete: "bun /repo/minds/transport/minds-publish.ts --channel minds-BRE-500 --type MIND_COMPLETE --payload '{\"mindName\":\"signals\",\"waveId\":\"wave-1\"}'",
};

describe("mind-pane: assembleClaudeContent()", () => {
  // Use a temp dir that won't have minds.json / STANDARDS.md / MIND.md
  const fakeRepoRoot = "/tmp/fake-repo-for-mind-pane-tests";

  test("1. has YAML frontmatter with name, role, scope", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("---\nname: Mind Operating Manual");
    expect(content).toContain("role: Static identity");
    expect(content).toContain("scope: Same across all tasks");
  });

  test("1b. file boundary is the first heading (front-loaded constraint)", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    const firstHeading = content.match(/^# .+/m)?.[0];
    expect(firstHeading).toContain("File Boundary");
  });

  test("1c. empty file boundary says unrestricted, not '(none defined)'", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("unrestricted file access");
    expect(content).not.toContain("(no file boundaries defined)");
  });

  test("2. identity line says 🧠 Mind (supervisor), not drone", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("You are the 🧠 @signals Mind (supervisor)");
    const identityLine = content.split("\n").find((l) => l.includes("You are the"));
    expect(identityLine).not.toContain("drone");
  });

  test("3. voice section uses table format with emoji roles", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("| Role | Emoji | Example |");
    expect(content).toContain("🧠");
    expect(content).toContain("🛸");
  });

  test("4. review loop uses ━━━ step separators", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("# 🔁 Review Loop");
    expect(content).toContain("━━━ 1. READ ━━━");
    expect(content).toContain("━━━ 2. SIGNAL ━━━");
    expect(content).toContain("━━━ 3. SPAWN ━━━");
    expect(content).toContain("━━━ 7. VERDICT ━━━");
  });

  test("5. review loop contains drone spawn command inline", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("subagent_type: '🛸'");
    expect(content).toContain("Agent({ resume: '{agentId}'");
  });

  test("6. bus commands are inline when provided", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500", BUS_CMDS);
    expect(content).toContain("--type MIND_STARTED");
    expect(content).toContain("--type REVIEW_STARTED");
    expect(content).toContain("--type REVIEW_FEEDBACK");
    expect(content).toContain("--type MIND_COMPLETE");
  });

  test("7. bus commands show placeholder when not provided", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("(bus not configured)");
    expect(content).not.toContain("--type MIND_STARTED");
  });

  test("8. memory flush command is inline at approval step with sub-step label", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    const verdictSection = content.split("━━━ 7. VERDICT ━━━")[1] ?? "";
    expect(verdictSection).toContain("write-cli.ts --mind signals");
    // #5: Sub-step labels
    expect(verdictSection).toContain("a. Flush memory");
    expect(verdictSection).toContain("b. Signal completion");
  });

  test("9. max iterations is 10 with explicit action", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("max 10 iterations");
    // #6: Explicit action at max iterations
    expect(content).toContain("Max iterations (10) reached");
    expect(content).toContain("Approve with warnings");
  });

  test("10. review step verifies task completion then references checklist", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("Verify all tasks from MIND-BRIEF.md are implemented");
    expect(content).toContain("Review Checklist");
    expect(content).toContain("Engineering Standards");
  });

  test("10b. paths use absolute mindsDir (resolves minds/ vs .minds/)", () => {
    // With fake repo root (no .minds/ dir), resolves to absolute /tmp/.../minds
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    // All paths should be absolute (start with /)
    expect(content).toContain(`bun ${fakeRepoRoot}/minds/memory/lib/search-cli.ts`);
    expect(content).toContain(`bun ${fakeRepoRoot}/minds/memory/lib/write-cli.ts`);
    expect(content).toContain(`bun test ${fakeRepoRoot}/minds/signals/`);
  });

  test("10c. git diff uses resolved base branch, not {base} placeholder", () => {
    // Default base branch
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("git diff main...HEAD");
    expect(content).not.toContain("{base}");

    // Explicit base branch
    const content2 = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500", undefined, "dev");
    expect(content2).toContain("git diff dev...HEAD");
  });

  test("11. memory section uses do/don't table", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("# 💾 Memory");
    expect(content).toContain("| ✅ Write | ❌ Don't Write |");
    expect(content).toContain("search-cli.ts --mind signals");
    expect(content).toContain("🛸 Drone does NOT have memory access");
  });

  test("11b. memory write-cli annotated as same command from Review Loop step 7a", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    const memorySection = content.split("# 💾 Memory")[1] ?? "";
    expect(memorySection).toContain("same command as Review Loop step 7a");
  });

  test("12. active task references MIND-BRIEF.md", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("MIND-BRIEF.md");
    const activeTaskSection = content.split("# 📎 Active Task")[1] ?? "";
    expect(activeTaskSection).not.toContain("DRONE-BRIEF.md");
  });

  test("13. uses singular 'Drone' not 'Drones'", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("a 🛸 Drone");
    const lines = content.split("\n");
    const dronesPluralLines = lines.filter(
      (l) => l.includes("Drones") && !l.includes("does NOT have memory"),
    );
    expect(dronesPluralLines).toHaveLength(0);
  });

  test("14. includes ticket ID in identity line", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "transport", "BRE-999");
    expect(content).toContain("BRE-999");
  });

  test("15. contracts section suppressed when no contracts defined", () => {
    // With fake repo root (no minds.json), contracts are empty
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).not.toContain("# 📋 Contracts");
    expect(content).not.toContain("Honor these exactly");
  });
});

// ---------------------------------------------------------------------------
// mind-pane.ts — publishMindSpawned tests
// ---------------------------------------------------------------------------

describe("mind-pane: publishMindSpawned()", () => {
  let publishedCalls: Array<{ url: string; body: { channel: string; type: string; payload: unknown } }> = [];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    publishedCalls = [];
    originalFetch = global.fetch;
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}");
      publishedCalls.push({ url: url as string, body });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("16. publishes DRONE_SPAWNED event type", async () => {
    await publishMindSpawned({
      busUrl: "http://localhost:7777",
      channel: "minds-BRE-500",
      waveId: "wave-1234",
      mindName: "signals",
      paneId: "%42",
      worktree: "/tmp/gravitas-BRE-500-signals-supervisor",
      branch: "minds/BRE-500-signals-supervisor",
    });

    expect(publishedCalls).toHaveLength(1);
    expect(publishedCalls[0].body.type).toBe(MindsEventType.DRONE_SPAWNED);
  });

  test("17. payload includes all required fields", async () => {
    await publishMindSpawned({
      busUrl: "http://localhost:7777",
      channel: "minds-BRE-500",
      waveId: "wave-5678",
      mindName: "transport",
      paneId: "%99",
      worktree: "/tmp/gravitas-BRE-500-transport-supervisor",
      branch: "minds/BRE-500-transport-supervisor",
    });

    const payload = publishedCalls[0].body.payload as Record<string, string>;
    expect(payload.mindName).toBe("transport");
    expect(payload.waveId).toBe("wave-5678");
    expect(payload.paneId).toBe("%99");
    expect(payload.worktree).toBe("/tmp/gravitas-BRE-500-transport-supervisor");
    expect(payload.branch).toBe("minds/BRE-500-transport-supervisor");
  });

  test("18. publishes to the correct channel", async () => {
    await publishMindSpawned({
      busUrl: "http://localhost:7777",
      channel: "minds-BRE-500",
      waveId: "wave-1234",
      mindName: "signals",
      paneId: "%42",
      worktree: "/tmp/worktree",
      branch: "minds/BRE-500-signals-supervisor",
    });

    expect(publishedCalls[0].body.channel).toBe("minds-BRE-500");
  });
});
