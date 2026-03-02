// BRE-343: @metrics — system node infrastructure directive
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

describe("metrics: lexer", () => {
  test("@metrics tokenizes as AT then IDENT 'metrics'", () => {
    const { tokens } = tokenize("@metrics()");
    expect(tokens[0].kind).toBe("AT");
    expect(tokens[1].kind).toBe("IDENT");
    expect(tokens[1].value).toBe("metrics");
  });
});

// ── Parser: @metrics() — empty (enabled by default) ──────────────────────────

describe("metrics: parser — @metrics() empty", () => {
  const { ast, errors } = parse(`@metrics()\n${BASE_PHASES}`);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("ast.metrics is defined", () => {
    expect(ast!.metrics).toBeDefined();
  });

  test("enabled is true by default", () => {
    expect(ast!.metrics!.enabled).toBe(true);
  });
});

// ── Parser: @metrics(off) ─────────────────────────────────────────────────────

describe("metrics: parser — @metrics(off)", () => {
  const { ast, errors } = parse(`@metrics(off)\n${BASE_PHASES}`);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("enabled is false", () => {
    expect(ast!.metrics!.enabled).toBe(false);
  });
});

// ── Parser: @metrics(false) ───────────────────────────────────────────────────

describe("metrics: parser — @metrics(false)", () => {
  const { ast, errors } = parse(`@metrics(false)\n${BASE_PHASES}`);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("enabled is false", () => {
    expect(ast!.metrics!.enabled).toBe(false);
  });
});

// ── Parser: .metrics(off) phase modifier ──────────────────────────────────────

describe("metrics: parser — .metrics(off) phase modifier", () => {
  const source = `
@metrics()
phase(impl)
    .metrics(off)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("impl phase has metrics modifier", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const m = impl.modifiers.find((mod) => mod.kind === "metrics") as any;
    expect(m).toBeDefined();
    expect(m.enabled).toBe(false);
  });
});

// ── Parser: invalid param produces error ──────────────────────────────────────

describe("metrics: parser — invalid params", () => {
  test("unknown param 'foo' produces parse error", () => {
    const { errors } = parse(`@metrics(foo)\n${BASE_PHASES}`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("Unknown parameter"))).toBe(true);
  });
});

// ── Validator: .metrics(off) on terminal phase ────────────────────────────────

describe("metrics: validator — .metrics(off) on terminal phase", () => {
  const source = `
@metrics()
phase(done)
    .metrics(off)
    .terminal()
`;
  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses ok", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("validator produces error for .metrics(off) on terminal", () => {
    const err = validateErrors.find((e) => e.message.includes("Terminal") && e.message.includes("metrics"));
    expect(err).toBeDefined();
  });
});

// ── Compiler: @metrics() compiles to enabled: true ───────────────────────────

describe("metrics: compiler — @metrics() enabled", () => {
  const { ast, errors } = parse(`@metrics()\n${BASE_PHASES}`);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("compiles without errors", () => {
    expect(errors).toHaveLength(0);
    expect(compiled).not.toBeNull();
  });

  test("top-level metrics is present", () => {
    expect(compiled!.metrics).toBeDefined();
  });

  test("enabled is true", () => {
    expect(compiled!.metrics!.enabled).toBe(true);
  });
});

// ── Compiler: @metrics(false) compiles to enabled: false ─────────────────────

describe("metrics: compiler — @metrics(false)", () => {
  const { ast, errors } = parse(`@metrics(false)\n${BASE_PHASES}`);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("metrics.enabled is false", () => {
    expect(compiled!.metrics!.enabled).toBe(false);
  });
});

// ── Compiler: @metrics(off) compiles to enabled: false ───────────────────────

describe("metrics: compiler — @metrics(off)", () => {
  const { ast, errors } = parse(`@metrics(off)\n${BASE_PHASES}`);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("metrics.enabled is false", () => {
    expect(compiled!.metrics!.enabled).toBe(false);
  });
});

// ── Compiler: per-phase .metrics(off) ────────────────────────────────────────

describe("metrics: compiler — per-phase .metrics(off) override", () => {
  const source = `
@metrics()
phase(impl)
    .metrics(off)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("global metrics is still enabled", () => {
    expect(compiled!.metrics!.enabled).toBe(true);
  });

  test("impl phase has per-phase metrics override", () => {
    expect(compiled!.phases["impl"].metrics).toBeDefined();
    expect(compiled!.phases["impl"].metrics!.enabled).toBe(false);
  });

  test("done phase has no per-phase metrics", () => {
    expect(compiled!.phases["done"].metrics).toBeUndefined();
  });
});

// ── Compiler: no directive → no metrics in output ────────────────────────────

describe("metrics: compiler — no directive", () => {
  const { ast, errors } = parse(BASE_PHASES);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("no metrics in compiled output when directive absent", () => {
    expect(compiled!.metrics).toBeUndefined();
  });
});

// ── CLI: compile with @metrics exits 0 ───────────────────────────────────────

describe("metrics: CLI — compile with @metrics", () => {
  const pipeline = `@metrics()\n${BASE_PHASES}`;
  const tmpFile = join(import.meta.dir, "_tmp_metrics_test.pipeline");

  test("compile exits 0 and JSON contains metrics object", () => {
    writeFileSync(tmpFile, pipeline);
    try {
      const { stdout, exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.metrics).toBeDefined();
      expect(json.metrics.enabled).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test("@metrics(false) compiles to enabled: false in JSON", () => {
    writeFileSync(tmpFile, `@metrics(false)\n${BASE_PHASES}`);
    try {
      const { stdout, exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.metrics.enabled).toBe(false);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

// ── LSP: @metrics completions ─────────────────────────────────────────────────

import { getCompletions } from "../src/lsp/completion";

describe("metrics: LSP — @metrics( completions", () => {
  test("after '@metrics(' suggests off and false", () => {
    const items = getCompletions("@metrics(", { line: 0, character: 9 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("off");
    expect(labels).toContain("false");
  });
});

describe("metrics: LSP — .metrics( completions", () => {
  test("after '.metrics(' suggests only 'off'", () => {
    const items = getCompletions("phase(a)\n    .metrics(", { line: 1, character: 13 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("off");
    expect(labels).not.toContain("false");
  });
});

describe("metrics: LSP — phase modifier suggestions include metrics", () => {
  test("after '.' in phase context includes metrics", () => {
    const items = getCompletions("phase(a)\n    .", { line: 1, character: 5 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("metrics");
  });
});
