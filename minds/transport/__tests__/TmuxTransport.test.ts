// Tests for TmuxTransport behavior that doesn't require a live tmux session (BRE-347)

import { describe, test, expect } from "bun:test";
import { TmuxTransport } from "../TmuxTransport.ts";

// ── agentPrompt ───────────────────────────────────────────────────────────────

describe("TmuxTransport.agentPrompt", () => {
  test("contains [SIGNAL] protocol keyword", () => {
    const t = new TmuxTransport();
    expect(t.agentPrompt("agent-1", "%42")).toContain("[SIGNAL]");
  });

  test("contains the literal word SIGNAL_NAME", () => {
    const t = new TmuxTransport();
    expect(t.agentPrompt("agent-1", "%42")).toContain("SIGNAL_NAME");
  });

  test("contains the pane ID (channel)", () => {
    const t = new TmuxTransport();
    expect(t.agentPrompt("agent-1", "%42")).toContain("%42");
  });

  test("contains the agent ID", () => {
    const t = new TmuxTransport();
    expect(t.agentPrompt("my-agent", "%10")).toContain("my-agent");
  });

  test("includes a concrete example signal", () => {
    const t = new TmuxTransport();
    // Should demonstrate the format with a real signal name so agents know
    // exactly what to emit
    const prompt = t.agentPrompt("agent-1", "%42");
    expect(prompt).toContain("[SIGNAL] IMPLEMENT_COMPLETE");
  });

  test("includes session and window when constructor receives them", () => {
    const t = new TmuxTransport("my-session", "main-window");
    const prompt = t.agentPrompt("agent-2", "%99");
    expect(prompt).toContain("my-session");
    expect(prompt).toContain("main-window");
  });

  test("omits Session: line when no session provided (default)", () => {
    const t = new TmuxTransport();
    const prompt = t.agentPrompt("agent-3", "%10");
    // Empty session → conditional block not included
    expect(prompt).not.toContain("Session:");
  });

  test("different pane IDs produce different prompts", () => {
    const t = new TmuxTransport();
    const p1 = t.agentPrompt("a", "%1");
    const p2 = t.agentPrompt("a", "%2");
    expect(p1).not.toBe(p2);
    expect(p1).toContain("%1");
    expect(p2).toContain("%2");
  });
});

// ── teardown ─────────────────────────────────────────────────────────────────

describe("TmuxTransport.teardown", () => {
  test("resolves without error when no subscriptions are active", async () => {
    const t = new TmuxTransport();
    await expect(t.teardown()).resolves.toBeUndefined();
  });

  test("is idempotent — second teardown also resolves cleanly", async () => {
    const t = new TmuxTransport();
    await t.teardown();
    await expect(t.teardown()).resolves.toBeUndefined();
  });
});
