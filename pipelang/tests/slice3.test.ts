// BRE-302: Slice 3 — Signals, transitions, and reference validation
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
phase(clarify)
    .command("/collab.clarify")
    .signals(CLARIFY_COMPLETE, CLARIFY_ERROR)
    .on(CLARIFY_COMPLETE, to: done)
    .on(CLARIFY_ERROR, to: clarify)

phase(done)
    .terminal()
`.trim();

// ── Parser unit tests ─────────────────────────────────────────────────────────

describe("parse() — slice 3: .signals() and .on()", () => {
  test("parses .signals() with multiple identifiers", () => {
    const { ast, errors } = parse(`phase(p)\n    .signals(A, B, C)`);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("signals");
    if (mod.kind === "signals") expect(mod.signals).toEqual(["A", "B", "C"]);
  });

  test("parses .on() with to: named parameter", () => {
    const { ast, errors } = parse(`phase(p)\n    .signals(SIG)\n    .on(SIG, to: q)\nphase(q)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const onMod = ast!.phases[0].modifiers[1];
    expect(onMod.kind).toBe("on");
    if (onMod.kind === "on") {
      expect(onMod.signal).toBe("SIG");
      expect(onMod.target.kind).toBe("to");
      if (onMod.target.kind === "to") expect(onMod.target.phase).toBe("q");
    }
  });

  test("parses full example with two phases", () => {
    const { ast, errors } = parse(FULL_EXAMPLE);
    expect(errors).toHaveLength(0);
    expect(ast!.phases).toHaveLength(2);
  });

  test(".on() signal location is tracked for error reporting", () => {
    const { ast } = parse(`phase(p)\n    .signals(SIG)\n    .on(SIG, to: q)\nphase(q)\n    .terminal()`);
    const onMod = ast!.phases[0].modifiers[1];
    if (onMod.kind === "on") expect(onMod.signalLoc.line).toBe(3);
  });
});

// ── Validator unit tests ──────────────────────────────────────────────────────

describe("validate() — two-pass reference checking", () => {
  test("no errors for valid full example", () => {
    const { ast } = parse(FULL_EXAMPLE);
    expect(validate(ast!)).toHaveLength(0);
  });

  test("undeclared to: target produces error", () => {
    const { ast } = parse(`
phase(clarify)
    .signals(DONE)
    .on(DONE, to: plaan)

phase(done)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("plaan");
  });

  test("undeclared to: target suggests 'did you mean?'", () => {
    const { ast } = parse(`
phase(plan)
    .signals(DONE)
    .on(DONE, to: plaan)

phase(plan)
    .terminal()
`);
    // Two phases named plan — validator won't error on duplicate, but should suggest
    const { ast: ast2 } = parse(`
phase(clarify)
    .signals(DONE)
    .on(DONE, to: plaan)

phase(plan)
    .terminal()
`);
    const errors = validate(ast2!);
    const err = errors.find((e) => e.message.includes("plaan"));
    expect(err).toBeDefined();
    expect(err!.message).toContain("Did you mean 'plan'");
  });

  test("signal not in .signals() produces error", () => {
    const { ast } = parse(`
phase(clarify)
    .signals(CLARIFY_COMPLETE)
    .on(CLARIFY_DONE, to: done)

phase(done)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("CLARIFY_DONE"))).toBe(true);
  });

  test("signal not in .signals() suggests 'did you mean?'", () => {
    const { ast } = parse(`
phase(clarify)
    .signals(CLARIFY_COMPLETE)
    .on(CLARIFY_COMPLETEE, to: done)

phase(done)
    .terminal()
`);
    const errors = validate(ast!);
    const err = errors.find((e) => e.message.includes("CLARIFY_COMPLETEE"));
    expect(err!.message).toContain("Did you mean 'CLARIFY_COMPLETE'");
  });

  test("terminal phase with .on() produces error", () => {
    const { ast } = parse(`
phase(done)
    .terminal()
    .signals(SOMETHING)
    .on(SOMETHING, to: done)
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("Terminal"))).toBe(true);
  });

  test("error includes line number", () => {
    const { ast } = parse(`
phase(clarify)
    .signals(DONE)
    .on(DONE, to: nonexistent)

phase(plan)
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors[0].loc.line).toBeGreaterThan(0);
  });

  test("self-referencing transition is valid (retry loop)", () => {
    const { ast } = parse(`
phase(clarify)
    .signals(CLARIFY_COMPLETE, CLARIFY_ERROR)
    .on(CLARIFY_COMPLETE, to: done)
    .on(CLARIFY_ERROR, to: clarify)

phase(done)
    .terminal()
`);
    expect(validate(ast!)).toHaveLength(0);
  });
});

// ── Compiler unit tests ───────────────────────────────────────────────────────

describe("compile() — slice 3: signals and transitions", () => {
  test("compiles full example to expected JSON", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const output = compile(ast!);
    expect(output).toEqual({
      version: "3.1",
      phases: {
        clarify: {
          command: "/collab.clarify",
          signals: ["CLARIFY_COMPLETE", "CLARIFY_ERROR"],
          transitions: {
            CLARIFY_COMPLETE: { to: "done" },
            CLARIFY_ERROR: { to: "clarify" },
          },
        },
        done: { terminal: true },
      },
    });
  });

  test("signals array order matches declaration order", () => {
    const { ast } = parse(`phase(p)\n    .signals(A, B, C)`);
    const out = compile(ast!);
    expect(out.phases["p"].signals).toEqual(["A", "B", "C"]);
  });

  test("phase without signals has no signals key", () => {
    const { ast } = parse(`phase(done)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["done"].signals).toBeUndefined();
  });

  test("phase without .on() has no transitions key", () => {
    const { ast } = parse(`phase(p)\n    .command("/cmd")\n    .signals(SIG)`);
    expect(compile(ast!).phases["p"].transitions).toBeUndefined();
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 3)", () => {
  const fullFile = "/tmp/pipelang-full.pipeline";
  const badRefFile = "/tmp/pipelang-bad-ref.pipeline";
  const badSigFile = "/tmp/pipelang-bad-sig.pipeline";

  writeFileSync(fullFile, FULL_EXAMPLE);
  writeFileSync(badRefFile, `
phase(clarify)
    .signals(DONE)
    .on(DONE, to: plaan)

phase(plan)
    .terminal()
`.trim());
  writeFileSync(badSigFile, `
phase(clarify)
    .signals(CLARIFY_COMPLETE)
    .on(CLARIFY_DONE, to: done)

phase(done)
    .terminal()
`.trim());

  test("valid file with signals/transitions exits 0", () => {
    expect(runCLI(["compile", fullFile]).exitCode).toBe(0);
  });

  test("valid file produces signals and transitions in output", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.phases.clarify.signals).toEqual(["CLARIFY_COMPLETE", "CLARIFY_ERROR"]);
    expect(out.phases.clarify.transitions.CLARIFY_COMPLETE).toEqual({ to: "done" });
  });

  test("undeclared phase reference exits 1", () => {
    expect(runCLI(["compile", badRefFile]).exitCode).toBe(1);
  });

  test("undeclared phase reference error message contains 'did you mean'", () => {
    const { stderr } = runCLI(["compile", badRefFile]);
    expect(stderr.toLowerCase()).toContain("did you mean");
  });

  test("undeclared signal exits 1 with error", () => {
    const { exitCode, stderr } = runCLI(["compile", badSigFile]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CLARIFY_DONE");
  });
});

// ── Duplicate name detection ───────────────────────────────────────────────────

describe("validator: duplicate phase names", () => {
  const source = `
phase(clarify) .signals(A) .on(A, to: clarify)
phase(clarify) .signals(B) .on(B, to: done)
phase(done)    .terminal()
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without parse errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("produces an error for duplicate phase name", () => {
    const dup = validateErrors.find((e) => e.message.includes("clarify") && e.message.includes("Duplicate"));
    expect(dup).toBeDefined();
  });

  test("duplicate error severity is error (not warning)", () => {
    const dup = validateErrors.find((e) => e.message.includes("Duplicate"));
    expect(dup?.severity).not.toBe("warning");
  });
});

describe("validator: duplicate gate names", () => {
  const source = `
phase(plan)    .signals(DONE) .on(DONE, gate: review)
phase(tasks)   .signals(OK)   .on(OK, to: done)
phase(done)    .terminal()
gate(review)   .prompt(.file("a.md")) .on(APPROVED, to: tasks)
gate(review)   .prompt(.file("b.md")) .on(APPROVED, to: tasks)
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without parse errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("produces an error for duplicate gate name", () => {
    const dup = validateErrors.find((e) => e.message.includes("review") && e.message.includes("Duplicate"));
    expect(dup).toBeDefined();
  });
});

describe("validator: unique names are accepted", () => {
  const source = `
phase(a) .signals(DONE) .on(DONE, to: b)
phase(b) .signals(DONE) .on(DONE, to: done)
phase(done) .terminal()
`;

  const { ast } = parse(source);
  const errors = ast ? validate(ast) : [];

  test("no duplicate errors for unique names", () => {
    const dupErrors = errors.filter((e) => e.message.includes("Duplicate"));
    expect(dupErrors).toHaveLength(0);
  });
});

// ── Cycle detection ───────────────────────────────────────────────────────────

describe("validator: cycle detection — two-phase cycle", () => {
  const source = `
phase(a) .signals(DONE) .on(DONE, to: b)
phase(b) .signals(DONE) .on(DONE, to: a)
phase(done) .terminal()
`;

  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses without parse errors", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("produces a cycle warning", () => {
    const cycles = validateErrors.filter((e) => e.message.startsWith("Cycle detected"));
    expect(cycles.length).toBeGreaterThan(0);
  });

  test("cycle warning has severity: warning (not error)", () => {
    const cycle = validateErrors.find((e) => e.message.startsWith("Cycle detected"));
    expect(cycle?.severity).toBe("warning");
  });

  test("cycle warning mentions both phases", () => {
    const cycle = validateErrors.find((e) => e.message.startsWith("Cycle detected"));
    expect(cycle?.message).toContain("a");
    expect(cycle?.message).toContain("b");
  });
});

describe("validator: cycle detection — three-phase cycle", () => {
  const source = `
phase(x) .signals(GO) .on(GO, to: y)
phase(y) .signals(GO) .on(GO, to: z)
phase(z) .signals(GO) .on(GO, to: x)
phase(done) .terminal()
`;

  const { ast } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("detects the three-phase cycle", () => {
    const cycle = validateErrors.find((e) => e.message.startsWith("Cycle detected"));
    expect(cycle).toBeDefined();
    expect(cycle?.severity).toBe("warning");
  });
});

describe("validator: cycle detection — self-loops are NOT flagged", () => {
  const source = `
phase(plan) .signals(DONE, ERR) .on(DONE, to: done) .on(ERR, to: plan)
phase(done) .terminal()
`;

  const { ast } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("self-loop produces no cycle warning", () => {
    const cycles = validateErrors.filter((e) => e.message.startsWith("Cycle detected"));
    expect(cycles).toHaveLength(0);
  });
});

describe("validator: cycle detection — gate hops are NOT flagged", () => {
  // plan → gate:review → REVISION_NEEDED → plan is NOT a direct to: cycle
  const source = `
phase(plan)  .signals(DONE, ERR) .on(DONE, gate: review) .on(ERR, to: plan)
phase(tasks) .signals(OK)        .on(OK, to: done)
phase(done)  .terminal()
gate(review) .prompt(.file("r.md")) .skipTo(tasks)
    .on(APPROVED, to: tasks)
    .on(REVISION_NEEDED, to: plan, maxRetries: 3, onExhaust: .skip)
`;

  const { ast } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("gate retry loop produces no cycle warning", () => {
    const cycles = validateErrors.filter(
      (e) => e.message.startsWith("Cycle detected") && e.severity === "warning"
    );
    expect(cycles).toHaveLength(0);
  });
});

describe("validator: cycle detection — golden pipeline has no spurious cycles", () => {
  // The golden collab.pipeline must compile cleanly (no cycle warnings)
  // even after adding implement → tasks conditional routing
  const { readFileSync } = require("fs");
  const { join } = require("path");
  const goldenSrc = readFileSync(join(import.meta.dir, "../collab.pipeline"), "utf-8");

  const { ast } = parse(goldenSrc);
  const validateErrors = ast ? validate(ast) : [];

  test("golden pipeline has no cycle warnings", () => {
    const cycles = validateErrors.filter((e) => e.message.startsWith("Cycle detected"));
    expect(cycles).toHaveLength(0);
  });
});
