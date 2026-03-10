import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { publishMindSpawned, assembleClaudeContent } from "./mind-pane.ts";
import { MindsEventType } from "../transport/minds-events.ts";

// ---------------------------------------------------------------------------
// mind-pane.ts — assembleClaudeContent tests
// ---------------------------------------------------------------------------

describe("mind-pane: assembleClaudeContent()", () => {
  // Use a temp dir that won't have minds.json / STANDARDS.md / MIND.md
  const fakeRepoRoot = "/tmp/fake-repo-for-mind-pane-tests";

  test("1. identity line says Mind (supervisor), not drone", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("You are the @signals Mind (supervisor)");
    // Identity line must not say "drone" — check the specific line
    const identityLine = content.split("\n").find((l) => l.startsWith("You are the @signals"));
    expect(identityLine).not.toContain("drone");
  });

  test("2. review loop instructions section is present", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("## Review Loop Instructions");
    expect(content).toContain("subagent_type: 'drone'");
    expect(content).toContain("git diff {base}...HEAD");
    expect(content).toContain("Agent({ resume: '{agentId}'");
  });

  test("3. max iterations is reflected in instructions", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500", 5);
    expect(content).toContain("**Max iterations:** 5");
    expect(content).toContain("After 5 review cycles");
  });

  test("4. default max iterations is 3", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("**Max iterations:** 3");
  });

  test("5. Active Task section references MIND-BRIEF.md as task source", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    // Active Task section must point to MIND-BRIEF.md
    expect(content).toContain("MIND-BRIEF.md at the worktree root");
    // The identity/active-task sections must not reference DRONE-BRIEF.md
    const activeTaskSection = content.split("## Active Task")[1] ?? "";
    expect(activeTaskSection).not.toContain("DRONE-BRIEF.md");
  });

  test("6. includes ticket ID in identity line", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "transport", "BRE-999");
    expect(content).toContain("BRE-999");
  });

  test("7. bus events reference MIND-BRIEF.md for publish commands", () => {
    const content = assembleClaudeContent(fakeRepoRoot, "signals", "BRE-500");
    expect(content).toContain("MIND-BRIEF.md");
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

  test("8. publishes DRONE_SPAWNED event type", async () => {
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

  test("9. payload includes all required fields", async () => {
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

  test("10. publishes to the correct channel", async () => {
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
