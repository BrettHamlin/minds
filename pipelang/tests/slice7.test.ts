// BRE-308: Slice 9 — Model selection and compile-time I/O derivation
import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser";
import { compile, MODEL_IDS } from "../src/compiler";
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

// The canonical example from BRE-308
const FULL_EXAMPLE = `
@defaultModel(sonnet)

phase(clarify)
    .command("/collab.clarify")
    .signals(CLARIFY_COMPLETE)
    .on(CLARIFY_COMPLETE, to: plan)

phase(plan)
    .command("/collab.plan")
    .model(opus)
    .signals(PLAN_COMPLETE)
    .on(PLAN_COMPLETE, to: done)

phase(done)
    .terminal()
`.trim();

// ── Lexer: @ tokenizes to AT ───────────────────────────────────────────────

describe("tokenize() — slice 7: AT token", () => {
  test("@ tokenizes to AT", () => {
    const { tokenize } = require("../src/lexer");
    const { tokens } = tokenize("@defaultModel(sonnet)");
    expect(tokens[0].kind).toBe("AT");
    expect(tokens[0].value).toBe("@");
  });

  test("@ followed by ident is two tokens", () => {
    const { tokenize } = require("../src/lexer");
    const { tokens } = tokenize("@defaultModel");
    expect(tokens[0].kind).toBe("AT");
    expect(tokens[1].kind).toBe("IDENT");
    expect(tokens[1].value).toBe("defaultModel");
  });
});

// ── Parser: @defaultModel and .model() ────────────────────────────────────

describe("parse() — slice 7: model directives", () => {
  test("@defaultModel(sonnet) sets ast.defaultModel", () => {
    const { ast, errors } = parse(`@defaultModel(sonnet)\nphase(p)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    expect(ast!.defaultModel).toBe("sonnet");
  });

  test("@defaultModel(haiku) is valid", () => {
    const { ast, errors } = parse(`@defaultModel(haiku)\nphase(p)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    expect(ast!.defaultModel).toBe("haiku");
  });

  test("@defaultModel(opus) is valid", () => {
    const { ast, errors } = parse(`@defaultModel(opus)\nphase(p)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    expect(ast!.defaultModel).toBe("opus");
  });

  test("@defaultModel with invalid name produces error", () => {
    const { errors } = parse(`@defaultModel(gpt4)\nphase(p)\n    .terminal()`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("valid model name"))).toBe(true);
  });

  test(".model(opus) parses as ModelModifier", () => {
    const { ast, errors } = parse(`phase(p)\n    .model(opus)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers.find((m) => m.kind === "model") as any;
    expect(mod).toBeDefined();
    expect(mod.name).toBe("opus");
  });

  test(".model(haiku) is valid", () => {
    const { ast, errors } = parse(`phase(p)\n    .model(haiku)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers.find((m) => m.kind === "model") as any;
    expect(mod.name).toBe("haiku");
  });

  test(".model() with invalid name produces error", () => {
    const { errors } = parse(`phase(p)\n    .model(gpt4)\n    .terminal()`);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("no defaultModel when @defaultModel not present", () => {
    const { ast, errors } = parse(`phase(p)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    expect(ast!.defaultModel).toBeUndefined();
  });

  test("full example parses without errors", () => {
    const { errors } = parse(FULL_EXAMPLE);
    expect(errors).toHaveLength(0);
  });

  test("full example has defaultModel=sonnet", () => {
    const { ast } = parse(FULL_EXAMPLE);
    expect(ast!.defaultModel).toBe("sonnet");
  });

  test("full example plan phase has .model(opus)", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const planPhase = ast!.phases.find((p) => p.name === "plan")!;
    const mod = planPhase.modifiers.find((m) => m.kind === "model") as any;
    expect(mod?.name).toBe("opus");
  });
});

// ── Compiler: model IDs ────────────────────────────────────────────────────

describe("MODEL_IDS", () => {
  test("haiku maps to claude-haiku-4-5-20251001", () => {
    expect(MODEL_IDS.haiku).toBe("claude-haiku-4-5-20251001");
  });
  test("sonnet maps to claude-sonnet-4-6", () => {
    expect(MODEL_IDS.sonnet).toBe("claude-sonnet-4-6");
  });
  test("opus maps to claude-opus-4-6", () => {
    expect(MODEL_IDS.opus).toBe("claude-opus-4-6");
  });
});

// ── Compiler: model selection ──────────────────────────────────────────────

describe("compile() — slice 7: model selection", () => {
  test("@defaultModel(sonnet) sets defaultModel in compiled output", () => {
    const src = `@defaultModel(sonnet)\nphase(p)\n    .signals(S)\n    .on(S, to: done)\nphase(done)\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.defaultModel).toBe("claude-sonnet-4-6");
  });

  test("@defaultModel(opus) sets defaultModel in compiled output", () => {
    const src = `@defaultModel(opus)\nphase(p)\n    .signals(S)\n    .on(S, to: done)\nphase(done)\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.defaultModel).toBe("claude-opus-4-6");
  });

  test("phase with .model(opus) gets opus model ID", () => {
    const src = `@defaultModel(sonnet)\nphase(p)\n    .model(opus)\n    .signals(S)\n    .on(S, to: done)\nphase(done)\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["p"].model).toBe("claude-opus-4-6");
  });

  test(".model() overrides @defaultModel for that phase", () => {
    const src = `@defaultModel(sonnet)\nphase(clarify)\n    .model(haiku)\n    .signals(S)\n    .on(S, to: done)\nphase(done)\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["clarify"].model).toBe("claude-haiku-4-5-20251001");
  });

  test("phase without .model() inherits @defaultModel", () => {
    const src = `@defaultModel(sonnet)\nphase(p)\n    .signals(S)\n    .on(S, to: done)\nphase(done)\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["p"].model).toBe("claude-sonnet-4-6");
  });

  test("phase with no model annotation and no default gets sonnet (AC3)", () => {
    // One phase has .model(), another (non-terminal) doesn't, no @defaultModel
    const src = `phase(a)\n    .model(opus)\n    .signals(S)\n    .on(S, to: b)\nphase(b)\n    .signals(T)\n    .on(T, to: done)\nphase(done)\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    // phase b has no .model(), no @defaultModel → fallback to sonnet
    expect(out.phases["b"].model).toBe("claude-sonnet-4-6");
  });

  test("pipeline with no model directives has no model/inputs/outputs on phases", () => {
    const { ast } = parse(`phase(p)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].model).toBeUndefined();
    expect(out.phases["p"].inputs).toBeUndefined();
    expect(out.phases["p"].outputs).toBeUndefined();
    expect(out.defaultModel).toBeUndefined();
  });
});

// ── Compiler: I/O derivation ───────────────────────────────────────────────

describe("compile() — slice 7: I/O derivation", () => {
  test("first phase in linear chain has inputs=[ticket_spec]", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["clarify"].inputs).toEqual(["ticket_spec"]);
  });

  test("first phase outputs=[clarify_output]", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["clarify"].outputs).toEqual(["clarify_output"]);
  });

  test("second phase inputs include ticket_spec + predecessor output", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["plan"].inputs).toEqual(["ticket_spec", "clarify_output"]);
  });

  test("second phase outputs=[plan_output]", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["plan"].outputs).toEqual(["plan_output"]);
  });

  test("terminal phase has no inputs or outputs", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["done"].inputs).toBeUndefined();
    expect(out.phases["done"].outputs).toBeUndefined();
  });

  test("3-phase linear chain: phase 3 inputs include all predecessors", () => {
    const src = `
@defaultModel(sonnet)

phase(a)
    .command("/cmd.a")
    .signals(A_DONE)
    .on(A_DONE, to: b)

phase(b)
    .command("/cmd.b")
    .signals(B_DONE)
    .on(B_DONE, to: c)

phase(c)
    .command("/cmd.c")
    .signals(C_DONE)
    .on(C_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["a"].inputs).toEqual(["ticket_spec"]);
    expect(out.phases["b"].inputs).toEqual(["ticket_spec", "a_output"]);
    expect(out.phases["c"].inputs).toEqual(["ticket_spec", "a_output", "b_output"]);
    expect(out.phases["done"].inputs).toBeUndefined();
  });

  test("all non-terminal phases get outputs=[phaseName_output]", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["clarify"].outputs).toEqual(["clarify_output"]);
    expect(out.phases["plan"].outputs).toEqual(["plan_output"]);
  });

  test("full example compiles to expected structure (AC5)", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    // defaultModel
    expect(out.defaultModel).toBe("claude-sonnet-4-6");
    // clarify phase
    expect(out.phases["clarify"].model).toBe("claude-sonnet-4-6");
    expect(out.phases["clarify"].inputs).toEqual(["ticket_spec"]);
    expect(out.phases["clarify"].outputs).toEqual(["clarify_output"]);
    expect(out.phases["clarify"].command).toBe("/collab.clarify");
    // plan phase — overridden to opus
    expect(out.phases["plan"].model).toBe("claude-opus-4-6");
    expect(out.phases["plan"].inputs).toEqual(["ticket_spec", "clarify_output"]);
    expect(out.phases["plan"].outputs).toEqual(["plan_output"]);
    expect(out.phases["plan"].command).toBe("/collab.plan");
    // done — terminal, no model/IO
    expect(out.phases["done"].terminal).toBe(true);
    expect(out.phases["done"].model).toBeUndefined();
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 7)", () => {
  const fullFile = "/tmp/pipelang-slice7-full.pipeline";
  const noModelFile = "/tmp/pipelang-slice7-nomodel.pipeline";

  writeFileSync(fullFile, FULL_EXAMPLE);
  writeFileSync(noModelFile, `phase(p)\n    .terminal()`);

  test("full example exits 0", () => {
    expect(runCLI(["compile", fullFile]).exitCode).toBe(0);
  });

  test("full example outputs defaultModel", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.defaultModel).toBe("claude-sonnet-4-6");
  });

  test("full example clarify phase has correct model and IO", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.phases.clarify.model).toBe("claude-sonnet-4-6");
    expect(out.phases.clarify.inputs).toEqual(["ticket_spec"]);
    expect(out.phases.clarify.outputs).toEqual(["clarify_output"]);
  });

  test("full example plan phase overrides to opus", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.phases.plan.model).toBe("claude-opus-4-6");
    expect(out.phases.plan.inputs).toEqual(["ticket_spec", "clarify_output"]);
  });

  test("pipeline without model directives has no model fields", () => {
    const { stdout } = runCLI(["compile", noModelFile]);
    const out = JSON.parse(stdout);
    expect(out.defaultModel).toBeUndefined();
    expect(out.phases.p.model).toBeUndefined();
  });
});
