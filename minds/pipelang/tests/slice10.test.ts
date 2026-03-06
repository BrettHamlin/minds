// BRE-333: Slice 11 — DSL .before() and .after() phase hooks
import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
import { validate } from "../src/validator";

// ── Parser: .before() and .after() ───────────────────────────────────────────

describe("parse() — .before() and .after() modifiers", () => {
  test(".before(phase) parses as BeforeModifier", () => {
    const src = `
phase(setup)
    .command("/cmd.setup")
    .signals(SETUP_DONE)
    .on(SETUP_DONE, to: done)

phase(main)
    .command("/cmd.main")
    .before(setup)
    .signals(MAIN_DONE)
    .on(MAIN_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const mainPhase = ast!.phases.find((p) => p.name === "main")!;
    const mod = mainPhase.modifiers.find((m) => m.kind === "before") as any;
    expect(mod).toBeDefined();
    expect(mod.phase).toBe("setup");
  });

  test(".after(phase) parses as AfterModifier", () => {
    const src = `
phase(tests)
    .command("/cmd.tests")
    .signals(TESTS_DONE)
    .on(TESTS_DONE, to: done)

phase(main)
    .command("/cmd.main")
    .after(tests)
    .signals(MAIN_DONE)
    .on(MAIN_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const mainPhase = ast!.phases.find((p) => p.name === "main")!;
    const mod = mainPhase.modifiers.find((m) => m.kind === "after") as any;
    expect(mod).toBeDefined();
    expect(mod.phase).toBe("tests");
  });

  test("multiple .before() modifiers on same phase", () => {
    const src = `
phase(a)
    .command("/a")
    .signals(A)
    .on(A, to: done)

phase(b)
    .command("/b")
    .signals(B)
    .on(B, to: done)

phase(main)
    .command("/main")
    .before(a)
    .before(b)
    .signals(M)
    .on(M, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const mainPhase = ast!.phases.find((p) => p.name === "main")!;
    const befores = mainPhase.modifiers.filter((m) => m.kind === "before") as any[];
    expect(befores).toHaveLength(2);
    expect(befores.map((m) => m.phase)).toEqual(["a", "b"]);
  });

  test(".before() with non-identifier argument produces error", () => {
    const { errors } = parse(`
phase(main)
    .command("/main")
    .before("not-an-ident")
    .terminal()
`.trim());
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Validator: .before() and .after() ────────────────────────────────────────

describe("validate() — .before() and .after() hook validation", () => {
  const VALID_SRC = `
phase(hook)
    .command("/hook")
    .signals(HOOK_DONE)
    .on(HOOK_DONE, to: done)

phase(main)
    .command("/main")
    .before(hook)
    .signals(MAIN_DONE)
    .on(MAIN_DONE, to: done)

phase(done)
    .terminal()
`.trim();

  test("valid .before() on a phase with command produces no errors", () => {
    const { ast } = parse(VALID_SRC);
    expect(validate(ast!).filter((e) => e.severity !== "warning")).toHaveLength(0);
  });

  test("error when referenced phase in .before() does not exist", () => {
    const src = `
phase(main)
    .command("/main")
    .before(ghost)
    .signals(MAIN_DONE)
    .on(MAIN_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const errors = validate(ast!).filter((e) => e.severity !== "warning");
    expect(errors.some((e) => e.message.includes("'ghost'") && e.message.includes("before"))).toBe(true);
  });

  test("error when referenced phase in .after() does not exist", () => {
    const src = `
phase(main)
    .command("/main")
    .after(ghost)
    .signals(MAIN_DONE)
    .on(MAIN_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const errors = validate(ast!).filter((e) => e.severity !== "warning");
    expect(errors.some((e) => e.message.includes("'ghost'") && e.message.includes("after"))).toBe(true);
  });

  test("error when .before() references a phase with no command", () => {
    const src = `
phase(noCmd)
    .terminal()

phase(main)
    .command("/main")
    .before(noCmd)
    .signals(MAIN_DONE)
    .on(MAIN_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const errors = validate(ast!).filter((e) => e.severity !== "warning");
    expect(errors.some((e) => e.message.includes("'noCmd'") && e.message.includes("dispatchable"))).toBe(true);
  });

  test("did-you-mean suggestion when referenced phase name is close", () => {
    const src = `
phase(hook_phase)
    .command("/hook")
    .signals(H)
    .on(H, to: done)

phase(main)
    .command("/main")
    .before(hook_phas)
    .signals(M)
    .on(M, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("Did you mean 'hook_phase'"))).toBe(true);
  });

  test("circular before hooks produce a cycle warning", () => {
    const src = `
phase(a)
    .command("/a")
    .before(b)
    .signals(A_DONE)
    .on(A_DONE, to: done)

phase(b)
    .command("/b")
    .before(a)
    .signals(B_DONE)
    .on(B_DONE, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("Cycle detected") && e.severity === "warning")).toBe(true);
  });
});

// ── Compiler: .before() and .after() ─────────────────────────────────────────

describe("compile() — .before() and .after() output", () => {
  test(".before(hook) compiles to before: [{phase: 'hook'}]", () => {
    const src = `
phase(hook)
    .command("/hook")
    .signals(H)
    .on(H, to: done)

phase(main)
    .command("/main")
    .before(hook)
    .signals(M)
    .on(M, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["main"].before).toEqual([{ phase: "hook" }]);
    expect(out.phases["main"].after).toBeUndefined();
  });

  test(".after(teardown) compiles to after: [{phase: 'teardown'}]", () => {
    const src = `
phase(teardown)
    .command("/teardown")
    .signals(T)
    .on(T, to: done)

phase(main)
    .command("/main")
    .after(teardown)
    .signals(M)
    .on(M, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["main"].after).toEqual([{ phase: "teardown" }]);
    expect(out.phases["main"].before).toBeUndefined();
  });

  test("multiple .before() compiles to ordered before array", () => {
    const src = `
phase(a)
    .command("/a")
    .signals(A)
    .on(A, to: done)

phase(b)
    .command("/b")
    .signals(B)
    .on(B, to: done)

phase(main)
    .command("/main")
    .before(a)
    .before(b)
    .signals(M)
    .on(M, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["main"].before).toEqual([{ phase: "a" }, { phase: "b" }]);
  });

  test("phases without hooks have no before/after fields", () => {
    const src = `
phase(p)
    .command("/p")
    .signals(P)
    .on(P, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["p"].before).toBeUndefined();
    expect(out.phases["p"].after).toBeUndefined();
  });

  test("both .before() and .after() compile independently", () => {
    const src = `
phase(pre)
    .command("/pre")
    .signals(PRE)
    .on(PRE, to: done)

phase(post)
    .command("/post")
    .signals(POST)
    .on(POST, to: done)

phase(main)
    .command("/main")
    .before(pre)
    .after(post)
    .signals(M)
    .on(M, to: done)

phase(done)
    .terminal()
`.trim();
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["main"].before).toEqual([{ phase: "pre" }]);
    expect(out.phases["main"].after).toEqual([{ phase: "post" }]);
  });
});

// ── LSP: .before() and .after() completions ───────────────────────────────────

describe("LSP completions — .before() and .after()", () => {
  const { getCompletions } = require("../src/lsp/completion");

  const DOC = `
phase(setup)
    .command("/setup")
    .signals(SETUP_DONE)
    .on(SETUP_DONE, to: done)

phase(main)
    .command("/main")
    .
`.trim();

  test("PHASE_MODIFIERS includes 'before' and 'after'", () => {
    const lines = DOC.split("\n");
    const lastLine = lines.length - 1;
    const pos = { line: lastLine, character: lines[lastLine].length };
    const items = getCompletions(DOC, pos);
    const labels = items.map((i: any) => i.label);
    expect(labels).toContain("before");
    expect(labels).toContain("after");
  });

  test("after .before( suggests phase names", () => {
    const src = `phase(setup)\n    .command("/s")\nphase(main)\n    .before(`;
    const lines = src.split("\n");
    const lastLine = lines.length - 1;
    const pos = { line: lastLine, character: lines[lastLine].length };
    const items = getCompletions(src, pos);
    const labels = items.map((i: any) => i.label);
    expect(labels).toContain("setup");
  });

  test("after .after( suggests phase names", () => {
    const src = `phase(teardown)\n    .command("/t")\nphase(main)\n    .after(`;
    const lines = src.split("\n");
    const lastLine = lines.length - 1;
    const pos = { line: lastLine, character: lines[lastLine].length };
    const items = getCompletions(src, pos);
    const labels = items.map((i: any) => i.label);
    expect(labels).toContain("teardown");
  });
});

// ── Orchestrator: resolveHooksForPhase ───────────────────────────────────────

describe("resolveHooksForPhase()", () => {
  // CROSS-MIND: runtime import only — Execution Mind owns dispatch-phase-hooks
  const { resolveHooksForPhase } = require("../../../src/scripts/orchestrator/dispatch-phase-hooks");

  const PIPELINE = {
    version: "3.1",
    phases: {
      hook: { command: "/hook", signals: ["HOOK_DONE"] },
      main: {
        command: "/main",
        signals: ["MAIN_DONE"],
        before: [{ phase: "hook" }],
        after: [{ phase: "cleanup" }],
      },
      cleanup: { command: "/cleanup", signals: ["CLEANUP_DONE"] },
      plain: { command: "/plain", signals: ["PLAIN_DONE"] },
      done: { terminal: true },
    },
  };

  test("returns before and after phase IDs for phase with hooks", () => {
    expect(resolveHooksForPhase(PIPELINE, "main", "pre")).toEqual(["hook"]);
    expect(resolveHooksForPhase(PIPELINE, "main", "post")).toEqual(["cleanup"]);
  });

  test("returns empty arrays for phase with no hooks", () => {
    expect(resolveHooksForPhase(PIPELINE, "plain", "pre")).toEqual([]);
    expect(resolveHooksForPhase(PIPELINE, "plain", "post")).toEqual([]);
  });

  test("returns empty arrays for non-existent phase", () => {
    expect(resolveHooksForPhase(PIPELINE, "nonexistent", "pre")).toEqual([]);
    expect(resolveHooksForPhase(PIPELINE, "nonexistent", "post")).toEqual([]);
  });

  test("returns empty arrays for terminal phase", () => {
    expect(resolveHooksForPhase(PIPELINE, "done", "pre")).toEqual([]);
    expect(resolveHooksForPhase(PIPELINE, "done", "post")).toEqual([]);
  });

  test("multiple before hooks returned in order", () => {
    const pipeline = {
      version: "3.1",
      phases: {
        main: {
          command: "/main",
          before: [{ phase: "a" }, { phase: "b" }, { phase: "c" }],
        },
        done: { terminal: true },
      },
    };
    expect(resolveHooksForPhase(pipeline, "main", "pre")).toEqual(["a", "b", "c"]);
  });
});
