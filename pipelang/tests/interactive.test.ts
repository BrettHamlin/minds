// BRE-406: @interactive — batch question/answer protocol directive
import { describe, test, expect } from "bun:test";
import { tokenize } from "../src/lexer";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
import { validate } from "../src/validator";
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

const BASE_PHASES = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;

// ── Lexer ─────────────────────────────────────────────────────────────────────

describe("interactive: lexer", () => {
  test("@interactive tokenizes as AT then IDENT 'interactive'", () => {
    const { tokens } = tokenize("@interactive()");
    expect(tokens[0].kind).toBe("AT");
    expect(tokens[1].kind).toBe("IDENT");
    expect(tokens[1].value).toBe("interactive");
  });
});

// ── Parser: @interactive() — empty (enabled by default) ──────────────────────

describe("interactive: parser — @interactive() empty", () => {
  const { ast, errors } = parse(`@interactive()\n${BASE_PHASES}`);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("ast.interactive is defined", () => {
    expect(ast!.interactive).toBeDefined();
  });

  test("enabled is true by default", () => {
    expect(ast!.interactive!.enabled).toBe(true);
  });
});

// ── Parser: @interactive(off) ─────────────────────────────────────────────────

describe("interactive: parser — @interactive(off)", () => {
  const { ast, errors } = parse(`@interactive(off)\n${BASE_PHASES}`);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("enabled is false", () => {
    expect(ast!.interactive!.enabled).toBe(false);
  });
});

// ── Parser: @interactive(on) — explicit enabled ───────────────────────────────

describe("interactive: parser — @interactive(on)", () => {
  const { ast, errors } = parse(`@interactive(on)\n${BASE_PHASES}`);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("enabled is true", () => {
    expect(ast!.interactive!.enabled).toBe(true);
  });
});

// ── Parser: invalid param produces error ──────────────────────────────────────

describe("interactive: parser — invalid params", () => {
  test("unknown param 'foo' produces parse error", () => {
    const { errors } = parse(`@interactive(foo)\n${BASE_PHASES}`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("Unknown parameter"))).toBe(true);
  });
});

// ── Parser: .interactive(on) phase modifier ───────────────────────────────────

describe("interactive: parser — .interactive(on) phase modifier", () => {
  const source = `
@interactive(off)
phase(impl)
    .interactive(on)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("impl phase has interactive modifier enabled=true", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const m = impl.modifiers.find((mod) => mod.kind === "interactive") as any;
    expect(m).toBeDefined();
    expect(m.enabled).toBe(true);
  });
});

// ── Parser: .interactive(off) phase modifier ──────────────────────────────────

describe("interactive: parser — .interactive(off) phase modifier", () => {
  const source = `
@interactive()
phase(impl)
    .interactive(off)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("impl phase has interactive modifier enabled=false", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const m = impl.modifiers.find((mod) => mod.kind === "interactive") as any;
    expect(m).toBeDefined();
    expect(m.enabled).toBe(false);
  });
});

// ── Parser: .interactive() invalid modifier (no arg) ─────────────────────────

describe("interactive: parser — .interactive() without arg produces error", () => {
  const source = `
phase(impl)
    .interactive()
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { errors } = parse(source);

  test("produces parse error for missing on/off", () => {
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("on") || e.message.includes("off"))).toBe(true);
  });
});

// ── Validator: .interactive() on terminal phase ───────────────────────────────

describe("interactive: validator — .interactive(off) on terminal phase", () => {
  const source = `
@interactive()
phase(done)
    .interactive(off)
    .terminal()
`;
  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses ok", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("validator produces error for .interactive() on terminal", () => {
    const err = validateErrors.find(
      (e) => e.message.includes("Terminal") && e.message.includes("interactive"),
    );
    expect(err).toBeDefined();
  });
});

// ── Compiler: @interactive() compiles to enabled: true ───────────────────────

describe("interactive: compiler — @interactive() enabled", () => {
  const { ast, errors } = parse(`@interactive()\n${BASE_PHASES}`);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("compiles without errors", () => {
    expect(errors).toHaveLength(0);
    expect(compiled).not.toBeNull();
  });

  test("top-level interactive is present", () => {
    expect(compiled!.interactive).toBeDefined();
  });

  test("enabled is true", () => {
    expect(compiled!.interactive!.enabled).toBe(true);
  });
});

// ── Compiler: @interactive(off) compiles to enabled: false ───────────────────

describe("interactive: compiler — @interactive(off)", () => {
  const { ast, errors } = parse(`@interactive(off)\n${BASE_PHASES}`);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("interactive.enabled is false", () => {
    expect(compiled!.interactive!.enabled).toBe(false);
  });
});

// ── Compiler: @interactive(on) compiles to enabled: true ─────────────────────

describe("interactive: compiler — @interactive(on)", () => {
  const { ast, errors } = parse(`@interactive(on)\n${BASE_PHASES}`);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("interactive.enabled is true", () => {
    expect(compiled!.interactive!.enabled).toBe(true);
  });
});

// ── Compiler: per-phase .interactive(off) override ───────────────────────────

describe("interactive: compiler — per-phase .interactive(off) override", () => {
  const source = `
@interactive()
phase(impl)
    .interactive(off)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("global interactive is still enabled", () => {
    expect(compiled!.interactive!.enabled).toBe(true);
  });

  test("impl phase has per-phase interactive override enabled=false", () => {
    expect(compiled!.phases["impl"].interactive).toBeDefined();
    expect(compiled!.phases["impl"].interactive!.enabled).toBe(false);
  });

  test("done phase has no per-phase interactive", () => {
    expect(compiled!.phases["done"].interactive).toBeUndefined();
  });
});

// ── Compiler: per-phase .interactive(on) override ────────────────────────────

describe("interactive: compiler — per-phase .interactive(on) override", () => {
  const source = `
@interactive(off)
phase(impl)
    .interactive(on)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("global interactive is disabled", () => {
    expect(compiled!.interactive!.enabled).toBe(false);
  });

  test("impl phase has per-phase interactive override enabled=true", () => {
    expect(compiled!.phases["impl"].interactive).toBeDefined();
    expect(compiled!.phases["impl"].interactive!.enabled).toBe(true);
  });
});

// ── Compiler: no directive → no interactive in output ────────────────────────

describe("interactive: compiler — no directive", () => {
  const { ast, errors } = parse(BASE_PHASES);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("no interactive in compiled output when directive absent", () => {
    expect(compiled!.interactive).toBeUndefined();
  });
});

// ── CLI: compile with @interactive exits 0 ───────────────────────────────────

describe("interactive: CLI — compile with @interactive", () => {
  const pipeline = `@interactive()\n${BASE_PHASES}`;
  const tmpFile = join(import.meta.dir, "_tmp_interactive_test.pipeline");

  test("compile exits 0 and JSON contains interactive object", () => {
    writeFileSync(tmpFile, pipeline);
    try {
      const { stdout, exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.interactive).toBeDefined();
      expect(json.interactive.enabled).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test("@interactive(off) compiles to enabled: false in JSON", () => {
    writeFileSync(tmpFile, `@interactive(off)\n${BASE_PHASES}`);
    try {
      const { stdout, exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.interactive.enabled).toBe(false);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test("@interactive(on) compiles to enabled: true in JSON", () => {
    writeFileSync(tmpFile, `@interactive(on)\n${BASE_PHASES}`);
    try {
      const { stdout, exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.interactive.enabled).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

// ── LSP: @interactive completions ─────────────────────────────────────────────

import { getCompletions } from "../src/lsp/completion";

describe("interactive: LSP — @interactive( completions", () => {
  test("after '@interactive(' suggests on and off", () => {
    const items = getCompletions("@interactive(", { line: 0, character: 13 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("on");
    expect(labels).toContain("off");
  });
});

describe("interactive: LSP — .interactive( completions", () => {
  test("after '.interactive(' suggests on and off", () => {
    const items = getCompletions("phase(a)\n    .interactive(", { line: 1, character: 17 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("on");
    expect(labels).toContain("off");
  });
});

describe("interactive: LSP — phase modifier suggestions include interactive", () => {
  test("after '.' in phase context includes interactive", () => {
    const items = getCompletions("phase(a)\n    .", { line: 1, character: 5 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("interactive");
  });
});

describe("interactive: LSP — top-level keywords include @interactive", () => {
  test("at top level includes @interactive", () => {
    const items = getCompletions("", { line: 0, character: 0 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("@interactive");
  });
});
