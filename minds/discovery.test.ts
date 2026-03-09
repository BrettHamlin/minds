import { describe, it, expect, afterEach } from "bun:test";
import { join } from "path";
import {
  findChildServerFiles,
  spawnChild,
  callDescribe,
  callHandle,
  discoverChildren,
  type SpawnedChild,
} from "./discovery";
import { validateMindDescription } from "./mind";

// Canonical fixtures: discovery-root/minds/{name}/server.ts
// integration.test.ts spawns these directly; discovery.test.ts uses discovery-root as parentDir
const PARENT_DIR = join(import.meta.dir, "fixtures", "discovery-root");
const MOCK_A_SERVER = join(PARENT_DIR, "minds", "mock-mind-a", "server.ts");
const MOCK_B_SERVER = join(PARENT_DIR, "minds", "mock-mind-b", "server.ts");

// Track spawned procs so we can clean them up
const spawned: Array<SpawnedChild["proc"]> = [];

afterEach(async () => {
  for (const proc of spawned.splice(0)) {
    try { proc.kill(); } catch {}
  }
});

// ---------------------------------------------------------------------------
// findChildServerFiles()
// ---------------------------------------------------------------------------

describe("findChildServerFiles()", () => {
  it("finds server.ts files under minds/ subdirectory", () => {
    // The fixtures dir has mock-mind-a/server.ts and mock-mind-b/server.ts
    const files = findChildServerFiles(PARENT_DIR);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.includes("mock-mind-a"))).toBe(true);
    expect(files.some((f) => f.includes("mock-mind-b"))).toBe(true);
  });

  it("returns [] when minds/ dir does not exist", () => {
    const files = findChildServerFiles("/nonexistent/path");
    expect(files).toHaveLength(0);
  });

  it("returns only existing server.ts files", () => {
    const files = findChildServerFiles(PARENT_DIR);
    for (const f of files) {
      expect(f.endsWith("server.ts")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// spawnChild() + callDescribe()
// ---------------------------------------------------------------------------

describe("spawnChild()", () => {
  it("starts mock-mind-a and receives MIND_READY with port > 0", async () => {
    const child = await spawnChild(MOCK_A_SERVER);
    spawned.push(child.proc);
    expect(child.port).toBeGreaterThan(0);
    expect(child.port).toBeLessThan(65536);
  }, 15_000);

  it("starts mock-mind-b and receives MIND_READY", async () => {
    const child = await spawnChild(MOCK_B_SERVER);
    spawned.push(child.proc);
    expect(child.port).toBeGreaterThan(0);
  }, 15_000);

  it("two children get different ports", async () => {
    const a = await spawnChild(MOCK_A_SERVER);
    spawned.push(a.proc);
    const b = await spawnChild(MOCK_B_SERVER);
    spawned.push(b.proc);
    expect(a.port).not.toBe(b.port);
  }, 20_000);
});

describe("callDescribe()", () => {
  it("returns a valid MindDescription from mock-mind-a", async () => {
    const child = await spawnChild(MOCK_A_SERVER);
    spawned.push(child.proc);

    const desc = await callDescribe(child.port);
    expect(validateMindDescription(desc)).toBe(true);
    expect(desc.name).toBe("mock-mind-a");
    expect(desc.keywords).toContain("signal");
  }, 15_000);

  it("returns a valid MindDescription from mock-mind-b", async () => {
    const child = await spawnChild(MOCK_B_SERVER);
    spawned.push(child.proc);

    const desc = await callDescribe(child.port);
    expect(validateMindDescription(desc)).toBe(true);
    expect(desc.name).toBe("mock-mind-b");
    expect(desc.keywords).toContain("spec");
  }, 15_000);
});

describe("callHandle()", () => {
  it("sends a request and gets a handled result", async () => {
    const child = await spawnChild(MOCK_A_SERVER);
    spawned.push(child.proc);

    const result = await callHandle(child.port, "hello world") as Record<string, unknown>;
    expect(result.status).toBe("handled");
    expect((result.data as Record<string, unknown>).echo).toBe("hello world");
  }, 15_000);

  it("escalate prefix returns escalate status", async () => {
    const child = await spawnChild(MOCK_A_SERVER);
    spawned.push(child.proc);

    const result = await callHandle(child.port, "escalate this") as Record<string, unknown>;
    expect(result.status).toBe("escalate");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// discoverChildren() integration test
// ---------------------------------------------------------------------------

describe("discoverChildren()", () => {
  it("discovers all mock minds, populates router", async () => {
    const result = await discoverChildren(PARENT_DIR);

    try {
      expect(result.children.length).toBe(3);

      const names = result.children.map((c) => c.description.name).sort();
      expect(names).toEqual(["mock-mind-a", "mock-mind-b", "mock-mind-c"]);

      expect(result.router.childCount).toBe(3);
    } finally {
      await result.shutdown();
    }
  }, 30_000);

  it("each discovered child has port > 0 and valid description", async () => {
    const result = await discoverChildren(PARENT_DIR);

    try {
      for (const child of result.children) {
        expect(child.port).toBeGreaterThan(0);
        expect(validateMindDescription(child.description)).toBe(true);
      }
    } finally {
      await result.shutdown();
    }
  }, 30_000);

  it("discovered children respond to handle()", async () => {
    const result = await discoverChildren(PARENT_DIR);

    try {
      const childA = result.children.find((c) => c.description.name === "mock-mind-a");
      expect(childA).toBeDefined();

      const response = await childA!.handle("test request") as Record<string, unknown>;
      expect(response.status).toBe("handled");
    } finally {
      await result.shutdown();
    }
  }, 30_000);

  it("router can route to correct child after discovery", async () => {
    const result = await discoverChildren(PARENT_DIR);

    try {
      const signalMatches = await result.router.route("emit signal for test-a");
      expect(signalMatches.length).toBeGreaterThan(0);
      expect(signalMatches[0].mind.name).toBe("mock-mind-a");
    } finally {
      await result.shutdown();
    }
  }, 30_000);

  it("shutdown() terminates all child processes", async () => {
    const result = await discoverChildren(PARENT_DIR);
    const ports = result.children.map((c) => c.port);

    await result.shutdown();

    // Brief wait for ports to be released
    await new Promise((r) => setTimeout(r, 200));

    for (const port of ports) {
      const res = await fetch(`http://localhost:${port}/health`).catch(() => null);
      expect(res).toBeNull();
    }
  }, 30_000);

  it("returns empty children when no minds/ dir exists", async () => {
    const result = await discoverChildren("/tmp/nonexistent-minds-test-path");
    expect(result.children).toHaveLength(0);
    expect(result.router.childCount).toBe(0);
    await result.shutdown();
  }, 10_000);
});
