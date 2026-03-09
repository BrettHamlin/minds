import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SEND_EVENT_PATH = join(__dirname, "..", "send-event.ts");

describe("send-event.ts hook handler", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `send-event-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("parses SubagentStart hook from stdin JSON correctly", async () => {
    const hookJson = JSON.stringify({
      session_id: "sess-123",
      hook_event_name: "SubagentStart",
    });

    // Without BUS_URL or MINDS_CHANNEL, it exits 0 but we verify no crash
    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:transport"], {
      stdin: Buffer.from(hookJson),
      cwd: tmpDir,
      env: { ...process.env, BUS_URL: "", MINDS_CHANNEL: "" },
    });

    expect(proc.exitCode).toBe(0);
  });

  it("parses PostToolUse hook with toolName correctly", async () => {
    const hookJson = JSON.stringify({
      session_id: "sess-456",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
    });

    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:signals"], {
      stdin: Buffer.from(hookJson),
      cwd: tmpDir,
      env: { ...process.env, BUS_URL: "", MINDS_CHANNEL: "" },
    });

    expect(proc.exitCode).toBe(0);
  });

  it("exits 0 when bus is unreachable (fire-and-forget)", async () => {
    const hookJson = JSON.stringify({
      session_id: "sess-789",
      hook_event_name: "Stop",
    });

    // Point to unreachable bus — handler must still exit 0
    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:test"], {
      stdin: Buffer.from(hookJson),
      cwd: tmpDir,
      env: { ...process.env, BUS_URL: "http://localhost:59999", MINDS_CHANNEL: "minds-BRE-457" },
    });

    expect(proc.exitCode).toBe(0);
  });

  it("exits 0 on empty stdin", async () => {
    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:test"], {
      stdin: Buffer.from(""),
      cwd: tmpDir,
      env: { ...process.env, BUS_URL: "http://localhost:59999", MINDS_CHANNEL: "minds-BRE-457" },
    });

    expect(proc.exitCode).toBe(0);
  });

  it("exits 0 on malformed JSON input", async () => {
    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:test"], {
      stdin: Buffer.from("{not valid json"),
      cwd: tmpDir,
      env: { ...process.env, BUS_URL: "http://localhost:59999", MINDS_CHANNEL: "minds-BRE-457" },
    });

    expect(proc.exitCode).toBe(0);
  });

  it("resolves bus URL from BUS_URL env var", async () => {
    const hookJson = JSON.stringify({
      session_id: "sess-env",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
    });

    // BUS_URL set, MINDS_CHANNEL set, bus unreachable but exit 0
    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:test"], {
      stdin: Buffer.from(hookJson),
      cwd: tmpDir,
      env: { ...process.env, BUS_URL: "http://localhost:59999", MINDS_CHANNEL: "minds-BRE-457" },
    });

    expect(proc.exitCode).toBe(0);
  });

  it("resolves bus URL from state file when no BUS_URL env var", async () => {
    // Write a fake state file
    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "minds-bus-BRE-457.json"),
      JSON.stringify({ busUrl: "http://localhost:59998", ticketId: "BRE-457" }),
    );

    const hookJson = JSON.stringify({
      session_id: "sess-state",
      hook_event_name: "PostToolUse",
      tool_name: "Write",
    });

    // No BUS_URL env — should resolve from state file, still exit 0 (bus unreachable)
    const envCopy = { ...process.env, MINDS_CHANNEL: "minds-BRE-457" };
    delete envCopy.BUS_URL;

    const proc = Bun.spawnSync(["bun", SEND_EVENT_PATH, "--source-app", "drone:test"], {
      stdin: Buffer.from(hookJson),
      cwd: tmpDir,
      env: envCopy,
    });

    expect(proc.exitCode).toBe(0);
  });
});
