// BRE-307: Slice 9 — Conditional routing (when/otherwise)
import { describe, test, expect } from "bun:test";
import { tokenize } from "../src/lexer";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
import { validate } from "../src/validator";
import { KNOWN_CONDITIONS } from "../src/types";
import { spawnSync } from "bun";
import { writeFileSync, unlinkSync } from "fs";
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

// ── Lexer: EQ token ────────────────────────────────────────────────────────────

describe("slice9: lexer — EQ token", () => {
  test("tokenizes '=' as EQ", () => {
    const { tokens } = tokenize("to = blindqa");
    expect(tokens[0].kind).toBe("IDENT");
    expect(tokens[0].value).toBe("to");
    expect(tokens[1].kind).toBe("EQ");
    expect(tokens[1].value).toBe("=");
    expect(tokens[2].kind).toBe("IDENT");
    expect(tokens[2].value).toBe("blindqa");
  });
});

// ── Parser: block form .on() ───────────────────────────────────────────────────

describe("slice9: parser — conditional on block form", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE, IMPL_ERROR)
    .on(IMPL_COMPLETE) {
        when(hasGroup and isBackend) { to = gate(deploy) }
        otherwise                    { to = blindqa }
    }
    .on(IMPL_ERROR, to: impl)

phase(deploy) .signals(DEPLOY_DONE) .on(DEPLOY_DONE, to: blindqa)
phase(blindqa) .signals(QA_DONE) .on(QA_DONE, to: done)
gate(deploy) .prompt(.file("deploy.md")) .on(APPROVED, to: deploy)
phase(done) .terminal()
`;

  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
    expect(ast).toBeDefined();
  });

  test("impl has two modifiers: conditionalOn + on", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const conds = impl.modifiers.filter((m) => m.kind === "conditionalOn");
    const ons = impl.modifiers.filter((m) => m.kind === "on");
    expect(conds).toHaveLength(1);
    expect(ons).toHaveLength(1);
  });

  test("conditionalOn has signal IMPL_COMPLETE", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.signal).toBe("IMPL_COMPLETE");
  });

  test("conditionalOn has two branches", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.branches).toHaveLength(2);
  });

  test("first branch has condition 'hasGroup and isBackend'", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.branches[0].condition).toBe("hasGroup and isBackend");
  });

  test("first branch target is gate: deploy", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.branches[0].target.kind).toBe("gate");
    expect(cond.branches[0].target.gate).toBe("deploy");
  });

  test("second branch is otherwise (undefined condition)", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.branches[1].condition).toBeUndefined();
  });

  test("otherwise branch target is to: blindqa", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.branches[1].target.kind).toBe("to");
    expect(cond.branches[1].target.phase).toBe("blindqa");
  });
});

// ── Parser: 'or' operator ──────────────────────────────────────────────────────

describe("slice9: parser — 'or' operator in condition", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE) {
        when(hasGroup or isFrontend) { to = qa }
        otherwise                    { to = done }
    }
phase(qa)    .signals(QA_DONE)   .on(QA_DONE, to: done)
phase(done)  .terminal()
`;

  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("condition is 'hasGroup or isFrontend'", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cond = impl.modifiers.find((m) => m.kind === "conditionalOn") as any;
    expect(cond.branches[0].condition).toBe("hasGroup or isFrontend");
  });
});

// ── Compiler: conditional transitions ─────────────────────────────────────────

describe("slice9: compiler — conditionalTransitions output", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE, IMPL_ERROR)
    .on(IMPL_COMPLETE) {
        when(hasGroup and isBackend) { to = gate(deploy) }
        otherwise                    { to = blindqa }
    }
    .on(IMPL_ERROR, to: impl)

phase(blindqa) .signals(QA_DONE) .on(QA_DONE, to: done)
phase(done)    .terminal()
gate(deploy)   .prompt(.file("deploy.md")) .on(APPROVED, to: blindqa)
`;

  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("impl has conditionalTransitions", () => {
    expect(compiled!.phases["impl"].conditionalTransitions).toBeDefined();
  });

  test("conditionalTransitions has two rows", () => {
    expect(compiled!.phases["impl"].conditionalTransitions).toHaveLength(2);
  });

  test("first row has signal IMPL_COMPLETE", () => {
    const rows = compiled!.phases["impl"].conditionalTransitions!;
    expect(rows[0].signal).toBe("IMPL_COMPLETE");
  });

  test("first row has if condition", () => {
    const rows = compiled!.phases["impl"].conditionalTransitions!;
    expect(rows[0].if).toBe("hasGroup and isBackend");
  });

  test("first row routes to gate: deploy", () => {
    const rows = compiled!.phases["impl"].conditionalTransitions!;
    expect(rows[0].gate).toBe("deploy");
    expect(rows[0].to).toBeUndefined();
  });

  test("second row (otherwise) has no 'if' key", () => {
    const rows = compiled!.phases["impl"].conditionalTransitions!;
    expect(rows[1].if).toBeUndefined();
  });

  test("second row routes to: blindqa", () => {
    const rows = compiled!.phases["impl"].conditionalTransitions!;
    expect(rows[1].to).toBe("blindqa");
    expect(rows[1].gate).toBeUndefined();
  });

  test("rows maintain declaration order (when before otherwise)", () => {
    const rows = compiled!.phases["impl"].conditionalTransitions!;
    expect(rows[0].if).toBeDefined(); // when branch first
    expect(rows[1].if).toBeUndefined(); // otherwise last
  });

  test("regular .on() transitions are still in transitions map", () => {
    expect(compiled!.phases["impl"].transitions!["IMPL_ERROR"]).toEqual({ to: "impl" });
  });
});

// ── Validator: missing otherwise ───────────────────────────────────────────────

describe("slice9: validator — missing otherwise", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE) {
        when(hasGroup) { to = qa }
    }
phase(qa)   .signals(QA_DONE) .on(QA_DONE, to: done)
phase(done) .terminal()
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without parse errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("validate produces an error for missing otherwise", () => {
    const missing = validateErrors.filter(
      (e) => e.message.includes("otherwise") && e.severity !== "warning"
    );
    expect(missing.length).toBeGreaterThan(0);
  });

  test("error message mentions 'otherwise'", () => {
    expect(validateErrors.some((e) => e.message.includes("otherwise"))).toBe(true);
  });
});

// ── Validator: unknown condition warning ───────────────────────────────────────

describe("slice9: validator — unknown condition warning", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE) {
        when(customCondition) { to = qa }
        otherwise             { to = done }
    }
phase(qa)   .signals(QA_DONE) .on(QA_DONE, to: done)
phase(done) .terminal()
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without parse errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("produces a warning for unknown condition", () => {
    const warnings = validateErrors.filter((e) => e.severity === "warning");
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("warning mentions the unknown condition name", () => {
    const warnings = validateErrors.filter((e) => e.severity === "warning");
    expect(warnings.some((w) => w.message.includes("customCondition"))).toBe(true);
  });

  test("warning says 'will be AI-evaluated at runtime'", () => {
    const warnings = validateErrors.filter((e) => e.severity === "warning");
    expect(warnings.some((w) => w.message.includes("AI-evaluated at runtime"))).toBe(true);
  });

  test("warnings don't block compilation (no fatal errors)", () => {
    const fatal = validateErrors.filter((e) => e.severity !== "warning");
    expect(fatal).toHaveLength(0);
  });
});

// ── Validator: known condition no warning ──────────────────────────────────────

describe("slice9: validator — known conditions produce no warnings", () => {
  test("KNOWN_CONDITIONS set is defined and non-empty", () => {
    expect(KNOWN_CONDITIONS.size).toBeGreaterThan(0);
  });

  const knownCond = [...KNOWN_CONDITIONS][0]; // use first known condition

  const source = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE) {
        when(${knownCond}) { to = qa }
        otherwise          { to = done }
    }
phase(qa)   .signals(QA_DONE) .on(QA_DONE, to: done)
phase(done) .terminal()
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("known condition produces no warnings", () => {
    const warnings = validateErrors.filter((e) => e.severity === "warning");
    expect(warnings).toHaveLength(0);
  });

  test("no errors at all", () => {
    expect(validateErrors).toHaveLength(0);
  });
});

// ── Validator: undeclared target in conditional branch ─────────────────────────

describe("slice9: validator — undeclared targets in branches", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE) {
        when(hasGroup) { to = undeclaredPhase }
        otherwise      { to = done }
    }
phase(done) .terminal()
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without parse errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("produces error for undeclared phase in when branch", () => {
    const err = validateErrors.find(
      (e) => e.message.includes("undeclaredPhase") && e.severity !== "warning"
    );
    expect(err).toBeDefined();
  });
});

// ── CLI: warnings exit 0 ──────────────────────────────────────────────────────

describe("slice9: CLI — warnings exit 0, print to stderr", () => {
  const pipelineWithWarning = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE) {
        when(unknownConditionXYZ) { to = done }
        otherwise                 { to = done }
    }
phase(done) .terminal()
`;

  const tmpFile = join(import.meta.dir, "_tmp_warning_test.pipeline");

  test("compile with warning exits 0", () => {
    writeFileSync(tmpFile, pipelineWithWarning);
    try {
      const { exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test("warning appears in stderr", () => {
    writeFileSync(tmpFile, pipelineWithWarning);
    try {
      const { stderr } = runCLI(["compile", tmpFile]);
      expect(stderr).toContain("warning");
      expect(stderr).toContain("unknownConditionXYZ");
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test("--validate with warning exits 0", () => {
    writeFileSync(tmpFile, pipelineWithWarning);
    try {
      const { exitCode } = runCLI(["compile", "--validate", tmpFile]);
      expect(exitCode).toBe(0);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
