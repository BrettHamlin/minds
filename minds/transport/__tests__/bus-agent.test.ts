// Tests for bus-agent.ts (BRE-346)
//
// Covers: generateAgentPrompt, writeAgentMemory, readAgentMemory, publishSafe

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  generateAgentPrompt,
  writeAgentMemory,
  readAgentMemory,
  publishSafe,
  MSG,
  type AgentMemory,
} from "../bus-agent.ts";
import { BusTransport } from "../BusTransport.ts";
import { createServer } from "../bus-server.ts";

// ── Temp dir fixture ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    import.meta.dir,
    `__tmp_bus_agent_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(join(tmpDir, "agents"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── generateAgentPrompt ───────────────────────────────────────────────────────

describe("generateAgentPrompt", () => {
  const agentId = "agent-abc-123";
  const busUrl = "http://localhost:7788";
  const channel = "pipe-ch-001";
  let prompt: string;

  beforeEach(() => {
    prompt = generateAgentPrompt(agentId, busUrl, channel);
  });

  test("contains the agent ID", () => {
    expect(prompt).toContain(agentId);
  });

  test("contains the bus URL", () => {
    expect(prompt).toContain(busUrl);
  });

  test("contains the channel", () => {
    expect(prompt).toContain(channel);
  });

  test("contains curl instructions", () => {
    expect(prompt).toContain("curl");
  });

  test("contains all 5 message types", () => {
    expect(prompt).toContain(MSG.STARTED);
    expect(prompt).toContain(MSG.PROGRESS);
    expect(prompt).toContain(MSG.BLOCKED);
    expect(prompt).toContain(MSG.DONE);
    expect(prompt).toContain(MSG.ERROR);
  });

  test("done section includes agent_id field", () => {
    // The done curl payload must include agent_id
    const doneIdx = prompt.indexOf(`"type":"done"`);
    expect(doneIdx).toBeGreaterThan(-1);
    const donePart = prompt.slice(doneIdx, doneIdx + 300);
    expect(donePart).toContain("agent_id");
  });

  test("done section includes memory_path field", () => {
    const doneIdx = prompt.indexOf(`"type":"done"`);
    const donePart = prompt.slice(doneIdx, doneIdx + 300);
    expect(donePart).toContain("memory_path");
  });

  test("memory_path in done payload matches .minds/agents/<agentId>.json", () => {
    expect(prompt).toContain(`.minds/agents/${agentId}.json`);
  });

  test("includes || true for graceful fallback", () => {
    expect(prompt).toContain("|| true");
  });

  test("includes die-and-persist memory schema", () => {
    expect(prompt).toContain("completed_work");
    expect(prompt).toContain("remaining_work");
    expect(prompt).toContain("key_decisions");
    expect(prompt).toContain("worktree_path");
  });

  test("mentions resume context", () => {
    expect(prompt.toLowerCase()).toContain("resume");
  });

  test("different agent IDs produce different prompts", () => {
    const p2 = generateAgentPrompt("other-agent", busUrl, channel);
    expect(prompt).not.toBe(p2);
    expect(p2).toContain("other-agent");
  });

  test("different channels produce different prompts", () => {
    const p2 = generateAgentPrompt(agentId, busUrl, "other-channel");
    expect(prompt).not.toBe(p2);
    expect(p2).toContain("other-channel");
  });
});

// ── MSG constants ─────────────────────────────────────────────────────────────

describe("MSG constants", () => {
  test("defines all 5 standard types", () => {
    expect(MSG.STARTED).toBe("started");
    expect(MSG.PROGRESS).toBe("progress");
    expect(MSG.BLOCKED).toBe("blocked");
    expect(MSG.DONE).toBe("done");
    expect(MSG.ERROR).toBe("error");
  });
});

// ── writeAgentMemory / readAgentMemory ────────────────────────────────────────

describe("writeAgentMemory + readAgentMemory", () => {
  const baseMemory: AgentMemory = {
    agent_id: "agent-xyz",
    role: "implementer",
    ticket: "BRE-346",
    completed_work: ["wrote bus-agent.ts", "wrote tests"],
    remaining_work: [],
    key_decisions: ["used AbortSignal.timeout for publishSafe"],
    worktree_path: "/tmp/worktrees/bre-346",
    last_updated: "2026-01-01T00:00:00.000Z",
  };

  test("writeAgentMemory returns the written file path", () => {
    const path = writeAgentMemory("agent-xyz", baseMemory, tmpDir);
    expect(path).toContain("agent-xyz.json");
    expect(path).toContain("agents");
  });

  test("written file path is inside .minds/agents/", () => {
    const path = writeAgentMemory("agent-xyz", baseMemory, tmpDir);
    expect(path).toContain(join(tmpDir, "agents"));
  });

  test("round-trip: readAgentMemory returns what was written", () => {
    writeAgentMemory("agent-xyz", baseMemory, tmpDir);
    const read = readAgentMemory("agent-xyz", tmpDir);
    expect(read).not.toBeNull();
    expect(read!.agent_id).toBe("agent-xyz");
    expect(read!.role).toBe("implementer");
    expect(read!.ticket).toBe("BRE-346");
    expect(read!.completed_work).toEqual(["wrote bus-agent.ts", "wrote tests"]);
    expect(read!.remaining_work).toEqual([]);
    expect(read!.key_decisions).toEqual(["used AbortSignal.timeout for publishSafe"]);
    expect(read!.worktree_path).toBe("/tmp/worktrees/bre-346");
  });

  test("writeAgentMemory stamps last_updated with current ISO time", () => {
    const before = Date.now();
    writeAgentMemory("agent-xyz", baseMemory, tmpDir);
    const after = Date.now();
    const read = readAgentMemory("agent-xyz", tmpDir)!;
    const ts = new Date(read.last_updated).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("readAgentMemory returns null for missing agent", () => {
    const result = readAgentMemory("no-such-agent", tmpDir);
    expect(result).toBeNull();
  });

  test("multiple agents get separate files", () => {
    const mem2: AgentMemory = { ...baseMemory, agent_id: "agent-other", role: "reviewer" };
    writeAgentMemory("agent-xyz", baseMemory, tmpDir);
    writeAgentMemory("agent-other", mem2, tmpDir);

    const r1 = readAgentMemory("agent-xyz", tmpDir)!;
    const r2 = readAgentMemory("agent-other", tmpDir)!;
    expect(r1.role).toBe("implementer");
    expect(r2.role).toBe("reviewer");
  });

  test("overwriting updates the file", () => {
    writeAgentMemory("agent-xyz", baseMemory, tmpDir);
    const updated: AgentMemory = { ...baseMemory, remaining_work: ["write docs"] };
    writeAgentMemory("agent-xyz", updated, tmpDir);
    const read = readAgentMemory("agent-xyz", tmpDir)!;
    expect(read.remaining_work).toEqual(["write docs"]);
  });

  test("creates agents/ dir if it does not exist", () => {
    const freshDir = join(tmpDir, "fresh-collab");
    // Do not pre-create agents subdir — writeAgentMemory must create it
    writeAgentMemory("agent-xyz", baseMemory, freshDir);
    const read = readAgentMemory("agent-xyz", freshDir);
    expect(read).not.toBeNull();
    expect(read!.agent_id).toBe("agent-xyz");
  });
});

// ── publishSafe graceful fallback ─────────────────────────────────────────────

describe("publishSafe — graceful fallback", () => {
  test("does not throw when bus is unreachable (refused port)", async () => {
    // Port 1 is always refused
    await expect(
      publishSafe("http://localhost:1", "ch", "agent", "started", null)
    ).resolves.toBeUndefined();
  });

  test("does not throw on DNS failure", async () => {
    await expect(
      publishSafe("http://no-such-host-bre346.invalid:9999", "ch", "agent", "done", null)
    ).resolves.toBeUndefined();
  });

  test("resolves without error when bus is available and publishes the message", async () => {
    const server = createServer(0);
    const url = `http://localhost:${server.port}`;

    await expect(
      publishSafe(url, "safe-ch", "test-agent", MSG.STARTED, { agent_id: "test-agent" })
    ).resolves.toBeUndefined();

    // Confirm message was recorded
    const status = await fetch(`${url}/status`).then((r) => r.json()) as { messageCount: number };
    expect(status.messageCount).toBe(1);

    server.stop(true);
  });
});

// ── BusTransport.agentPrompt delegates to generateAgentPrompt ─────────────────

describe("BusTransport.agentPrompt", () => {
  test("returns a prompt containing curl instructions (delegates to generateAgentPrompt)", () => {
    const transport = new BusTransport("http://localhost:7788");
    const prompt = transport.agentPrompt("bt-agent-1", "bt-channel");
    expect(prompt).toContain("curl");
    expect(prompt).toContain("bt-agent-1");
    expect(prompt).toContain("bt-channel");
    expect(prompt).toContain("http://localhost:7788");
  });

  test("BusTransport.agentPrompt matches generateAgentPrompt output", () => {
    const busUrl = "http://localhost:7788";
    const agentId = "bt-agent-2";
    const channel = "bt-channel-2";
    const transport = new BusTransport(busUrl);
    expect(transport.agentPrompt(agentId, channel)).toBe(
      generateAgentPrompt(agentId, busUrl, channel)
    );
  });
});
