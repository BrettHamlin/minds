import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { classifyEvent, computeChangedFields, discoverBusUrl } from "./status-emitter";
import { writeJsonAtomic } from "./json-io";

// ============================================================================
// classifyEvent
// ============================================================================

describe("classifyEvent", () => {
  test("returns registry_created when previous is null", () => {
    expect(classifyEvent(null, { ticket_id: "BRE-1", current_step: "clarify" }))
      .toBe("registry_created");
  });

  test("returns phase_changed when current_step differs", () => {
    const prev = { ticket_id: "BRE-1", current_step: "clarify", status: "running" };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "running" };
    expect(classifyEvent(prev, curr)).toBe("phase_changed");
  });

  test("returns status_changed when status differs", () => {
    const prev = { ticket_id: "BRE-1", current_step: "plan", status: "running" };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "complete" };
    expect(classifyEvent(prev, curr)).toBe("status_changed");
  });

  test("returns hold_changed when held_at differs", () => {
    const prev = { ticket_id: "BRE-1", current_step: "plan", status: "running", held_at: null };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "running", held_at: "plan" };
    expect(classifyEvent(prev, curr)).toBe("hold_changed");
  });

  test("returns hold_changed when waiting_for differs", () => {
    const prev = { ticket_id: "BRE-1", current_step: "plan", status: "running", waiting_for: null };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "running", waiting_for: "BRE-2" };
    expect(classifyEvent(prev, curr)).toBe("hold_changed");
  });

  test("returns registry_updated for any other field change", () => {
    const prev = { ticket_id: "BRE-1", current_step: "plan", status: "running", color_index: 1 };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "running", color_index: 2 };
    expect(classifyEvent(prev, curr)).toBe("registry_updated");
  });

  test("priority: phase_changed wins over status_changed", () => {
    const prev = { ticket_id: "BRE-1", current_step: "clarify", status: "running" };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "complete" };
    expect(classifyEvent(prev, curr)).toBe("phase_changed");
  });

  test("priority: status_changed wins over hold_changed", () => {
    const prev = { ticket_id: "BRE-1", current_step: "plan", status: "running", held_at: null };
    const curr = { ticket_id: "BRE-1", current_step: "plan", status: "complete", held_at: "plan" };
    expect(classifyEvent(prev, curr)).toBe("status_changed");
  });
});

// ============================================================================
// computeChangedFields
// ============================================================================

describe("computeChangedFields", () => {
  test("null previous — all fields are new with old: null", () => {
    const curr = { ticket_id: "BRE-1", current_step: "clarify" };
    const diff = computeChangedFields(null, curr);
    expect(diff).toEqual({
      ticket_id: { old: null, new: "BRE-1" },
      current_step: { old: null, new: "clarify" },
    });
  });

  test("changed field included in diff", () => {
    const prev = { current_step: "clarify" };
    const curr = { current_step: "plan" };
    const diff = computeChangedFields(prev, curr);
    expect(diff).toEqual({
      current_step: { old: "clarify", new: "plan" },
    });
  });

  test("unchanged field excluded from diff", () => {
    const prev = { ticket_id: "BRE-1", current_step: "plan" };
    const curr = { ticket_id: "BRE-1", current_step: "plan" };
    const diff = computeChangedFields(prev, curr);
    expect(diff).toEqual({});
  });

  test("added field has old: null", () => {
    const prev = { ticket_id: "BRE-1" };
    const curr = { ticket_id: "BRE-1", status: "running" };
    const diff = computeChangedFields(prev, curr);
    expect(diff).toEqual({
      status: { old: null, new: "running" },
    });
  });

  test("removed field has new: null", () => {
    const prev = { ticket_id: "BRE-1", status: "running" };
    const curr = { ticket_id: "BRE-1" };
    const diff = computeChangedFields(prev, curr);
    expect(diff).toEqual({
      status: { old: "running", new: null },
    });
  });

  test("array changes detected via JSON.stringify", () => {
    const prev = { phase_history: [{ phase: "clarify" }] };
    const curr = { phase_history: [{ phase: "clarify" }, { phase: "plan" }] };
    const diff = computeChangedFields(prev, curr);
    expect(diff.phase_history).toBeDefined();
    expect(diff.phase_history.old).toEqual([{ phase: "clarify" }]);
    expect(diff.phase_history.new).toEqual([{ phase: "clarify" }, { phase: "plan" }]);
  });

  test("identical arrays not included in diff", () => {
    const prev = { phase_history: [{ phase: "clarify" }] };
    const curr = { phase_history: [{ phase: "clarify" }] };
    const diff = computeChangedFields(prev, curr);
    expect(diff).toEqual({});
  });
});

// ============================================================================
// discoverBusUrl
// ============================================================================

describe("discoverBusUrl", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bus-discover-"));
    origCwd = process.cwd();
    // discoverBusUrl uses getRepoRoot() which calls git rev-parse;
    // in a temp dir with no git, it falls back to cwd
    process.chdir(tmpDir);
  });

  afterAll(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null when bus-port file does not exist", () => {
    expect(discoverBusUrl()).toBeNull();
  });

  test("returns URL when bus-port file contains valid port", () => {
    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), "12345");
    expect(discoverBusUrl()).toBe("http://localhost:12345");
    fs.rmSync(collabDir, { recursive: true, force: true });
  });

  test("returns null when bus-port file contains non-numeric content", () => {
    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), "not-a-number");
    expect(discoverBusUrl()).toBeNull();
    fs.rmSync(collabDir, { recursive: true, force: true });
  });

  test("returns null when bus-port file is empty", () => {
    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), "");
    expect(discoverBusUrl()).toBeNull();
    fs.rmSync(collabDir, { recursive: true, force: true });
  });
});

// ============================================================================
// Integration: writeJsonAtomic → emitStatusEvent → mock bus (T008)
// ============================================================================

describe("writeJsonAtomic emission integration", () => {
  let tmpDir: string;
  let origCwd: string;
  let mockServer: ReturnType<typeof Bun.serve>;
  let receivedRequests: Array<{ path: string; body: any }>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-integration-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    receivedRequests = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return req.json().then((body) => {
          receivedRequests.push({ path: url.pathname, body });
          return new Response("ok");
        });
      },
    });

    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), String(mockServer.port));
  });

  afterAll(() => {
    mockServer.stop(true);
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("publishes status event when writing registry data with ticket_id", async () => {
    receivedRequests = [];
    const registryFile = path.join(tmpDir, "BRE-1.json");
    const data = { ticket_id: "BRE-1", current_step: "clarify", status: "running" };

    writeJsonAtomic(registryFile, data);

    // Wait for the fire-and-forget fetch to complete
    await Bun.sleep(200);

    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    expect(req.path).toBe("/publish");
    expect(req.body.channel).toBe("status");
    expect(req.body.from).toBe("status-emitter");
    expect(req.body.type).toBe("registry_created");
    expect(req.body.payload.ticketId).toBe("BRE-1");
    expect(req.body.payload.eventType).toBe("registry_created");
    expect(req.body.payload.changedFields).toBeDefined();
    expect(req.body.payload.snapshot).toEqual(data);
    expect(req.body.payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Verify the file was written correctly
    const written = JSON.parse(fs.readFileSync(registryFile, "utf-8"));
    expect(written).toEqual(data);
  });

  test("publishes phase_changed on second write with changed current_step", async () => {
    receivedRequests = [];
    const registryFile = path.join(tmpDir, "BRE-2.json");

    // First write — creates file
    writeJsonAtomic(registryFile, { ticket_id: "BRE-2", current_step: "clarify", status: "running" });
    await Bun.sleep(200);
    receivedRequests = [];

    // Second write — changes phase
    writeJsonAtomic(registryFile, { ticket_id: "BRE-2", current_step: "plan", status: "running" });
    await Bun.sleep(200);

    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("phase_changed");
    expect(receivedRequests[0].body.payload.changedFields.current_step).toEqual({
      old: "clarify",
      new: "plan",
    });
  });
});

// ============================================================================
// Guard: non-registry writes are skipped (T009)
// ============================================================================

describe("writeJsonAtomic guard — non-registry writes", () => {
  let tmpDir: string;
  let origCwd: string;
  let mockServer: ReturnType<typeof Bun.serve>;
  let receivedRequests: Array<{ path: string; body: any }>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-guard-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    receivedRequests = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return req.json().then((body) => {
          receivedRequests.push({ path: url.pathname, body });
          return new Response("ok");
        });
      },
    });

    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), String(mockServer.port));
  });

  afterAll(() => {
    mockServer.stop(true);
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("does NOT emit when data has no ticket_id (group JSON)", async () => {
    receivedRequests = [];
    const groupFile = path.join(tmpDir, "group.json");
    const groupData = { name: "test-group", members: ["BRE-1", "BRE-2"] };

    writeJsonAtomic(groupFile, groupData);
    await Bun.sleep(200);

    expect(receivedRequests.length).toBe(0);

    // Verify the file was still written correctly
    const written = JSON.parse(fs.readFileSync(groupFile, "utf-8"));
    expect(written).toEqual(groupData);
  });

  test("does NOT emit when data is a primitive", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "config.json");

    writeJsonAtomic(file, "just a string");
    await Bun.sleep(200);

    expect(receivedRequests.length).toBe(0);
  });

  test("does NOT emit when data is null", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "empty.json");

    writeJsonAtomic(file, null);
    await Bun.sleep(200);

    expect(receivedRequests.length).toBe(0);
  });
});

// ============================================================================
// Degradation: writes succeed when bus is unavailable (T010)
// ============================================================================

describe("graceful degradation — no bus available", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-degrade-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterAll(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("write succeeds when no bus-port file exists", () => {
    const file = path.join(tmpDir, "no-bus.json");
    const data = { ticket_id: "BRE-1", current_step: "clarify", status: "running" };

    // Should not throw
    writeJsonAtomic(file, data);

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written).toEqual(data);
  });

  test("write succeeds when bus-port contains non-numeric content", () => {
    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), "not-a-number");

    const file = path.join(tmpDir, "bad-port.json");
    const data = { ticket_id: "BRE-2", current_step: "plan", status: "running" };

    writeJsonAtomic(file, data);

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written).toEqual(data);

    fs.rmSync(collabDir, { recursive: true, force: true });
  });

  test("write succeeds when bus server is unreachable (wrong port)", async () => {
    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    // Use a port that nothing is listening on
    fs.writeFileSync(path.join(collabDir, "bus-port"), "19999");

    const file = path.join(tmpDir, "unreachable.json");
    const data = { ticket_id: "BRE-3", current_step: "plan", status: "running" };

    // Capture stderr
    const origStderr = console.error;
    const stderrMessages: string[] = [];
    console.error = (msg: string) => stderrMessages.push(msg);

    writeJsonAtomic(file, data);

    // Wait for the fetch to fail
    await Bun.sleep(500);

    console.error = origStderr;

    // File was written correctly despite emission failure
    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written).toEqual(data);

    // stderr should have a [StatusEmitter] message
    expect(stderrMessages.some((m) => m.includes("[StatusEmitter]"))).toBe(true);

    fs.rmSync(collabDir, { recursive: true, force: true });
  });
});

// ============================================================================
// Timeout: AbortController fires within 2s (T011)
// ============================================================================

describe("emission timeout", () => {
  let tmpDir: string;
  let origCwd: string;
  let slowServer: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-timeout-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);

    // Server that never responds (delays 10s)
    slowServer = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(10000);
        return new Response("too late");
      },
    });

    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), String(slowServer.port));
  });

  afterAll(() => {
    slowServer.stop(true);
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("AbortController fires, stderr logs timeout, write is not blocked", async () => {
    const file = path.join(tmpDir, "timeout-test.json");
    const data = { ticket_id: "BRE-T", current_step: "clarify", status: "running" };

    const origStderr = console.error;
    const stderrMessages: string[] = [];
    console.error = (msg: string) => stderrMessages.push(msg);

    const start = Date.now();
    writeJsonAtomic(file, data);
    const writeTime = Date.now() - start;

    // writeJsonAtomic returns immediately (fire-and-forget) — should be < 100ms
    expect(writeTime).toBeLessThan(100);

    // Wait for the abort to fire (2s timeout + buffer)
    await Bun.sleep(2500);

    console.error = origStderr;

    // File was written correctly
    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written).toEqual(data);

    // stderr should have logged the abort
    expect(stderrMessages.some((m) => m.includes("[StatusEmitter]"))).toBe(true);
  });
});

// ============================================================================
// E2E Classification: all 5 event types through writeJsonAtomic (T012)
// ============================================================================

describe("e2e classification — all 5 event types via writeJsonAtomic", () => {
  let tmpDir: string;
  let origCwd: string;
  let mockServer: ReturnType<typeof Bun.serve>;
  let receivedRequests: Array<{ path: string; body: any }>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-classify-e2e-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    receivedRequests = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return req.json().then((body) => {
          receivedRequests.push({ path: url.pathname, body });
          return new Response("ok");
        });
      },
    });

    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), String(mockServer.port));
  });

  afterAll(() => {
    mockServer.stop(true);
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("new file → registry_created", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "e2e-created.json");
    writeJsonAtomic(file, { ticket_id: "BRE-E1", current_step: "clarify", status: "running" });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("registry_created");
  });

  test("change current_step → phase_changed", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "e2e-phase.json");
    writeJsonAtomic(file, { ticket_id: "BRE-E2", current_step: "clarify", status: "running" });
    await Bun.sleep(200);
    receivedRequests = [];
    writeJsonAtomic(file, { ticket_id: "BRE-E2", current_step: "plan", status: "running" });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("phase_changed");
  });

  test("change status → status_changed", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "e2e-status.json");
    writeJsonAtomic(file, { ticket_id: "BRE-E3", current_step: "plan", status: "running" });
    await Bun.sleep(200);
    receivedRequests = [];
    writeJsonAtomic(file, { ticket_id: "BRE-E3", current_step: "plan", status: "complete" });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("status_changed");
  });

  test("change held_at → hold_changed", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "e2e-hold.json");
    writeJsonAtomic(file, { ticket_id: "BRE-E4", current_step: "plan", status: "running", held_at: null });
    await Bun.sleep(200);
    receivedRequests = [];
    writeJsonAtomic(file, { ticket_id: "BRE-E4", current_step: "plan", status: "running", held_at: "plan" });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("hold_changed");
  });

  test("change unclassified field → registry_updated", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "e2e-updated.json");
    writeJsonAtomic(file, { ticket_id: "BRE-E5", current_step: "plan", status: "running", color_index: 1 });
    await Bun.sleep(200);
    receivedRequests = [];
    writeJsonAtomic(file, { ticket_id: "BRE-E5", current_step: "plan", status: "running", color_index: 2 });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("registry_updated");
  });
});

// ============================================================================
// E2E Priority: higher-priority event type wins (T013)
// ============================================================================

describe("e2e priority — higher event type wins", () => {
  let tmpDir: string;
  let origCwd: string;
  let mockServer: ReturnType<typeof Bun.serve>;
  let receivedRequests: Array<{ path: string; body: any }>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-priority-e2e-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    receivedRequests = [];

    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return req.json().then((body) => {
          receivedRequests.push({ path: url.pathname, body });
          return new Response("ok");
        });
      },
    });

    const collabDir = path.join(tmpDir, ".minds");
    fs.mkdirSync(collabDir, { recursive: true });
    fs.writeFileSync(path.join(collabDir, "bus-port"), String(mockServer.port));
  });

  afterAll(() => {
    mockServer.stop(true);
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("phase_changed wins over status_changed when both change", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "priority-1.json");
    writeJsonAtomic(file, { ticket_id: "BRE-P1", current_step: "clarify", status: "running" });
    await Bun.sleep(200);
    receivedRequests = [];
    writeJsonAtomic(file, { ticket_id: "BRE-P1", current_step: "plan", status: "complete" });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("phase_changed");
  });

  test("status_changed wins over hold_changed when both change", async () => {
    receivedRequests = [];
    const file = path.join(tmpDir, "priority-2.json");
    writeJsonAtomic(file, { ticket_id: "BRE-P2", current_step: "plan", status: "running", held_at: null });
    await Bun.sleep(200);
    receivedRequests = [];
    writeJsonAtomic(file, { ticket_id: "BRE-P2", current_step: "plan", status: "complete", held_at: "plan" });
    await Bun.sleep(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.type).toBe("status_changed");
  });
});
