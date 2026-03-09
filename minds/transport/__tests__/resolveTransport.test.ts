// Tests for resolveTransport() priority cascade and BusTransport.agentPrompt (BRE-347)

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveTransport } from "../index.ts";
import { TmuxTransport } from "../TmuxTransport.ts";
import { BusTransport } from "../BusTransport.ts";

// ── Env var isolation ─────────────────────────────────────────────────────────

let savedTransport: string | undefined;
let savedBusUrl: string | undefined;

beforeEach(() => {
  savedTransport = process.env["COLLAB_TRANSPORT"];
  savedBusUrl = process.env["MINDS_BUS_URL"];
  delete process.env["COLLAB_TRANSPORT"];
  delete process.env["MINDS_BUS_URL"];
});

afterEach(() => {
  if (savedTransport !== undefined) {
    process.env["COLLAB_TRANSPORT"] = savedTransport;
  } else {
    delete process.env["COLLAB_TRANSPORT"];
  }
  if (savedBusUrl !== undefined) {
    process.env["MINDS_BUS_URL"] = savedBusUrl;
  } else {
    delete process.env["MINDS_BUS_URL"];
  }
});

// ── Level 1: @debug directive ─────────────────────────────────────────────────

describe("resolveTransport: @debug directive (Level 1)", () => {
  test("returns TmuxTransport when @debug is the only directive", async () => {
    const t = await resolveTransport(["@debug"]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });

  test("returns TmuxTransport when @debug is among multiple directives", async () => {
    const t = await resolveTransport(["@codeReview", "@debug", "@metrics"]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });

  test("does not trigger on a directive that contains @debug as substring", async () => {
    // "@debugMode" is not "@debug" — should fall through to auto-detect / fallback
    // (bus not running, so expects TmuxTransport from fallback)
    process.env["MINDS_BUS_URL"] = "http://localhost:1"; // refused immediately
    const t = await resolveTransport(["@debugMode"]);
    expect(t).toBeInstanceOf(TmuxTransport); // fallback, not directive match
  });
});

// ── Level 2: COLLAB_TRANSPORT env var override (uses MINDS_BUS_URL) ──────────
// Overrides auto-detect but NOT @debug (Level 1 always wins).

describe("resolveTransport: COLLAB_TRANSPORT env var override", () => {
  test("COLLAB_TRANSPORT=tmux returns TmuxTransport when no directives", async () => {
    process.env["COLLAB_TRANSPORT"] = "tmux";
    const t = await resolveTransport([]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });

  test("COLLAB_TRANSPORT=tmux returns TmuxTransport with unrelated directives", async () => {
    process.env["COLLAB_TRANSPORT"] = "tmux";
    const t = await resolveTransport(["@metrics"]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });

  test("@debug beats COLLAB_TRANSPORT=bus — Level 1 cannot be overridden", async () => {
    // This is the key priority regression test:
    // even with COLLAB_TRANSPORT=bus set, @debug in the pipeline must win.
    process.env["COLLAB_TRANSPORT"] = "bus";
    const t = await resolveTransport(["@debug"]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });

  test("COLLAB_TRANSPORT=bus returns BusTransport", async () => {
    process.env["COLLAB_TRANSPORT"] = "bus";
    const t = await resolveTransport([]);
    expect(t).toBeInstanceOf(BusTransport);
  });

  test("COLLAB_TRANSPORT=bus uses MINDS_BUS_URL when set", async () => {
    process.env["COLLAB_TRANSPORT"] = "bus";
    process.env["MINDS_BUS_URL"] = "http://mybus:9999";
    const t = await resolveTransport([]);
    expect(t).toBeInstanceOf(BusTransport);
    // agentPrompt reveals which URL the transport was configured with
    expect(t.agentPrompt("agent1", "ch1")).toContain("http://mybus:9999");
  });

  test("COLLAB_TRANSPORT=bus falls back to default URL when MINDS_BUS_URL not set", async () => {
    process.env["COLLAB_TRANSPORT"] = "bus";
    const t = await resolveTransport([]);
    expect(t).toBeInstanceOf(BusTransport);
    expect(t.agentPrompt("agent1", "ch1")).toContain("localhost:7777");
  });
});

// ── Level 2: fallback when bus not running ────────────────────────────────────

describe("resolveTransport: TmuxTransport fallback (bus unreachable)", () => {
  test("falls back to TmuxTransport when no directives and bus not running", async () => {
    // Port 1 is always refused — connection error is caught immediately
    process.env["MINDS_BUS_URL"] = "http://localhost:1";
    const t = await resolveTransport([]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });

  test("falls back to TmuxTransport with empty directive list and unreachable bus", async () => {
    process.env["MINDS_BUS_URL"] = "http://127.0.0.1:1";
    const t = await resolveTransport([]);
    expect(t).toBeInstanceOf(TmuxTransport);
  });
});

// ── BusTransport.agentPrompt ──────────────────────────────────────────────────

describe("BusTransport.agentPrompt", () => {
  test("contains the bus URL", () => {
    const t = new BusTransport("http://localhost:7777");
    expect(t.agentPrompt("agent-1", "ch1")).toContain("http://localhost:7777");
  });

  test("contains the channel name", () => {
    const t = new BusTransport("http://localhost:7777");
    expect(t.agentPrompt("agent-1", "my-channel")).toContain("my-channel");
  });

  test("reflects custom bus URL", () => {
    const t = new BusTransport("http://bus.internal:4242");
    expect(t.agentPrompt("agent-x", "ch1")).toContain("http://bus.internal:4242");
  });
});
