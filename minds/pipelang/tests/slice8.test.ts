// BRE-304: Slice 8 — Gates with feedback, retries, and exhaustion
import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
import { validate } from "../src/validator";
import { spawnSync } from "bun";
import { writeFileSync } from "fs";
import { join } from "path";

const CLI = join(import.meta.dir, "../cli.ts");

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(["bun", CLI, ...args]);
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode ?? 1,
  };
}

const FULL_EXAMPLE = `
phase(plan)
    .command("/collab.plan")
    .signals(PLAN_COMPLETE)
    .on(PLAN_COMPLETE, gate: plan_review)

gate(plan_review)
    .prompt(.file(".minds/config/gates/plan.md"))
    .skipTo(tasks)
    .on(APPROVED, to: tasks)
    .on(REVISION_NEEDED, to: plan, feedback: .enrich, maxRetries: 3, onExhaust: .skip)

phase(tasks)
    .command("/collab.tasks")
    .signals(TASKS_COMPLETE)
    .on(TASKS_COMPLETE, to: done)

phase(done)
    .terminal()
`.trim();

// ── Lexer ─────────────────────────────────────────────────────────────────────

describe("tokenize() — slice 8: NUMBER token", () => {
  test("integer tokenizes to NUMBER", () => {
    const { tokenize } = require("../src/lexer");
    const { tokens } = tokenize("maxRetries: 3");
    const numTok = tokens.find((t: any) => t.kind === "NUMBER");
    expect(numTok).toBeDefined();
    expect(numTok.value).toBe("3");
  });
});

// ── Parser: gate declarations ─────────────────────────────────────────────────

describe("parse() — slice 8: gate declarations", () => {
  test("gate() parses to GateDecl", () => {
    const { ast, errors } = parse(`gate(review)\n    .prompt(.file("plan.md"))\n    .on(APPROVED, to: done)\n\nphase(done)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    expect(ast!.gates).toHaveLength(1);
    expect(ast!.gates[0].name).toBe("review");
  });

  test("gate .prompt(.file()) parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("gates/plan.md"))\n    .on(APPROVED, to: done)\n\nphase(done)\n    .terminal()`);
    const prompt = ast!.gates[0].modifiers.find((m) => m.kind === "prompt") as any;
    expect(prompt.source).toEqual({ kind: "file", path: "gates/plan.md" });
  });

  test("gate .prompt(.inline()) parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.inline("Is this correct?"))\n    .on(APPROVED, to: done)\n\nphase(done)\n    .terminal()`);
    const prompt = ast!.gates[0].modifiers.find((m) => m.kind === "prompt") as any;
    expect(prompt.source).toEqual({ kind: "inline", text: "Is this correct?" });
  });

  test("gate .skipTo(phase) parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .skipTo(tasks)\n    .on(APPROVED, to: done)\n\nphase(tasks)\n    .terminal()\n\nphase(done)\n    .terminal()`);
    const skipTo = ast!.gates[0].modifiers.find((m) => m.kind === "skipTo") as any;
    expect(skipTo.phase).toBe("tasks");
  });

  test("gate .on(SIGNAL, to: phase) parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(APPROVED, to: done)\n\nphase(done)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m) => m.kind === "on") as any;
    expect(on.signal).toBe("APPROVED");
    expect(on.target.kind).toBe("to");
    expect(on.target.phase).toBe("done");
  });

  test("gate .on() with feedback: .enrich parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(REVISION_NEEDED, to: plan, feedback: .enrich)\n\nphase(plan)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m: any) => m.signal === "REVISION_NEEDED") as any;
    expect(on.feedback).toBe("enrich");
  });

  test("gate .on() with feedback: .raw parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(REVISION_NEEDED, to: plan, feedback: .raw)\n\nphase(plan)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m: any) => m.signal === "REVISION_NEEDED") as any;
    expect(on.feedback).toBe("raw");
  });

  test("gate .on() with maxRetries: 3 parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .skipTo(tasks)\n    .on(REVISION_NEEDED, to: plan, maxRetries: 3, onExhaust: .skip)\n\nphase(plan)\n    .terminal()\n\nphase(tasks)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m: any) => m.signal === "REVISION_NEEDED") as any;
    expect(on.maxRetries).toBe(3);
  });

  test("gate .on() with onExhaust: .skip parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .skipTo(tasks)\n    .on(REVISION_NEEDED, to: plan, onExhaust: .skip)\n\nphase(plan)\n    .terminal()\n\nphase(tasks)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m: any) => m.signal === "REVISION_NEEDED") as any;
    expect(on.onExhaust).toBe("skip");
  });

  test("gate .on() with onExhaust: .escalate parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(REVISION_NEEDED, to: plan, onExhaust: .escalate)\n\nphase(plan)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m: any) => m.signal === "REVISION_NEEDED") as any;
    expect(on.onExhaust).toBe("escalate");
  });

  test("gate .on() with onExhaust: .abort parses correctly", () => {
    const { ast } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(REVISION_NEEDED, to: plan, onExhaust: .abort)\n\nphase(plan)\n    .terminal()`);
    const on = ast!.gates[0].modifiers.find((m: any) => m.signal === "REVISION_NEEDED") as any;
    expect(on.onExhaust).toBe("abort");
  });

  test("invalid feedback enum produces error", () => {
    const { errors } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(APPROVED, to: done, feedback: .sometimes)\n\nphase(done)\n    .terminal()`);
    expect(errors.some((e) => e.message.includes("Invalid Feedback value"))).toBe(true);
  });

  test("invalid onExhaust enum produces error", () => {
    const { errors } = parse(`gate(review)\n    .prompt(.file("p.md"))\n    .on(APPROVED, to: done, onExhaust: .never)\n\nphase(done)\n    .terminal()`);
    expect(errors.some((e) => e.message.includes("Invalid Exhaust value"))).toBe(true);
  });

  test("phase .on() with gate: target parses correctly", () => {
    const { ast, errors } = parse(`phase(plan)\n    .signals(PLAN_COMPLETE)\n    .on(PLAN_COMPLETE, gate: plan_review)\n\ngate(plan_review)\n    .prompt(.file("p.md"))\n    .on(APPROVED, to: done)\n\nphase(done)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const on = ast!.phases[0].modifiers.find((m) => m.kind === "on") as any;
    expect(on.target.kind).toBe("gate");
    expect(on.target.gate).toBe("plan_review");
  });

  test("full example parses without errors", () => {
    const { errors } = parse(FULL_EXAMPLE);
    expect(errors).toHaveLength(0);
  });

  test("AST has correct phase and gate counts", () => {
    const { ast } = parse(FULL_EXAMPLE);
    expect(ast!.phases).toHaveLength(3);
    expect(ast!.gates).toHaveLength(1);
  });
});

// ── Validator: gate constraints ───────────────────────────────────────────────

describe("validate() — slice 8: gate constraints", () => {
  test("valid full example produces no errors (AC1)", () => {
    const { ast } = parse(FULL_EXAMPLE);
    expect(validate(ast!)).toHaveLength(0);
  });

  test("gate: reference to undeclared gate produces error (AC2)", () => {
    const { ast } = parse(`
phase(plan)
    .signals(PLAN_COMPLETE)
    .on(PLAN_COMPLETE, gate: nonexistent)

phase(done)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("Gate 'nonexistent' not declared"))).toBe(true);
  });

  test("onExhaust: .skip without .skipTo() is a compile error (AC3)", () => {
    const { ast } = parse(`
gate(review)
    .prompt(.file("p.md"))
    .on(REVISION_NEEDED, to: plan, onExhaust: .skip)

phase(plan)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("skipTo is required"))).toBe(true);
  });

  test("onExhaust: .skip WITH .skipTo() is valid", () => {
    const { ast } = parse(`
gate(review)
    .prompt(.file("p.md"))
    .skipTo(tasks)
    .on(REVISION_NEEDED, to: plan, onExhaust: .skip)

phase(plan)
    .terminal()

phase(tasks)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.filter((e) => e.message.includes("skipTo is required"))).toHaveLength(0);
  });

  test("onExhaust: .escalate does not require .skipTo()", () => {
    const { ast } = parse(`
gate(review)
    .prompt(.file("p.md"))
    .on(REVISION_NEEDED, to: plan, onExhaust: .escalate)

phase(plan)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.filter((e) => e.message.includes("skipTo is required"))).toHaveLength(0);
  });

  test("gate with to: pointing at undeclared phase produces error", () => {
    const { ast } = parse(`
gate(review)
    .prompt(.file("p.md"))
    .on(APPROVED, to: nonexistent_phase)

phase(done)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("not declared"))).toBe(true);
  });
});

// ── Compiler: gate output ─────────────────────────────────────────────────────

describe("compile() — slice 8: gate compilation (AC1, AC5)", () => {
  test("gate with prompt (.file) compiles correctly", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.gates).toBeDefined();
    expect(out.gates!["plan_review"].prompt).toBe(".minds/config/gates/plan.md");
  });

  test("gate skipTo compiles correctly", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.gates!["plan_review"].skipTo).toBe("tasks");
  });

  test("gate APPROVED response compiles to { to: tasks }", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.gates!["plan_review"].on["APPROVED"]).toEqual({ to: "tasks" });
  });

  test("gate REVISION_NEEDED response includes feedback, maxRetries, onExhaust (AC5)", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.gates!["plan_review"].on["REVISION_NEEDED"]).toEqual({
      to: "plan",
      feedback: "enrich",
      maxRetries: 3,
      onExhaust: "skip",
    });
  });

  test("feedback: .enrich compiles to 'enrich' (AC5)", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.gates!["plan_review"].on["REVISION_NEEDED"].feedback).toBe("enrich");
  });

  test("onExhaust: .skip compiles to 'skip' (AC5)", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.gates!["plan_review"].on["REVISION_NEEDED"].onExhaust).toBe("skip");
  });

  test("phase .on(SIGNAL, gate: name) compiles to { gate: name } transition", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["plan"].transitions!["PLAN_COMPLETE"]).toEqual({ gate: "plan_review" });
  });

  test("gate with .inline prompt compiles correctly", () => {
    const { ast } = parse(`
gate(review)
    .prompt(.inline("Is this correct?"))
    .on(APPROVED, to: done)

phase(done)
    .terminal()
`);
    const out = compile(ast!);
    expect(out.gates!["review"].prompt).toEqual({ inline: "Is this correct?" });
  });

  test("pipeline without gates has no gates key", () => {
    const { ast } = parse(`phase(p)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.gates).toBeUndefined();
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 8)", () => {
  const fullFile = "/tmp/pipelang-slice8-full.pipeline";
  const badGateFile = "/tmp/pipelang-slice8-badgate.pipeline";
  const skipNoSkipToFile = "/tmp/pipelang-slice8-skipnoskipto.pipeline";

  writeFileSync(fullFile, FULL_EXAMPLE);
  writeFileSync(
    badGateFile,
    `phase(p)\n    .signals(S)\n    .on(S, gate: nonexistent)\n\nphase(done)\n    .terminal()`
  );
  writeFileSync(
    skipNoSkipToFile,
    `gate(review)\n    .prompt(.file("p.md"))\n    .on(REVISION_NEEDED, to: plan, onExhaust: .skip)\n\nphase(plan)\n    .terminal()`
  );

  test("valid full example exits 0", () => {
    expect(runCLI(["compile", fullFile]).exitCode).toBe(0);
  });

  test("valid full example produces gates in JSON", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.gates).toBeDefined();
    expect(out.gates.plan_review.prompt).toBe(".minds/config/gates/plan.md");
  });

  test("undeclared gate reference exits 1 (AC2)", () => {
    const { exitCode, stderr } = runCLI(["compile", badGateFile]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Gate 'nonexistent' not declared");
  });

  test("onExhaust: .skip without skipTo exits 1 (AC3)", () => {
    const { exitCode, stderr } = runCLI(["compile", skipNoSkipToFile]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("skipTo is required");
  });
});
