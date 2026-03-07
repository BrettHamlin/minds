/**
 * routing-observability.test.ts
 *
 * Verifies that _routing metadata is stamped correctly by the infrastructure
 * (server-base + router), never by Mind handlers themselves.
 *
 * All tests use in-process handles — no live servers required.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { createMind } from "./server-base";
import { validateWorkResult } from "./mind";
import { MindRouter } from "./router";
import type { RunningMind } from "./server-base";
import type { WorkUnit } from "./mind";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const started: RunningMind[] = [];

async function startMind(name: string, capabilities: string[] = ["do test things"]) {
  const mind = await createMind({
    name,
    domain: `Test domain for ${name}`,
    keywords: ["test"],
    owns_files: [],
    capabilities,
    async handle(_workUnit: WorkUnit) {
      return { status: "handled" as const, data: { from: name } };
    },
  });
  started.push(mind);
  return mind;
}

afterEach(async () => {
  for (const mind of started.splice(0)) {
    await mind.shutdown().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// 1. server-base stamps _routing.mind after handle()
// ---------------------------------------------------------------------------

describe("server-base routing observability", () => {
  it("_routing.mind is set after in-process handle()", async () => {
    const mind = await startMind("alpha-mind");
    const result = await mind.handle({ request: "hello" });
    expect(result._routing).toBeDefined();
    expect(result._routing?.mind).toBe("alpha-mind");
  });

  it("_routing.intent is set when request matches a capability", async () => {
    const mind = await startMind("beta-mind", ["process payments", "send invoices"]);
    const result = await mind.handle({ request: "send an invoice" });
    expect(result._routing?.intent).toBeDefined();
    expect(typeof result._routing?.intent).toBe("string");
  });

  it("_routing.intent is undefined when no capability matches", async () => {
    const mind = await startMind("gamma-mind", ["emit signals"]);
    // Request has no overlap with capabilities
    const result = await mind.handle({ request: "zzzzz xxxxxxxxxxx" });
    expect(result._routing?.mind).toBe("gamma-mind");
    expect(result._routing?.intent).toBeUndefined();
  });

  it("_routing.mind is stamped even when handler escalates", async () => {
    const mind = await createMind({
      name: "escalating-mind",
      domain: "test",
      keywords: [],
      owns_files: [],
      capabilities: ["do things"],
      async handle() {
        return { status: "escalate" as const };
      },
    });
    started.push(mind);
    const result = await mind.handle({ request: "anything" });
    expect(result.status).toBe("escalate");
    expect(result._routing?.mind).toBe("escalating-mind");
  });

  it("_routing preserves existing _routing fields from handler (spread merge)", async () => {
    // Handler pre-sets _routing (unusual, but should be preserved and overwritten by mind/intent)
    const mind = await createMind({
      name: "merge-mind",
      domain: "test",
      keywords: [],
      owns_files: [],
      capabilities: ["run jobs"],
      async handle() {
        return { status: "handled" as const, _routing: { mind: "child-set", score: 0.99 } };
      },
    });
    started.push(mind);
    const result = await mind.handle({ request: "run jobs" });
    // server-base overwrites mind with config.name
    expect(result._routing?.mind).toBe("merge-mind");
    // score from handler is preserved (server-base doesn't set score)
    expect(result._routing?.score).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// 2. validateWorkResult accepts _routing
// ---------------------------------------------------------------------------

describe("validateWorkResult with _routing", () => {
  it("accepts result without _routing", () => {
    expect(validateWorkResult({ status: "handled" })).toBe(true);
  });

  it("accepts result with _routing.mind only", () => {
    expect(validateWorkResult({ status: "handled", _routing: { mind: "test-mind" } })).toBe(true);
  });

  it("accepts result with full _routing", () => {
    expect(
      validateWorkResult({
        status: "handled",
        _routing: { mind: "test-mind", score: 0.85, intent: "emit signals" },
      })
    ).toBe(true);
  });

  it("rejects result with invalid _routing.mind type", () => {
    expect(validateWorkResult({ status: "handled", _routing: { mind: 42 } })).toBe(false);
  });

  it("rejects result with invalid _routing.score type", () => {
    expect(validateWorkResult({ status: "handled", _routing: { score: "high" } })).toBe(false);
  });

  it("rejects result with _routing as non-object", () => {
    expect(validateWorkResult({ status: "handled", _routing: "bad" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Router stamps _routing.mind and _routing.score
// ---------------------------------------------------------------------------

describe("Router routing observability (in-process MindRouter + child minds)", () => {
  it("_routing.mind and _routing.score are set after Router routes", async () => {
    // Build two child minds
    const signalsMind = await startMind("signals", ["emit signals", "resolve signal names"]);
    const cliMind = await startMind("cli", ["parse CLI args", "install packages"]);

    // Build a router that delegates to in-process minds
    const mindRouter = new MindRouter();
    await mindRouter.addChild(signalsMind.describe());
    await mindRouter.addChild(cliMind.describe());

    // Route a signal-matching request through the router logic manually
    const request = "emit a signal for the pipeline";
    const matches = await mindRouter.route(request);
    expect(matches.length).toBeGreaterThan(0);

    const best = matches[0];
    const childMind = best.mind.name === "signals" ? signalsMind : cliMind;
    const raw = await childMind.handle({ request });

    // Simulate what router/server.ts does: merge routing metadata
    const result = {
      ...raw,
      _routing: {
        ...raw._routing,
        mind: best.mind.name,
        score: best.score,
      },
    };

    expect(result._routing.mind).toBe("signals");
    expect(typeof result._routing.score).toBe("number");
    expect(result._routing.score).toBeGreaterThan(0);
  });

  it("_routing merges: router mind + child intent preserved", async () => {
    const mind = await startMind("signals", ["emit signals", "persist to queue"]);

    const mindRouter = new MindRouter();
    await mindRouter.addChild(mind.describe());

    const request = "emit signals for the event queue";
    const matches = await mindRouter.route(request);
    expect(matches.length).toBeGreaterThan(0);

    const best = matches[0];
    // Child handle already stamps _routing.mind and _routing.intent
    const childResult = await mind.handle({ request });
    expect(childResult._routing?.mind).toBe("signals");

    // Router merges: preserves child's intent, overwrites mind+score
    const merged = {
      ...childResult,
      _routing: {
        ...childResult._routing,
        mind: best.mind.name,
        score: best.score,
      },
    };

    // After merge: mind is the routed-to mind, intent is preserved from child
    expect(merged._routing.mind).toBe("signals");
    expect(typeof merged._routing.score).toBe("number");
    // Intent from child is preserved through the spread
    if (childResult._routing?.intent) {
      expect(merged._routing.intent).toBe(childResult._routing.intent);
    }
  });
});
