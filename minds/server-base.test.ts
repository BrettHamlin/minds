import { describe, it, expect, afterEach } from "bun:test";
import { createMind } from "./server-base";
import { validateMindDescription, validateWorkResult } from "./mind";
import type { RunningMind } from "./server-base";

// Track minds created during tests so we can shut them down
const started: RunningMind[] = [];

async function startTestMind(overrides: Partial<Parameters<typeof createMind>[0]> = {}) {
  const mind = await createMind({
    name: "test-mind",
    domain: "Test domain for unit tests",
    keywords: ["test", "unit"],
    owns_files: ["minds/test/"],
    capabilities: ["do test things"],
    async handle(workUnit) {
      if (workUnit.request === "escalate-me") {
        return { status: "escalate" };
      }
      return { status: "handled", data: { echo: workUnit.request } };
    },
    ...overrides,
  });
  started.push(mind);
  return mind;
}

afterEach(async () => {
  for (const mind of started.splice(0)) {
    await mind.shutdown().catch(() => {});
  }
});

describe("createMind()", () => {
  it("returns a RunningMind with a port > 0", async () => {
    const mind = await startTestMind();
    expect(mind.port).toBeGreaterThan(0);
    expect(mind.port).toBeLessThan(65536);
  });

  it("describe() returns a valid MindDescription", async () => {
    const mind = await startTestMind();
    const desc = mind.describe();
    expect(validateMindDescription(desc)).toBe(true);
    expect(desc.name).toBe("test-mind");
    expect(desc.domain).toBe("Test domain for unit tests");
    expect(desc.keywords).toEqual(["test", "unit"]);
    expect(desc.capabilities).toEqual(["do test things"]);
  });

  it("handle() returns a valid WorkResult for a normal request", async () => {
    const mind = await startTestMind();
    const result = await mind.handle({ request: "hello world" });
    expect(validateWorkResult(result)).toBe(true);
    expect(result.status).toBe("handled");
    expect((result.data as Record<string, unknown>).echo).toBe("hello world");
  });

  it("handle() returns escalate when config handler escalates", async () => {
    const mind = await startTestMind();
    const result = await mind.handle({ request: "escalate-me" });
    expect(result.status).toBe("escalate");
  });

  it("handle() passes context and from fields through", async () => {
    let captured: unknown;
    const mind = await startTestMind({
      async handle(workUnit) {
        captured = workUnit;
        return { status: "handled" };
      },
    });
    await mind.handle({ request: "test", context: { key: "val" }, from: "parent" });
    expect((captured as Record<string, unknown>).context).toEqual({ key: "val" });
    expect((captured as Record<string, unknown>).from).toBe("parent");
  });

  it("handle() rejects invalid WorkUnit with error result", async () => {
    const mind = await startTestMind();
    const result = await mind.handle({ request: 42 } as unknown as Parameters<typeof mind.handle>[0]);
    expect(result.status).toBe("handled");
    expect(result.error).toBeTruthy();
  });

  it("two minds get different ports", async () => {
    const a = await startTestMind({ name: "mind-a" });
    const b = await startTestMind({ name: "mind-b" });
    expect(a.port).not.toBe(b.port);
  });

  it("shutdown() stops the HTTP server", async () => {
    const mind = await startTestMind();
    const { port } = mind;
    await mind.shutdown();
    // Remove from cleanup list since already shut down
    const idx = started.indexOf(mind);
    if (idx >= 0) started.splice(idx, 1);

    // Port should no longer be accepting connections
    const response = await fetch(`http://localhost:${port}/health`).catch(() => null);
    expect(response).toBeNull();
  });
});

describe("MCP HTTP server", () => {
  it("GET /health returns { ok: true, name }", async () => {
    const mind = await startTestMind({ name: "health-test" });
    const res = await fetch(`http://localhost:${mind.port}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.name).toBe("health-test");
  });

  it("MCP POST accepts tool calls and returns JSON", async () => {
    const mind = await startTestMind();
    // Send an MCP initialize request (required before tool calls in MCP protocol)
    const initRes = await fetch(`http://localhost:${mind.port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json() as Record<string, unknown>;
    expect(initBody).toHaveProperty("result");
  });
});
