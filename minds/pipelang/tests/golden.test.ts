// BRE-309: Slice 10 — Full pipeline golden test
// Compiles collab.pipeline and validates semantic equivalence with pipeline.json
import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
import { validate } from "../src/validator";
import { spawnSync } from "bun";
import { readFileSync } from "fs";
import { join } from "path";

const CLI = join(import.meta.dir, "../cli.ts");
const GOLDEN_FILE = join(import.meta.dir, "../collab.pipeline");
const source = readFileSync(GOLDEN_FILE, "utf-8");

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(["bun", CLI, ...args]);
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode ?? 1,
  };
}

// ── Parse + compile the golden file once for unit assertions ─────────────────

const { ast, errors: parseErrors } = parse(source);
const validateErrors = ast ? validate(ast) : [];
const compiled = ast && validateErrors.length === 0 ? compile(ast) : null;

// ── AC1: Full pipeline expressed in .pipeline syntax ─────────────────────────

describe("golden: parse + validate (AC1, AC2)", () => {
  test("golden file parses without errors (AC1)", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("golden file validates without errors (AC2)", () => {
    expect(validateErrors).toHaveLength(0);
  });

  test("pipelang compile --validate exits 0 (AC2)", () => {
    const { exitCode } = runCLI(["compile", "--validate", GOLDEN_FILE]);
    expect(exitCode).toBe(0);
  });

  test("pipelang compile exits 0 (AC2)", () => {
    const { exitCode } = runCLI(["compile", GOLDEN_FILE]);
    expect(exitCode).toBe(0);
  });

  test("all 9 phases are declared (AC1)", () => {
    expect(ast!.phases.map((p) => p.name)).toEqual([
      "clarify", "plan", "tasks", "analyze", "implement", "run_tests", "visual_verify", "blindqa", "done",
    ]);
  });

  test("both gates are declared (AC1)", () => {
    const gateNames = ast!.gates.map((g) => g.name);
    expect(gateNames).toContain("plan_review");
    expect(gateNames).toContain("analyze_review");
  });
});

// ── AC3: Phases compile correctly ─────────────────────────────────────────────

describe("golden: phase compilation (AC3)", () => {
  test("clarify command is correct", () => {
    expect(compiled!.phases["clarify"].command).toBe("/collab.clarify");
  });

  test("clarify signals include CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR, CLARIFY_QUESTIONS", () => {
    expect(compiled!.phases["clarify"].signals).toEqual([
      "CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR", "CLARIFY_QUESTIONS",
    ]);
  });

  test("clarify transitions CLARIFY_COMPLETE → plan", () => {
    expect(compiled!.phases["clarify"].transitions!["CLARIFY_COMPLETE"]).toEqual({ to: "plan" });
  });

  test("plan PLAN_COMPLETE routes to gate plan_review", () => {
    expect(compiled!.phases["plan"].transitions!["PLAN_COMPLETE"]).toEqual({ gate: "plan_review" });
  });

  test("plan PLAN_ERROR self-loops", () => {
    expect(compiled!.phases["plan"].transitions!["PLAN_ERROR"]).toEqual({ to: "plan" });
  });

  test("tasks TASKS_COMPLETE → analyze", () => {
    expect(compiled!.phases["tasks"].transitions!["TASKS_COMPLETE"]).toEqual({ to: "analyze" });
  });

  test("tasks TASKS_ERROR self-loops", () => {
    expect(compiled!.phases["tasks"].transitions!["TASKS_ERROR"]).toEqual({ to: "tasks" });
  });

  test("analyze ANALYZE_COMPLETE routes to gate analyze_review", () => {
    expect(compiled!.phases["analyze"].transitions!["ANALYZE_COMPLETE"]).toEqual({ gate: "analyze_review" });
  });

  test("analyze ANALYZE_ERROR self-loops", () => {
    expect(compiled!.phases["analyze"].transitions!["ANALYZE_ERROR"]).toEqual({ to: "analyze" });
  });

  test("implement has actions block with display + command (AC3)", () => {
    expect(compiled!.phases["implement"].actions).toEqual([
      { display: "Starting implement phase for ${TICKET_ID}: ${TICKET_TITLE}" },
      { command: "/collab.implement" },
    ]);
  });

  test("implement IMPLEMENT_COMPLETE uses conditional routing (not simple transition)", () => {
    expect(compiled!.phases["implement"].transitions?.["IMPLEMENT_COMPLETE"]).toBeUndefined();
    expect(compiled!.phases["implement"].conditionalTransitions).toBeDefined();
  });

  test("implement IMPLEMENT_COMPLETE conditional has two rows", () => {
    expect(compiled!.phases["implement"].conditionalTransitions).toHaveLength(2);
  });

  test("implement IMPLEMENT_COMPLETE when(hasGroup) → tasks", () => {
    const rows = compiled!.phases["implement"].conditionalTransitions!;
    expect(rows[0]).toEqual({ signal: "IMPLEMENT_COMPLETE", if: "hasGroup", to: "tasks" });
  });

  test("implement IMPLEMENT_COMPLETE otherwise → run_tests", () => {
    const rows = compiled!.phases["implement"].conditionalTransitions!;
    expect(rows[1]).toEqual({ signal: "IMPLEMENT_COMPLETE", to: "run_tests" });
  });

  test("implement IMPLEMENT_ERROR self-loops", () => {
    expect(compiled!.phases["implement"].transitions!["IMPLEMENT_ERROR"]).toEqual({ to: "implement" });
  });

  test("run_tests RUN_TESTS_COMPLETE → visual_verify", () => {
    expect(compiled!.phases["run_tests"].transitions!["RUN_TESTS_COMPLETE"]).toEqual({ to: "visual_verify" });
  });

  test("visual_verify command is correct", () => {
    expect(compiled!.phases["visual_verify"].command).toBe("/collab.visual-verify");
  });

  test("visual_verify signals include COMPLETE, FAILED, ERROR", () => {
    const sigs = compiled!.phases["visual_verify"].signals!;
    expect(sigs).toContain("VISUAL_VERIFY_COMPLETE");
    expect(sigs).toContain("VISUAL_VERIFY_FAILED");
    expect(sigs).toContain("VISUAL_VERIFY_ERROR");
  });

  test("visual_verify VISUAL_VERIFY_COMPLETE → blindqa", () => {
    expect(compiled!.phases["visual_verify"].transitions!["VISUAL_VERIFY_COMPLETE"]).toEqual({ to: "blindqa" });
  });

  test("visual_verify VISUAL_VERIFY_FAILED self-loops", () => {
    expect(compiled!.phases["visual_verify"].transitions!["VISUAL_VERIFY_FAILED"]).toEqual({ to: "visual_verify" });
  });

  test("visual_verify VISUAL_VERIFY_ERROR self-loops", () => {
    expect(compiled!.phases["visual_verify"].transitions!["VISUAL_VERIFY_ERROR"]).toEqual({ to: "visual_verify" });
  });

  test("blindqa has actions block (AC3)", () => {
    expect(compiled!.phases["blindqa"].actions).toEqual([
      { display: "${TICKET_ID} — Starting Blind QA verification phase" },
      { command: "/collab.blindqa" },
    ]);
  });

  test("blindqa has goal_gate: always (AC3)", () => {
    expect(compiled!.phases["blindqa"].goal_gate).toBe("always");
  });

  test("blindqa has orchestrator_context (AC3)", () => {
    expect(compiled!.phases["blindqa"].orchestrator_context).toBe(
      ".minds/config/orchestrator-contexts/blindqa.md"
    );
  });

  test("blindqa signals include BLINDQA_WAITING and BLINDQA_QUESTION", () => {
    const sigs = compiled!.phases["blindqa"].signals!;
    expect(sigs).toContain("BLINDQA_QUESTION");
    expect(sigs).toContain("BLINDQA_WAITING");
  });

  test("blindqa BLINDQA_COMPLETE → done", () => {
    expect(compiled!.phases["blindqa"].transitions!["BLINDQA_COMPLETE"]).toEqual({ to: "done" });
  });

  test("blindqa BLINDQA_FAILED self-loops", () => {
    expect(compiled!.phases["blindqa"].transitions!["BLINDQA_FAILED"]).toEqual({ to: "blindqa" });
  });

  test("done is terminal (AC3)", () => {
    expect(compiled!.phases["done"].terminal).toBe(true);
  });
});

// ── AC3: Gates compile correctly ──────────────────────────────────────────────

describe("golden: gate compilation (AC3)", () => {
  test("plan_review prompt is correct", () => {
    expect(compiled!.gates!["plan_review"].prompt).toBe(".minds/config/gates/plan.md");
  });

  test("plan_review skipTo is tasks", () => {
    expect(compiled!.gates!["plan_review"].skipTo).toBe("tasks");
  });

  test("plan_review APPROVED → tasks", () => {
    expect(compiled!.gates!["plan_review"].on["APPROVED"]).toEqual({ to: "tasks" });
  });

  test("plan_review REVISION_NEEDED has full retry config", () => {
    expect(compiled!.gates!["plan_review"].on["REVISION_NEEDED"]).toEqual({
      to: "plan",
      feedback: "enrich",
      maxRetries: 3,
      onExhaust: "skip",
    });
  });

  test("analyze_review prompt is correct", () => {
    expect(compiled!.gates!["analyze_review"].prompt).toBe(".minds/config/gates/analyze.md");
  });

  test("analyze_review REMEDIATION_COMPLETE → implement", () => {
    expect(compiled!.gates!["analyze_review"].on["REMEDIATION_COMPLETE"]).toEqual({ to: "implement" });
  });

  test("analyze_review ESCALATION has no to: (onExhaust: abort)", () => {
    const escalation = compiled!.gates!["analyze_review"].on["ESCALATION"];
    expect(escalation.to).toBeUndefined();
    expect(escalation.feedback).toBe("raw");
    expect(escalation.onExhaust).toBe("abort");
  });
});

// ── AC4 (model) + derived I/O ─────────────────────────────────────────────────

describe("golden: model selection and I/O derivation (AC4)", () => {
  test("defaultModel is claude-sonnet-4-6", () => {
    expect(compiled!.defaultModel).toBe("claude-sonnet-4-6");
  });

  test("clarify has model: claude-opus-4-6", () => {
    expect(compiled!.phases["clarify"].model).toBe("claude-opus-4-6");
  });

  test("clarify has inputs: [ticket_spec, clarify_output] (self-error-loop predecessor)", () => {
    expect(compiled!.phases["clarify"].inputs).toEqual(["ticket_spec", "clarify_output"]);
  });

  test("clarify has outputs: [clarify_output]", () => {
    expect(compiled!.phases["clarify"].outputs).toEqual(["clarify_output"]);
  });

  test("done (terminal) has no model or I/O fields", () => {
    expect(compiled!.phases["done"].model).toBeUndefined();
    expect(compiled!.phases["done"].inputs).toBeUndefined();
    expect(compiled!.phases["done"].outputs).toBeUndefined();
  });

  test("non-terminal phases all have model set", () => {
    const nonTerminal = ["clarify", "plan", "tasks", "analyze", "implement", "run_tests", "visual_verify", "blindqa"];
    for (const name of nonTerminal) {
      expect(compiled!.phases[name].model).toBeDefined();
    }
  });

  test("non-terminal phases all have outputs", () => {
    const nonTerminal = ["clarify", "plan", "tasks", "analyze", "implement", "run_tests", "visual_verify", "blindqa"];
    for (const name of nonTerminal) {
      expect(compiled!.phases[name].outputs).toEqual([`${name}_output`]);
    }
  });
});

// ── AC5: Golden file is source of truth ───────────────────────────────────────

describe("golden: file is source of truth (AC5)", () => {
  test("golden file exists at pipelang/collab.pipeline", () => {
    expect(() => readFileSync(GOLDEN_FILE, "utf-8")).not.toThrow();
  });

  test("full compiled JSON is valid and parseable", () => {
    const { stdout } = runCLI(["compile", GOLDEN_FILE]);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("compiled JSON has version 3.1", () => {
    const { stdout } = runCLI(["compile", GOLDEN_FILE]);
    const out = JSON.parse(stdout);
    expect(out.version).toBe("3.1");
  });

  test("compiled JSON has all 9 phases", () => {
    const { stdout } = runCLI(["compile", GOLDEN_FILE]);
    const out = JSON.parse(stdout);
    expect(Object.keys(out.phases)).toHaveLength(9);
  });

  test("compiled JSON has both gates", () => {
    const { stdout } = runCLI(["compile", GOLDEN_FILE]);
    const out = JSON.parse(stdout);
    expect(Object.keys(out.gates)).toContain("plan_review");
    expect(Object.keys(out.gates)).toContain("analyze_review");
  });
});
