import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import type { MindDescription } from "./mind.js";
import { dispatchToMind, waitForCompletion, dispatchWave, loadMindsRegistry } from "./dispatch.js";

// --- Fixtures ---

const mindA: MindDescription = {
  name: "signals",
  domain: "Signal emission and transport",
  keywords: ["signal", "emit"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals"],
};

const mindB: MindDescription = {
  name: "pipeline_core",
  domain: "Pipeline lifecycle management",
  keywords: ["pipeline", "lifecycle"],
  owns_files: ["minds/pipeline_core/"],
  capabilities: ["load pipeline config"],
};

const DEV_PANE_OUTPUT = JSON.stringify({
  mind_pane: "%0",
  drone_pane: "%1234",
  worktree: "/tmp/test-worktree",
  branch: "drone/test-branch",
  base: "main",
});

// --- Helpers ---

function makeTempRegistry(minds: MindDescription[]): { repoRoot: string; cleanup: () => void } {
  const repoRoot = mkdtempSync("/tmp/dispatch-test-");
  mkdirSync(join(repoRoot, ".collab"), { recursive: true });
  writeFileSync(join(repoRoot, ".collab/minds.json"), JSON.stringify(minds));
  return { repoRoot, cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

/** Create a minimal mock Subprocess for spyOn(Bun, "spawn") */
function makeProcess(exitCode: number, stdout: string, stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    pid: 99999,
    kill: () => {},
    stdin: null,
    readable: null,
    writable: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// --- loadMindsRegistry ---

describe("loadMindsRegistry", () => {
  it("loads and parses a valid registry file", () => {
    const { repoRoot, cleanup } = makeTempRegistry([mindA, mindB]);
    try {
      const registry = loadMindsRegistry(join(repoRoot, ".collab/minds.json"));
      expect(registry).toHaveLength(2);
      expect(registry[0].name).toBe("signals");
      expect(registry[1].name).toBe("pipeline_core");
    } finally {
      cleanup();
    }
  });

  it("throws when registry file does not exist", () => {
    expect(() => loadMindsRegistry("/tmp/nonexistent-minds.json")).toThrow();
  });
});

// --- dispatchToMind ---

describe("dispatchToMind", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>;
  let repoRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = makeTempRegistry([mindA, mindB]);
    repoRoot = tmp.repoRoot;
    cleanup = tmp.cleanup;

    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) {
        return makeProcess(0, DEV_PANE_OUTPUT);
      }
      if (args.some((a) => a.includes("tmux-send.ts"))) {
        return makeProcess(0, "");
      }
      return makeProcess(0, "");
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    cleanup();
  });

  it("resolves with paneId, worktree, branch on success", async () => {
    const result = await dispatchToMind("signals", "Do the work", { repoRoot });
    expect(result.paneId).toBe("%1234");
    expect(result.worktree).toBe("/tmp/test-worktree");
    expect(result.branch).toBe("drone/test-branch");
  });

  it("throws for unknown mind name", async () => {
    await expect(
      dispatchToMind("nonexistent", "brief", { repoRoot })
    ).rejects.toThrow('Mind not found in registry: "nonexistent"');
  });

  it("does not throw for known mind name", async () => {
    await expect(dispatchToMind("signals", "brief", { repoRoot })).resolves.toBeDefined();
  });

  it("also accepts pipeline_core (second mind in registry)", async () => {
    const result = await dispatchToMind("pipeline_core", "brief", { repoRoot });
    expect(result.paneId).toBe("%1234");
  });

  it("spawns dev-pane.ts", async () => {
    await dispatchToMind("signals", "brief", { repoRoot });
    const calls = spawnSpy.mock.calls;
    const hasDevPane = calls.some((c) =>
      (c[0] as string[]).some((a) => a.includes("dev-pane.ts"))
    );
    expect(hasDevPane).toBe(true);
  });

  it("spawns tmux-send.ts after dev-pane.ts succeeds", async () => {
    await dispatchToMind("signals", "brief", { repoRoot });
    const calls = spawnSpy.mock.calls;
    const hasTmuxSend = calls.some((c) =>
      (c[0] as string[]).some((a) => a.includes("tmux-send.ts"))
    );
    expect(hasTmuxSend).toBe(true);
  });

  it("passes --branch option to dev-pane.ts", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, branch: "my-branch" });
    const devPaneCall = spawnSpy.mock.calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("dev-pane.ts"))
    );
    expect(devPaneCall).toBeDefined();
    const args = devPaneCall![0] as string[];
    expect(args).toContain("--branch");
    expect(args).toContain("my-branch");
  });

  it("passes --base option to dev-pane.ts", async () => {
    await dispatchToMind("signals", "brief", { repoRoot, base: "dev" });
    const devPaneCall = spawnSpy.mock.calls.find((c) =>
      (c[0] as string[]).some((a) => a.includes("dev-pane.ts"))
    );
    const args = devPaneCall![0] as string[];
    expect(args).toContain("--base");
    expect(args).toContain("dev");
  });

  it("throws when dev-pane.ts exits non-zero", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) {
        return makeProcess(1, "", "pane creation failed");
      }
      return makeProcess(0, "");
    });
    await expect(dispatchToMind("signals", "brief", { repoRoot })).rejects.toThrow(
      "dev-pane.ts failed"
    );
  });

  it("throws when dev-pane.ts returns invalid JSON", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) {
        return makeProcess(0, "not json at all");
      }
      return makeProcess(0, "");
    });
    await expect(dispatchToMind("signals", "brief", { repoRoot })).rejects.toThrow(
      "invalid JSON"
    );
  });

  it("throws when tmux-send.ts exits non-zero", async () => {
    spawnSpy.mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) {
        return makeProcess(0, DEV_PANE_OUTPUT);
      }
      if (args.some((a) => a.includes("tmux-send.ts"))) {
        return makeProcess(1, "", "send failed");
      }
      return makeProcess(0, "");
    });
    await expect(dispatchToMind("signals", "brief", { repoRoot })).rejects.toThrow(
      "tmux-send.ts failed"
    );
  });
});

// --- waitForCompletion ---

describe("waitForCompletion", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  it("returns success when MIND_COMPLETE signal is in pane output", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "some output\nMIND_COMPLETE @signals\nmore lines")
    );

    const result = await waitForCompletion("%1234", "signals", {
      pollIntervalMs: 0,
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("MIND_COMPLETE @signals");
  });

  it("returns failure on timeout when signal is never found", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "still working... no signal here")
    );

    const result = await waitForCompletion("%1234", "signals", {
      pollIntervalMs: 0,
      timeoutMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
  });

  it("polls tmux capture-pane with the correct pane ID", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "MIND_COMPLETE @pipeline_core")
    );

    await waitForCompletion("%9999", "pipeline_core", { pollIntervalMs: 0, timeoutMs: 1000 });

    const firstCall = spawnSpy.mock.calls[0];
    const args = firstCall[0] as string[];
    expect(args).toEqual(["tmux", "capture-pane", "-t", "%9999", "-p"]);
  });

  it("does not match a different mind's MIND_COMPLETE signal", async () => {
    // Output contains signals completion, but we're waiting for pipeline_core
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      makeProcess(0, "MIND_COMPLETE @signals")
    );

    const result = await waitForCompletion("%1234", "pipeline_core", {
      pollIntervalMs: 0,
      timeoutMs: 0,
    });

    expect(result.success).toBe(false);
  });

  it("returns output string on success", async () => {
    const paneContent = "line1\nline2\nMIND_COMPLETE @signals\nline3";
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => makeProcess(0, paneContent));

    const result = await waitForCompletion("%1234", "signals", {
      pollIntervalMs: 0,
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe(paneContent);
  });
});

// --- dispatchWave ---

describe("dispatchWave", () => {
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>;
  let repoRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = makeTempRegistry([mindA, mindB]);
    repoRoot = tmp.repoRoot;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    spawnSpy?.mockRestore();
    cleanup();
  });

  it("returns CompletionResult for each mind in the wave", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      if (args.some((a) => a.includes("tmux-send.ts"))) return makeProcess(0, "");
      // tmux capture-pane — both minds complete
      return makeProcess(0, "MIND_COMPLETE @signals\nMIND_COMPLETE @pipeline_core");
    });

    const results = await dispatchWave(
      ["signals", "pipeline_core"],
      { signals: "signals brief", pipeline_core: "pipeline brief" },
      { dispatch: { repoRoot }, wait: { pollIntervalMs: 0, timeoutMs: 5000 } }
    );

    expect(results).toHaveProperty("signals");
    expect(results).toHaveProperty("pipeline_core");
    expect(results.signals.success).toBe(true);
    expect(results.pipeline_core.success).toBe(true);
  });

  it("dispatches all minds — dev-pane.ts called once per mind", async () => {
    let devPaneCallCount = 0;
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) {
        devPaneCallCount++;
        return makeProcess(0, DEV_PANE_OUTPUT);
      }
      if (args.some((a) => a.includes("tmux-send.ts"))) return makeProcess(0, "");
      return makeProcess(0, "MIND_COMPLETE @signals\nMIND_COMPLETE @pipeline_core");
    });

    await dispatchWave(
      ["signals", "pipeline_core"],
      { signals: "brief A", pipeline_core: "brief B" },
      { dispatch: { repoRoot }, wait: { pollIntervalMs: 0, timeoutMs: 5000 } }
    );

    expect(devPaneCallCount).toBe(2);
  });

  it("throws if brief is missing for a mind", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => makeProcess(0, ""));

    await expect(
      dispatchWave(["signals"], {}, { dispatch: { repoRoot } })
    ).rejects.toThrow('No brief provided for mind: "signals"');
  });

  it("handles single-mind wave", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      if (args.some((a) => a.includes("tmux-send.ts"))) return makeProcess(0, "");
      return makeProcess(0, "MIND_COMPLETE @signals");
    });

    const results = await dispatchWave(
      ["signals"],
      { signals: "brief" },
      { dispatch: { repoRoot }, wait: { pollIntervalMs: 0, timeoutMs: 5000 } }
    );

    expect(Object.keys(results)).toHaveLength(1);
    expect(results.signals.success).toBe(true);
  });

  it("returns failure for minds that time out", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
      if (args.some((a) => a.includes("dev-pane.ts"))) return makeProcess(0, DEV_PANE_OUTPUT);
      if (args.some((a) => a.includes("tmux-send.ts"))) return makeProcess(0, "");
      // No completion signal — pane output never contains MIND_COMPLETE
      return makeProcess(0, "still running...");
    });

    const results = await dispatchWave(
      ["signals"],
      { signals: "brief" },
      { dispatch: { repoRoot }, wait: { pollIntervalMs: 0, timeoutMs: 0 } }
    );

    expect(results.signals.success).toBe(false);
  });
});
