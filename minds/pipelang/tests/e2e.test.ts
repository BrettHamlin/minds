// E2E: Verify compiled collab.pipeline output is consumable by orchestrator scripts
//
// These tests simulate the exact jq queries used in the orchestrator shell scripts
// to ensure the compiled pipeline.json format matches what the scripts expect.
// If any of these tests fail, the orchestrator scripts will break at runtime.

import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const CLI = join(import.meta.dir, "../cli.ts");
const GOLDEN_FILE = join(import.meta.dir, "../collab.pipeline");

let compiledJson: string;
let compiled: Record<string, unknown>;
let tmpPath: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

function jq(filter: string, args: Record<string, string> = {}): { stdout: string; ok: boolean } {
  const argList: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    argList.push("--arg", key, val);
  }
  const result = spawnSync(["jq", "-r", ...argList, filter, tmpPath]);
  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    ok: result.exitCode === 0,
  };
}

function jqc(filter: string, args: Record<string, string> = {}): { stdout: string; ok: boolean } {
  const argList: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    argList.push("--arg", key, val);
  }
  const result = spawnSync(["jq", "-c", ...argList, filter, tmpPath]);
  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    ok: result.exitCode === 0,
  };
}

beforeAll(() => {
  const result = spawnSync(["bun", CLI, "compile", GOLDEN_FILE]);
  compiledJson = new TextDecoder().decode(result.stdout);
  compiled = JSON.parse(compiledJson);

  tmpPath = join(import.meta.dir, "_e2e_pipeline_tmp.json");
  writeFileSync(tmpPath, compiledJson);
});

// Cleanup is intentionally omitted — bun test doesn't run afterAll on crash.
// The file is tiny and gitignored via tests/_*.

// ── Schema shape ──────────────────────────────────────────────────────────────

describe("e2e: compiled schema shape", () => {
  test("version is 3.1", () => {
    expect((compiled as { version: string }).version).toBe("3.1");
  });

  test("phases is an object (not array)", () => {
    expect(Array.isArray((compiled as { phases: unknown }).phases)).toBe(false);
    expect(typeof (compiled as { phases: unknown }).phases).toBe("object");
  });

  test("phases has 9 keys in declaration order", () => {
    const keys = Object.keys((compiled as { phases: Record<string, unknown> }).phases);
    expect(keys).toEqual(["clarify", "plan", "tasks", "analyze", "implement", "run_tests", "visual_verify", "blindqa", "done"]);
  });

  test("gates is an object keyed by name", () => {
    const g = (compiled as { gates: Record<string, unknown> }).gates;
    expect(typeof g).toBe("object");
    expect(Object.keys(g)).toContain("plan_review");
    expect(Object.keys(g)).toContain("analyze_review");
  });

  test("gates use 'on' key (not 'responses')", () => {
    const g = (compiled as { gates: Record<string, Record<string, unknown>> }).gates;
    expect(g["plan_review"]["on"]).toBeDefined();
    expect(g["plan_review"]["responses"]).toBeUndefined();
  });

  test("gate response fields are camelCase (maxRetries, onExhaust)", () => {
    type GateResponse = { maxRetries?: number; onExhaust?: string; max_retries?: number; on_exhaust?: string };
    const g = (compiled as { gates: Record<string, { on: Record<string, GateResponse> }> }).gates;
    const revResp = g["plan_review"].on["REVISION_NEEDED"];
    expect(revResp.maxRetries).toBeDefined();
    expect(revResp.onExhaust).toBeDefined();
    expect(revResp.max_retries).toBeUndefined();
    expect(revResp.on_exhaust).toBeUndefined();
  });

  test("phases have embedded transitions (no top-level transitions array)", () => {
    const c = compiled as Record<string, unknown>;
    expect(c["transitions"]).toBeUndefined();
  });
});

// ── signal-validate.sh queries ────────────────────────────────────────────────

describe("e2e: signal-validate.sh jq queries", () => {
  test(".phases[id].signals returns space-joined list for clarify", () => {
    const { stdout, ok } = jq('.phases[$id].signals // [] | join(" ")', { id: "clarify" });
    expect(ok).toBe(true);
    expect(stdout).toBe("CLARIFY_COMPLETE CLARIFY_QUESTION CLARIFY_ERROR CLARIFY_QUESTIONS");
  });

  test(".phases[id].signals returns all blindqa signals", () => {
    const { stdout, ok } = jq('.phases[$id].signals // [] | join(" ")', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(stdout).toContain("BLINDQA_COMPLETE");
    expect(stdout).toContain("BLINDQA_QUESTION");
    expect(stdout).toContain("BLINDQA_WAITING");
  });

  test(".phases[id].signals returns empty string for unknown phase", () => {
    const { stdout, ok } = jq('.phases[$id].signals // [] | join(" ")', { id: "nonexistent" });
    expect(ok).toBe(true);
    expect(stdout).toBe("");
  });

  test("CLARIFY_COMPLETE is in clarify signals", () => {
    const { stdout } = jq('.phases[$id].signals // [] | join(" ")', { id: "clarify" });
    expect(stdout.split(" ")).toContain("CLARIFY_COMPLETE");
  });
});

// ── goal-gate-check.sh queries ────────────────────────────────────────────────

describe("e2e: goal-gate-check.sh jq queries", () => {
  test(".phases[id].terminal is true for done", () => {
    const { stdout, ok } = jq('.phases[$id].terminal // false', { id: "done" });
    expect(ok).toBe(true);
    expect(stdout).toBe("true");
  });

  test(".phases[id].terminal is false for clarify", () => {
    const { stdout, ok } = jq('.phases[$id].terminal // false', { id: "clarify" });
    expect(ok).toBe(true);
    expect(stdout).toBe("false");
  });

  test(".phases[id].terminal is false for blindqa", () => {
    const { stdout, ok } = jq('.phases[$id].terminal // false', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(stdout).toBe("false");
  });

  test("gated phases query returns blindqa with goal_gate: always", () => {
    const { stdout, ok } = jqc(
      '[.phases | to_entries[] | select(.value.goal_gate != null) | {id: .key, goal_gate: .value.goal_gate}]'
    );
    expect(ok).toBe(true);
    const gated = JSON.parse(stdout) as Array<{ id: string; goal_gate: string }>;
    expect(gated).toHaveLength(1);
    expect(gated[0]).toEqual({ id: "blindqa", goal_gate: "always" });
  });
});

// ── phase-advance.sh queries ──────────────────────────────────────────────────

describe("e2e: phase-advance.sh jq queries", () => {
  test("index of clarify is 0", () => {
    const { stdout, ok } = jq('(.phases | keys_unsorted | index($id)) // empty', { id: "clarify" });
    expect(ok).toBe(true);
    expect(Number(stdout)).toBe(0);
  });

  test("index of done is 8", () => {
    const { stdout, ok } = jq('(.phases | keys_unsorted | index($id)) // empty', { id: "done" });
    expect(ok).toBe(true);
    expect(Number(stdout)).toBe(8);
  });

  test("index of nonexistent phase is empty", () => {
    const { stdout, ok } = jq('(.phases | keys_unsorted | index($id)) // empty', { id: "ghost" });
    expect(ok).toBe(true);
    expect(stdout).toBe("");
  });

  test("keys_unsorted preserves declaration order", () => {
    const { stdout, ok } = jq('[.phases | keys_unsorted[]] | join(", ")', {});
    expect(ok).toBe(true);
    expect(stdout).toBe("clarify, plan, tasks, analyze, implement, run_tests, visual_verify, blindqa, done");
  });

  test("key at index 0 is clarify (first phase)", () => {
    const { stdout, ok } = jq('.phases | keys_unsorted | .[0]', {});
    expect(ok).toBe(true);
    expect(stdout).toBe("clarify");
  });

  test("key at index 1 is plan (second phase)", () => {
    const { stdout, ok } = jq('.phases | keys_unsorted | .[1]', {});
    expect(ok).toBe(true);
    expect(stdout).toBe("plan");
  });

  test("phase count is 9", () => {
    const { stdout, ok } = jq('.phases | keys_unsorted | length', {});
    expect(ok).toBe(true);
    expect(Number(stdout)).toBe(9);
  });
});

// ── phase-dispatch.sh queries ─────────────────────────────────────────────────

describe("e2e: phase-dispatch.sh jq queries", () => {
  test(".phases[id].command returns /collab.clarify for clarify", () => {
    const { stdout, ok } = jq('.phases[$id].command // empty', { id: "clarify" });
    expect(ok).toBe(true);
    expect(stdout).toBe("/collab.clarify");
  });

  test(".phases[id].command is empty for implement (uses actions)", () => {
    const { stdout, ok } = jq('.phases[$id].command // empty', { id: "implement" });
    expect(ok).toBe(true);
    expect(stdout).toBe("");
  });

  test("if .phases[id].actions returns 'yes' for blindqa", () => {
    const { stdout, ok } = jq('if .phases[$id].actions then "yes" else empty end', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(stdout).toBe("yes");
  });

  test("if .phases[id].actions returns empty for clarify (no actions)", () => {
    const { stdout, ok } = jq('if .phases[$id].actions then "yes" else empty end', { id: "clarify" });
    expect(ok).toBe(true);
    expect(stdout).toBe("");
  });

  test(".phases[id] not-null check returns id for done", () => {
    const { stdout, ok } = jq('if .phases[$id] != null then $id else empty end', { id: "done" });
    expect(ok).toBe(true);
    expect(stdout).toBe("done");
  });

  test(".phases[id] not-null check returns empty for ghost phase", () => {
    const { stdout, ok } = jq('if .phases[$id] != null then $id else empty end', { id: "ghost" });
    expect(ok).toBe(true);
    expect(stdout).toBe("");
  });

  test(".phases[id].actions | length returns 2 for blindqa", () => {
    const { stdout, ok } = jq('.phases[$id].actions | length', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(Number(stdout)).toBe(2);
  });

  test("blindqa action[0] is display type", () => {
    const { stdout, ok } = jq('.phases[$id].actions[0] | keys[0]', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(stdout).toBe("display");
  });

  test("blindqa action[1] is command type", () => {
    const { stdout, ok } = jq('.phases[$id].actions[1] | keys[0]', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(stdout).toBe("command");
  });

  test("blindqa action[1] command value is /collab.blindqa", () => {
    const { stdout, ok } = jq('.phases[$id].actions[1].command', { id: "blindqa" });
    expect(ok).toBe(true);
    expect(stdout).toBe("/collab.blindqa");
  });
});

// ── transition-resolve.sh queries ────────────────────────────────────────────

describe("e2e: transition-resolve.sh jq queries", () => {
  test("clarify CLARIFY_COMPLETE → direct to plan (no conditionals)", () => {
    const cond = jqc(
      '(.phases[$from].conditionalTransitions // []) | map(select(.signal == $signal))',
      { from: "clarify", signal: "CLARIFY_COMPLETE" }
    );
    const direct = jqc('.phases[$from].transitions[$signal] // empty', {
      from: "clarify",
      signal: "CLARIFY_COMPLETE",
    });
    expect(JSON.parse(cond.stdout)).toHaveLength(0);
    expect(JSON.parse(direct.stdout)).toEqual({ to: "plan" });
  });

  test("plan PLAN_COMPLETE → direct gate plan_review (no conditionals)", () => {
    const cond = jqc(
      '(.phases[$from].conditionalTransitions // []) | map(select(.signal == $signal))',
      { from: "plan", signal: "PLAN_COMPLETE" }
    );
    const direct = jqc('.phases[$from].transitions[$signal] // empty', {
      from: "plan",
      signal: "PLAN_COMPLETE",
    });
    expect(JSON.parse(cond.stdout)).toHaveLength(0);
    expect(JSON.parse(direct.stdout)).toEqual({ gate: "plan_review" });
  });

  test("implement IMPLEMENT_COMPLETE → 2 conditional rows (no direct)", () => {
    const cond = jqc(
      '(.phases[$from].conditionalTransitions // []) | map(select(.signal == $signal))',
      { from: "implement", signal: "IMPLEMENT_COMPLETE" }
    );
    const direct = jqc('.phases[$from].transitions[$signal] // empty', {
      from: "implement",
      signal: "IMPLEMENT_COMPLETE",
    });
    const condRows = JSON.parse(cond.stdout) as Array<{ signal: string; if?: string; to?: string }>;
    expect(condRows).toHaveLength(2);
    expect(condRows[0]).toEqual({ signal: "IMPLEMENT_COMPLETE", if: "hasGroup", to: "tasks" });
    expect(condRows[1]).toEqual({ signal: "IMPLEMENT_COMPLETE", to: "run_tests" });
    expect(direct.stdout).toBe("");
  });

  test("implement IMPLEMENT_ERROR → direct self-loop (no conditionals)", () => {
    const cond = jqc(
      '(.phases[$from].conditionalTransitions // []) | map(select(.signal == $signal))',
      { from: "implement", signal: "IMPLEMENT_ERROR" }
    );
    const direct = jqc('.phases[$from].transitions[$signal] // empty', {
      from: "implement",
      signal: "IMPLEMENT_ERROR",
    });
    expect(JSON.parse(cond.stdout)).toHaveLength(0);
    expect(JSON.parse(direct.stdout)).toEqual({ to: "implement" });
  });

  test("blindqa BLINDQA_COMPLETE → direct to done (no conditionals)", () => {
    const direct = jqc('.phases[$from].transitions[$signal] // empty', {
      from: "blindqa",
      signal: "BLINDQA_COMPLETE",
    });
    expect(JSON.parse(direct.stdout)).toEqual({ to: "done" });
  });

  test("nonexistent signal returns empty from both paths", () => {
    const cond = jqc(
      '(.phases[$from].conditionalTransitions // []) | map(select(.signal == $signal))',
      { from: "clarify", signal: "FAKE_SIGNAL" }
    );
    const direct = jqc('.phases[$from].transitions[$signal] // empty', {
      from: "clarify",
      signal: "FAKE_SIGNAL",
    });
    expect(JSON.parse(cond.stdout)).toHaveLength(0);
    expect(direct.stdout).toBe("");
  });
});

// ── Gate field access ─────────────────────────────────────────────────────────

describe("e2e: gate field access (collab.run.md queries)", () => {
  test(".gates[$gate].on[$resp] returns correct response for APPROVED", () => {
    const { stdout, ok } = jqc('.gates[$gate].on[$resp]', { gate: "plan_review", resp: "APPROVED" });
    expect(ok).toBe(true);
    expect(JSON.parse(stdout)).toEqual({ to: "tasks" });
  });

  test(".gates[$gate].on[$resp] returns full retry config for REVISION_NEEDED", () => {
    const { stdout, ok } = jqc('.gates[$gate].on[$resp]', {
      gate: "plan_review",
      resp: "REVISION_NEEDED",
    });
    expect(ok).toBe(true);
    expect(JSON.parse(stdout)).toEqual({
      to: "plan",
      feedback: "enrich",
      maxRetries: 3,
      onExhaust: "skip",
    });
  });

  test(".gates[$gate].on[$resp] for ESCALATION has no 'to' field", () => {
    const { stdout, ok } = jqc('.gates[$gate].on[$resp]', {
      gate: "analyze_review",
      resp: "ESCALATION",
    });
    expect(ok).toBe(true);
    const resp = JSON.parse(stdout) as Record<string, unknown>;
    expect(resp["to"]).toBeUndefined();
    expect(resp["onExhaust"]).toBe("abort");
  });

  test(".gates[$gate].skipTo returns tasks for plan_review", () => {
    const { stdout, ok } = jq('.gates[$gate].skipTo // empty', { gate: "plan_review" });
    expect(ok).toBe(true);
    expect(stdout).toBe("tasks");
  });
});
