// BRE-303: Slice 4 — Orchestrator-agent communication (runtime)
//
// These tests prove the pipelang runner can execute compiled pipelines through
// real tmux agent panes. Stub agents (bash scripts) replace claude so tests
// are fast, deterministic, and require no network.
//
// All tests require tmux to be available. They are skipped otherwise.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, chmodSync, unlinkSync, existsSync } from "fs";
import { spawnSync } from "bun";
import { runPipeline, type RunOptions, type AgentLifecycle } from "../src/runner";
import type { CompiledPipeline } from "../src/compiler";

// ── Environment check ─────────────────────────────────────────────────────────

const TMUX_OK = spawnSync(["which", "tmux"]).exitCode === 0;

// Conditional test registration: skip if tmux is unavailable
function tmuxTest(
  name: string,
  fn: () => Promise<void>,
  timeoutMs = 60_000
): void {
  if (!TMUX_OK) {
    test.skip(name, fn);
  } else {
    test(name, fn, timeoutMs);
  }
}

// ── Stub agent helpers ────────────────────────────────────────────────────────

/**
 * Write a stub bash script that emits `signal` after `delayMs`, then keeps
 * the pane alive for `keepAliveSec` seconds so the runner can capture it.
 */
function makeStub(path: string, signal: string, delayMs = 150, keepAliveSec = 15): void {
  const script = [
    "#!/bin/bash",
    `sleep ${(delayMs / 1000).toFixed(3)}`,
    `echo "[SIGNAL] ${signal}"`,
    `sleep ${keepAliveSec}`,
  ].join("\n");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

/**
 * Build a RunOptions.agentLifecycle factory that maps phase names to stub scripts.
 * Each stub path must exist before the pipeline runs.
 */
function stubLifecycle(stubs: Record<string, string>): NonNullable<RunOptions["agentLifecycle"]> {
  return (phaseName: string, _phaseCommand: string): AgentLifecycle => {
    const stubPath = stubs[phaseName];
    if (!stubPath) throw new Error(`No stub configured for phase '${phaseName}'`);
    return { windowCmd: `bash ${stubPath}` };
  };
}

// ── Compiled pipeline fixtures ────────────────────────────────────────────────

const TWO_PHASE: CompiledPipeline = {
  version: "3.1",
  phases: {
    clarify: {
      command: "/collab.clarify",
      signals: ["CLARIFY_COMPLETE"],
      transitions: { CLARIFY_COMPLETE: { to: "done" } },
    },
    done: { terminal: true },
  },
};

const THREE_PHASE: CompiledPipeline = {
  version: "3.1",
  phases: {
    clarify: {
      command: "/collab.clarify",
      signals: ["CLARIFY_COMPLETE"],
      transitions: { CLARIFY_COMPLETE: { to: "plan" } },
    },
    plan: {
      command: "/collab.plan",
      signals: ["PLAN_COMPLETE"],
      transitions: { PLAN_COMPLETE: { to: "done" } },
    },
    done: { terminal: true },
  },
};

// ── Test setup ────────────────────────────────────────────────────────────────

const STUB_DIR = "/tmp/pipelang-slice4-stubs";
const ARTIFACT_FILE = "/tmp/pipelang-slice4-artifact.txt";

beforeAll(() => {
  spawnSync(["mkdir", "-p", STUB_DIR]);
});

afterAll(() => {
  spawnSync(["rm", "-rf", STUB_DIR]);
  if (existsSync(ARTIFACT_FILE)) unlinkSync(ARTIFACT_FILE);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runPipeline() — slice 4: runtime lifecycle", () => {
  // AC1 / AC3: Two-phase pipeline completes — basic smoke test
  tmuxTest("two-phase pipeline runs to completion", async () => {
    const clarifyStub = `${STUB_DIR}/clarify-basic.sh`;
    makeStub(clarifyStub, "CLARIFY_COMPLETE");

    const result = await runPipeline(TWO_PHASE, {
      agentLifecycle: stubLifecycle({ clarify: clarifyStub }),
      signalTimeoutMs: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toEqual({ phase: "clarify", signal: "CLARIFY_COMPLETE" });
  });

  // AC1 / AC3: 10/10 reliability — the core requirement of this slice
  tmuxTest(
    "two-phase pipeline: 10/10 reliability",
    async () => {
      const clarifyStub = `${STUB_DIR}/clarify-reliability.sh`;
      makeStub(clarifyStub, "CLARIFY_COMPLETE", 100, 15);

      const RUNS = 10;
      let passed = 0;

      for (let i = 0; i < RUNS; i++) {
        const result = await runPipeline(TWO_PHASE, {
          agentLifecycle: stubLifecycle({ clarify: clarifyStub }),
          signalTimeoutMs: 10_000,
        });

        if (result.success) {
          passed++;
        } else {
          // Surface the failure reason for debugging
          console.error(`Run ${i + 1} failed: ${result.error}`);
        }
      }

      expect(passed).toBe(RUNS); // must be 10/10
    },
    120_000 // 2 min for 10 runs
  );

  // AC2: Three-phase pipeline with a separate agent pane per phase
  tmuxTest("three-phase pipeline: separate agent per phase", async () => {
    const clarifyStub = `${STUB_DIR}/clarify-3phase.sh`;
    const planStub = `${STUB_DIR}/plan-3phase.sh`;
    makeStub(clarifyStub, "CLARIFY_COMPLETE");
    makeStub(planStub, "PLAN_COMPLETE");

    const result = await runPipeline(THREE_PHASE, {
      agentLifecycle: stubLifecycle({ clarify: clarifyStub, plan: planStub }),
      signalTimeoutMs: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0]).toEqual({ phase: "clarify", signal: "CLARIFY_COMPLETE" });
    expect(result.phases[1]).toEqual({ phase: "plan", signal: "PLAN_COMPLETE" });
  });

  // AC4: Signal capture works (verifies the poll + pane capture mechanism)
  tmuxTest("signal capture works within timeout", async () => {
    const clarifyStub = `${STUB_DIR}/clarify-delayed.sh`;
    // Signal emitted after 2 seconds — tests that polling loop keeps running
    makeStub(clarifyStub, "CLARIFY_COMPLETE", 2_000);

    const result = await runPipeline(TWO_PHASE, {
      agentLifecycle: stubLifecycle({ clarify: clarifyStub }),
      signalTimeoutMs: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.phases[0].signal).toBe("CLARIFY_COMPLETE");
  });

  // AC4: Timeout returns a clean error
  tmuxTest("signal timeout produces error result", async () => {
    const clarifyStub = `${STUB_DIR}/clarify-silent.sh`;
    // This stub never emits a signal
    writeFileSync(clarifyStub, "#!/bin/bash\nsleep 60\n");
    chmodSync(clarifyStub, 0o755);

    const result = await runPipeline(TWO_PHASE, {
      agentLifecycle: stubLifecycle({ clarify: clarifyStub }),
      signalTimeoutMs: 500, // very short timeout
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Timeout");
    expect(result.error).toContain("clarify");
  });

  // AC5: Artifacts from phase N are available to phase N+1
  tmuxTest("artifacts from phase N available to phase N+1", async () => {
    // Phase 1 (clarify) writes an artifact file, then emits its signal
    const clarifyStub = `${STUB_DIR}/clarify-artifact-writer.sh`;
    writeFileSync(
      clarifyStub,
      [
        "#!/bin/bash",
        `echo "artifact-from-clarify" > ${ARTIFACT_FILE}`,
        'echo "[SIGNAL] CLARIFY_COMPLETE"',
        "sleep 15",
      ].join("\n")
    );
    chmodSync(clarifyStub, 0o755);

    // Phase 2 (plan) reads the artifact; only emits PLAN_COMPLETE if it exists
    const planStub = `${STUB_DIR}/plan-artifact-reader.sh`;
    writeFileSync(
      planStub,
      [
        "#!/bin/bash",
        `if [ -f "${ARTIFACT_FILE}" ] && grep -q "artifact-from-clarify" "${ARTIFACT_FILE}"; then`,
        '  echo "[SIGNAL] PLAN_COMPLETE"',
        "else",
        '  echo "[SIGNAL] PLAN_FAILED: artifact not found"',
        "fi",
        "sleep 15",
      ].join("\n")
    );
    chmodSync(planStub, 0o755);

    const result = await runPipeline(THREE_PHASE, {
      agentLifecycle: stubLifecycle({ clarify: clarifyStub, plan: planStub }),
      signalTimeoutMs: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[1].signal).toBe("PLAN_COMPLETE"); // not PLAN_FAILED
  });

  // Terminal-only pipeline terminates immediately without opening any pane
  tmuxTest("terminal-only pipeline completes without panes", async () => {
    const terminalOnly: CompiledPipeline = {
      version: "3.1",
      phases: { done: { terminal: true } },
    };

    const result = await runPipeline(terminalOnly, {
      agentLifecycle: () => ({ windowCmd: "echo should-not-run" }),
    });

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(0);
  });

  // Self-referencing retry loop: phase loops back to itself on error, then completes
  tmuxTest("self-referencing retry loop (phase → self → done)", async () => {
    const retryPipeline: CompiledPipeline = {
      version: "3.1",
      phases: {
        clarify: {
          command: "/collab.clarify",
          signals: ["CLARIFY_COMPLETE", "CLARIFY_ERROR"],
          transitions: {
            CLARIFY_COMPLETE: { to: "done" },
            CLARIFY_ERROR: { to: "clarify" }, // loop back
          },
        },
        done: { terminal: true },
      },
    };

    let callCount = 0;

    // First call: emit ERROR (retry), second call: emit COMPLETE (finish)
    const firstStub = `${STUB_DIR}/clarify-retry-first.sh`;
    const secondStub = `${STUB_DIR}/clarify-retry-second.sh`;
    makeStub(firstStub, "CLARIFY_ERROR", 100);
    makeStub(secondStub, "CLARIFY_COMPLETE", 100);

    const lifecycle = (_phaseName: string, _cmd: string): AgentLifecycle => {
      callCount++;
      return { windowCmd: `bash ${callCount === 1 ? firstStub : secondStub}` };
    };

    const result = await runPipeline(retryPipeline, {
      agentLifecycle: lifecycle,
      signalTimeoutMs: 10_000,
    });

    expect(result.success).toBe(true);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0]).toEqual({ phase: "clarify", signal: "CLARIFY_ERROR" });
    expect(result.phases[1]).toEqual({ phase: "clarify", signal: "CLARIFY_COMPLETE" });
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang run — CLI (slice 4)", () => {
  const { join } = require("path");
  const { writeFileSync } = require("fs");
  const CLI = join(import.meta.dir, "../cli.ts");

  function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const r = spawnSync(["bun", CLI, ...args]);
    return {
      stdout: new TextDecoder().decode(r.stdout),
      stderr: new TextDecoder().decode(r.stderr),
      exitCode: r.exitCode ?? 1,
    };
  }

  test("compile subcommand still works (regression)", () => {
    const tmp = "/tmp/pipelang-slice4-cli-test.pipeline";
    writeFileSync(tmp, "phase(done)\n    .terminal()");
    const { exitCode, stdout } = runCLI(["compile", tmp]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.phases.done.terminal).toBe(true);
  });

  test("run with unknown command exits 1", () => {
    expect(runCLI(["bogus"]).exitCode).toBe(1);
  });

  test("run --compiled with missing file exits 1", () => {
    const { exitCode, stderr } = runCLI(["run", "--compiled", "/tmp/no-such-file.json"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("cannot read");
  });
});
