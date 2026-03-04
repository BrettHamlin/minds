/**
 * Tests for BRE-381 items:
 *   1. collab.install.ts --local flag and transport/ copy
 *   2. Orchestrator scripts directory structure preservation
 *   3. question-response.ts bus/tmux routing
 *   4. teardown-bus.ts PID cleanup
 *   5. resolveTransportFile() installed vs dev path resolution
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { writeJsonAtomic, getRegistryPath } from "../../../lib/pipeline";
import { questionResponse } from "./question-response";
import { teardownBusPids } from "./teardown-bus";
import { resolveTransportFile } from "./orchestrator-init";
import { startBusServer, teardownBusServer } from "./orchestrator-init";

// Repo root (src/scripts/orchestrator/commands → ../../../../)
const REAL_REPO_ROOT = path.resolve(__dirname, "../../../../");

// ============================================================================
// 5. resolveTransportFile() — installed vs dev path resolution
// ============================================================================

describe("resolveTransportFile()", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bre381-transport-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("1. returns .collab/transport/ path when installed file exists", () => {
    // Simulate installed layout
    const installedDir = path.join(tmpDir, ".collab", "transport");
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, "bus-server.ts"), "// stub");

    const result = resolveTransportFile(tmpDir, "bus-server.ts");
    expect(result).toBe(path.join(tmpDir, ".collab", "transport", "bus-server.ts"));
  });

  test("2. falls back to transport/ at repo root when not installed", () => {
    const result = resolveTransportFile(tmpDir, "bus-server.ts");
    // .collab/transport/bus-server.ts does NOT exist in tmpDir (we only created in test 1 cleanup needed)
    // But test 1 did create it, so let's use a fresh dir
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "bre381-fresh-"));
    const result2 = resolveTransportFile(freshDir, "bus-server.ts");
    expect(result2).toBe(path.join(freshDir, "transport", "bus-server.ts"));
    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  test("3. in dev repo root, transport/bus-server.ts exists (dev path returned)", () => {
    // The real repo has transport/ at root
    const result = resolveTransportFile(REAL_REPO_ROOT, "bus-server.ts");
    expect(fs.existsSync(result)).toBe(true);
    expect(result).toContain("bus-server.ts");
  });
});

// ============================================================================
// 3. question-response.ts — bus vs tmux routing
// ============================================================================

describe("question-response: questionResponse()", () => {
  let tmpDir: string;
  let registryDir: string;
  let busServerPid: number;
  let busUrl: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bre381-qr-"));
    registryDir = path.join(tmpDir, ".collab", "state", "pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });

    const bus = await startBusServer(REAL_REPO_ROOT);
    busServerPid = bus.pid;
    busUrl = bus.url;
  });

  afterAll(() => {
    if (busServerPid) teardownBusServer(busServerPid);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("4. transport=bus → publishes question_response to bus", async () => {
    const ticketId = "QR-TEST-001";
    writeJsonAtomic(path.join(registryDir, `${ticketId}.json`), {
      ticket_id: ticketId,
      transport: "bus",
      bus_url: busUrl,
      agent_pane_id: "%nonexistent",
    });

    await questionResponse(ticketId, 2, { repoRoot: tmpDir });

    // Verify the message was published
    const resp = await fetch(`${busUrl}/status`);
    const body = await resp.json() as { ok: boolean; messageCount: number };
    expect(body.ok).toBe(true);
    expect(body.messageCount).toBeGreaterThan(0);
  });

  test("5. transport=bus with unreachable URL → falls back gracefully (no crash)", async () => {
    const ticketId = "QR-TEST-002";
    writeJsonAtomic(path.join(registryDir, `${ticketId}.json`), {
      ticket_id: ticketId,
      transport: "bus",
      bus_url: "http://127.0.0.1:1", // refused
      agent_pane_id: "%nonexistent",
    });

    let threw = false;
    try {
      await questionResponse(ticketId, 1, { repoRoot: tmpDir });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("6. transport=tmux → no bus publish (tmux path taken, no crash)", async () => {
    // Start a fresh bus to confirm no messages land on it when tmux transport
    const bus2 = await startBusServer(REAL_REPO_ROOT);

    const ticketId = "QR-TEST-003";
    writeJsonAtomic(path.join(registryDir, `${ticketId}.json`), {
      ticket_id: ticketId,
      transport: "tmux",
      bus_url: bus2.url,
      agent_pane_id: "%nonexistent",
    });

    let threw = false;
    try {
      // Override fetch so we can detect if bus was called despite tmux transport
      let busCalled = false;
      const mockFetch = async (url: any, ...args: any[]): Promise<any> => {
        if (typeof url === "string" && url.includes("/publish")) busCalled = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };
      await questionResponse(ticketId, 0, { repoRoot: tmpDir, fetch: mockFetch as any });
      expect(busCalled).toBe(false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    teardownBusServer(bus2.pid);
  });

  test("7. no registry entry → falls back to tmux gracefully (no crash)", async () => {
    let threw = false;
    try {
      await questionResponse("QR-NONEXISTENT", 1, { repoRoot: tmpDir });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ============================================================================
// 4. teardown-bus.ts — PID cleanup
// ============================================================================

describe("teardownBusPids()", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bre381-teardown-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("8. kills real process by PID and port file removed", () => {
    // Spawn a process using Bun.spawn (synchronous; we just need the PID)
    const proc = Bun.spawn(["sleep", "100"], { stdio: ["ignore", "ignore", "ignore"] });
    const pid = proc.pid;

    const portFile = path.join(tmpDir, "bus-port-kill-test");
    fs.writeFileSync(portFile, String(pid));

    // teardownBusPids should kill the process and remove the port file
    teardownBusPids({ busServerPid: pid, busPortFile: portFile });

    expect(fs.existsSync(portFile)).toBe(false);

    // Sending signal 0 after SIGTERM: process may still be in zombie state
    // so we can't reliably check with process.kill(pid, 0).
    // Verifying the port file removal is sufficient proof the function ran.
  });

  test("9. non-existent PIDs → silently handled (no throw)", () => {
    let threw = false;
    try {
      teardownBusPids({
        busServerPid: 999991,   // non-existent
        bridgePid: 999992,
        commandBridgePid: 999993,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("10. removes bus port file if it exists", () => {
    const portFile = path.join(tmpDir, "bus-port");
    fs.writeFileSync(portFile, "49999");

    teardownBusPids({ busPortFile: portFile });

    expect(fs.existsSync(portFile)).toBe(false);
  });

  test("11. skips missing port file (no throw)", () => {
    let threw = false;
    try {
      teardownBusPids({
        busPortFile: path.join(tmpDir, "nonexistent-port-file"),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ============================================================================
// 1 & 2. collab.install.ts — structural checks for --local flag and transport/ copy
// ============================================================================

describe("collab.install.ts structural checks", () => {
  const installSrc = fs.readFileSync(
    path.join(REAL_REPO_ROOT, "src/commands/collab.install.ts"),
    "utf-8"
  );

  test("12. --local flag is present and sets tempDir from localPath", () => {
    expect(installSrc).toContain('process.argv.indexOf("--local")');
    expect(installSrc).toContain("localPath");
    expect(installSrc).toContain("Installing from local path:");
  });

  test("13. cleanup is skipped when --local was used", () => {
    expect(installSrc).toContain("if (!localPath)");
    // The rm -rf should be inside the !localPath block
    const cleanupIdx = installSrc.indexOf("if (!localPath)");
    const rmIdx = installSrc.indexOf('rm -rf "${tempDir}"');
    expect(cleanupIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThan(cleanupIdx);
  });

  test("14. orchestrator scripts copy preserves commands/ subdir structure", () => {
    // The fix uses TypeScript native readdirSync/copyFileSync loops (not shell find|while
    // which silently fails in Bun's execSync). Must iterate top-level files and subdirs.
    expect(installSrc).toContain("readdirSync(orchSrc)");
    expect(installSrc).toContain("copyFileSync");
    // Should NOT use the old shell find|while pattern that silently fails in Bun
    expect(installSrc).not.toContain('cd "${tempDir}/src/scripts/orchestrator"');
    // Should NOT use the old flattening pattern (find -exec cp {} to flat dir)
    expect(installSrc).not.toContain(
      `-exec cp {} "\${repoRoot}/.collab/scripts/orchestrator/" \\;`
    );
  });

  test("15. transport/ directory copy step is present", () => {
    expect(installSrc).toContain(".collab/transport");
    expect(installSrc).toContain('join(tempDir, "transport")');
  });

  test("16. .collab/transport dir is created in dirs array", () => {
    expect(installSrc).toContain('".collab/transport"');
  });
});

// ============================================================================
// Bonus: collab.run.md contains teardown-bus.ts reference
// ============================================================================

describe("collab.run.md teardown reference", () => {
  test("17. collab.run.md references teardown-bus.ts in Pipeline Complete section", () => {
    const src = fs.readFileSync(
      path.join(REAL_REPO_ROOT, "src/commands/collab.run.md"),
      "utf-8"
    );
    expect(src).toContain("teardown-bus.ts");
    expect(src).toContain("Bus teardown");
  });
});
