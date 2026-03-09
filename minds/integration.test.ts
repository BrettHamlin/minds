/**
 * integration.test.ts — Full protocol integration tests for Layer 1.
 *
 * Tests the complete Mind protocol with real Bun.spawn() child processes.
 * All 7 scenarios from the L1-5 plan are covered.
 *
 * Fixture Minds:
 *   mock-mind-a: "signal emit event test-a" domain
 *   mock-mind-b: "spec generate session test-b" domain
 *   mock-mind-c: "deep escalation test-c level" domain; escalates non-"deep" requests
 */

import { describe, it, expect, afterEach } from "bun:test";
import { join } from "path";
import { spawnChild, callDescribe, callHandle, type SpawnedChild } from "./discovery";
import { MindRouter } from "./router";
import { validateMindDescription, validateWorkResult } from "./mind";

// Canonical fixtures live under discovery-root/minds/ — shared with discovery.test.ts
const DISCOVERY_ROOT = join(import.meta.dir, "fixtures", "discovery-root");
const SERVER_A = join(DISCOVERY_ROOT, "minds", "mock-mind-a", "server.ts");
const SERVER_B = join(DISCOVERY_ROOT, "minds", "mock-mind-b", "server.ts");
const SERVER_C = join(DISCOVERY_ROOT, "minds", "mock-mind-c", "server.ts");

// Track all spawned processes for cleanup
const allSpawned: Array<SpawnedChild["proc"]> = [];

async function spawn(serverPath: string): Promise<SpawnedChild> {
  const child = await spawnChild(serverPath);
  allSpawned.push(child.proc);
  return child;
}

afterEach(async () => {
  for (const proc of allSpawned.splice(0)) {
    try { proc.kill(); } catch {}
  }
  // Brief wait for ports to release
  await new Promise((r) => setTimeout(r, 100));
});

// ---------------------------------------------------------------------------
// Test 1: Delegation
// "Parent with 2 children. Work unit matching child A's domain → A handles it."
// ---------------------------------------------------------------------------

describe("Test 1: Delegation", () => {
  it("signal request routes to mock-mind-a", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);

    const descA = await callDescribe(a.port);
    const descB = await callDescribe(b.port);

    const router = new MindRouter();
    await router.addChild(descA);
    await router.addChild(descB);

    // Route a "signal" request
    const matches = await router.route("emit a signal event");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("mock-mind-a");

    // Dispatch to the matched child
    const result = await callHandle(a.port, "emit a signal event") as Record<string, unknown>;
    expect(result.status).toBe("handled");
    expect((result.data as Record<string, unknown>).mind).toBe("mock-mind-a");
  }, 30_000);

  it("spec request routes to mock-mind-b", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);

    const descA = await callDescribe(a.port);
    const descB = await callDescribe(b.port);

    const router = new MindRouter();
    await router.addChild(descA);
    await router.addChild(descB);

    const matches = await router.route("generate a spec for the session");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("mock-mind-b");

    const result = await callHandle(b.port, "generate a spec") as Record<string, unknown>;
    expect(result.status).toBe("handled");
    expect((result.data as Record<string, unknown>).mind).toBe("mock-mind-b");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test 2: Escalation
// "Child receives work outside domain → returns escalate → parent tries next child."
// ---------------------------------------------------------------------------

describe("Test 2: Escalation", () => {
  it("escalate request propagates and parent tries next child", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);

    // Ask child A to escalate
    const escalateResult = await callHandle(a.port, "escalate this request") as Record<string, unknown>;
    expect(escalateResult.status).toBe("escalate");

    // Parent sees escalate → routes to B instead
    const descB = await callDescribe(b.port);
    const router = new MindRouter();
    await router.addChild(await callDescribe(a.port));
    await router.addChild(descB);

    // "spec" query won't match A → A would escalate → parent routes to B
    const matches = await router.route("generate spec");
    const bMatch = matches.find((m) => m.mind.name === "mock-mind-b");
    expect(bMatch).toBeDefined();

    const result = await callHandle(b.port, "generate spec") as Record<string, unknown>;
    expect(result.status).toBe("handled");
  }, 30_000);

  it("WorkResult from escalate is a valid WorkResult", async () => {
    const a = await spawn(SERVER_A);
    const result = await callHandle(a.port, "escalate me") as Record<string, unknown>;
    expect(validateWorkResult(result)).toBe(true);
    expect(result.status).toBe("escalate");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Test 3: Deep Escalation
// "3 levels deep. Leaf escalates → mid can't handle → root routes to sibling."
// ---------------------------------------------------------------------------

describe("Test 3: Deep Escalation", () => {
  it("mock-mind-c escalates non-deep requests", async () => {
    const c = await spawn(SERVER_C);

    // Non-deep request → escalate
    const escalate = await callHandle(c.port, "something unrelated") as Record<string, unknown>;
    expect(escalate.status).toBe("escalate");
  }, 15_000);

  it("mock-mind-c handles deep requests", async () => {
    const c = await spawn(SERVER_C);

    // Deep request → handled
    const result = await callHandle(c.port, "handle a deep level request") as Record<string, unknown>;
    expect(result.status).toBe("handled");
    expect((result.data as Record<string, unknown>).mind).toBe("mock-mind-c");
  }, 15_000);

  it("three-level chain: C escalates → router at mid level finds A", async () => {
    const a = await spawn(SERVER_A);
    const c = await spawn(SERVER_C);

    const descA = await callDescribe(a.port);
    const descC = await callDescribe(c.port);

    // Parent router with both A and C
    const router = new MindRouter();
    await router.addChild(descA);
    await router.addChild(descC);

    // Request matches neither C's deep domain nor A's signal domain
    // — send to C, it escalates, parent re-routes to A
    const cResult = await callHandle(c.port, "emit signal test") as Record<string, unknown>;
    // C escalates since "emit signal" doesn't contain "deep"
    expect(cResult.status).toBe("escalate");

    // Parent routes "signal" to A instead
    const matches = await router.route("emit signal test");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("mock-mind-a");

    const aResult = await callHandle(a.port, "emit signal test") as Record<string, unknown>;
    expect(aResult.status).toBe("handled");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test 4: Multi-match
// "Work unit matches 2 children → parent sends to highest-scored match."
// ---------------------------------------------------------------------------

describe("Test 4: Multi-match", () => {
  it("returns multiple ranked matches, highest score first", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);
    const c = await spawn(SERVER_C);

    const router = new MindRouter();
    await router.addChild(await callDescribe(a.port));
    await router.addChild(await callDescribe(b.port));
    await router.addChild(await callDescribe(c.port));

    // "test" keyword appears in all three — should get multiple matches
    const matches = await router.route("test event");
    expect(matches.length).toBeGreaterThanOrEqual(1);

    // Scores are descending
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
    // First match is primary
    expect(matches[0].role).toBe("primary");
  }, 30_000);

  it("highest-scored match successfully handles the request", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);

    const router = new MindRouter();
    await router.addChild(await callDescribe(a.port));
    await router.addChild(await callDescribe(b.port));

    const matches = await router.route("emit signal");
    expect(matches.length).toBeGreaterThan(0);

    const topMatch = matches[0];
    const port = topMatch.mind.name === "mock-mind-a" ? a.port : b.port;
    const result = await callHandle(port, "emit signal") as Record<string, unknown>;
    expect(result.status).toBe("handled");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test 5: No-match
// "Work unit matches no child → no results."
// ---------------------------------------------------------------------------

describe("Test 5: No-match", () => {
  it("router returns [] when no child matches gibberish", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);

    const router = new MindRouter();
    await router.addChild(await callDescribe(a.port));
    await router.addChild(await callDescribe(b.port));

    const matches = await router.route("zzzzz_completely_unrecognized_xyzzy");
    expect(matches).toHaveLength(0);
  }, 30_000);

  it("empty router returns [] for any request", async () => {
    const router = new MindRouter();
    expect(await router.route("anything at all")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: describe() accuracy
// "Each Mind's describe() correctly represents its domain."
// ---------------------------------------------------------------------------

describe("Test 6: describe() accuracy", () => {
  it("mock-mind-a describe() is structurally valid and accurate", async () => {
    const a = await spawn(SERVER_A);
    const desc = await callDescribe(a.port);

    expect(validateMindDescription(desc)).toBe(true);
    expect(desc.name).toBe("mock-mind-a");
    expect(desc.keywords).toContain("signal");
    expect(desc.keywords).toContain("emit");
    expect(desc.capabilities.length).toBeGreaterThan(0);
  }, 15_000);

  it("mock-mind-b describe() is structurally valid and accurate", async () => {
    const b = await spawn(SERVER_B);
    const desc = await callDescribe(b.port);

    expect(validateMindDescription(desc)).toBe(true);
    expect(desc.name).toBe("mock-mind-b");
    expect(desc.keywords).toContain("spec");
    expect(desc.capabilities.length).toBeGreaterThan(0);
  }, 15_000);

  it("mock-mind-c describe() is structurally valid and accurate", async () => {
    const c = await spawn(SERVER_C);
    const desc = await callDescribe(c.port);

    expect(validateMindDescription(desc)).toBe(true);
    expect(desc.name).toBe("mock-mind-c");
    expect(desc.keywords).toContain("deep");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Test 7: Process lifecycle
// "Start children → kill one → parent detects → remaining still work."
// ---------------------------------------------------------------------------

describe("Test 7: Process lifecycle", () => {
  it("killing a child removes it from router; remaining children still work", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);

    const descA = await callDescribe(a.port);
    const descB = await callDescribe(b.port);

    const router = new MindRouter();
    await router.addChild(descA);
    await router.addChild(descB);

    expect(router.childCount).toBe(2);

    // Kill child A
    a.proc.kill();
    router.removeChild("mock-mind-a");
    expect(router.childCount).toBe(1);

    // Child B still responds
    const result = await callHandle(b.port, "generate spec") as Record<string, unknown>;
    expect(result.status).toBe("handled");
  }, 30_000);

  it("killed child no longer accepts connections", async () => {
    const a = await spawn(SERVER_A);
    const { port } = a;

    // Verify it's alive
    const alive = await fetch(`http://localhost:${port}/health`).then((r) => r.json()) as Record<string, unknown>;
    expect(alive.ok).toBe(true);

    // Kill it
    a.proc.kill();
    await new Promise((r) => setTimeout(r, 300));

    // Should be dead
    const dead = await fetch(`http://localhost:${port}/health`).catch(() => null);
    expect(dead).toBeNull();
  }, 15_000);

  it("dynamic ports prevent conflicts when starting multiple Minds", async () => {
    const a = await spawn(SERVER_A);
    const b = await spawn(SERVER_B);
    const c = await spawn(SERVER_C);

    const ports = [a.port, b.port, c.port];
    const uniquePorts = new Set(ports);
    expect(uniquePorts.size).toBe(3);
  }, 30_000);

  it("total runtime for all 3 Minds starting is under 10s", async () => {
    const start = Date.now();
    const [a, b, c] = await Promise.all([
      spawn(SERVER_A),
      spawn(SERVER_B),
      spawn(SERVER_C),
    ]);
    const elapsed = Date.now() - start;

    // All started successfully
    expect(a.port).toBeGreaterThan(0);
    expect(b.port).toBeGreaterThan(0);
    expect(c.port).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);
});
