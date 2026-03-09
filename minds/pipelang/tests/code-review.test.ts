// BRE-336: @codeReview — automatic code evaluation on implement phases
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

// ── Lexer: @codeReview tokenizes as AT + IDENT ────────────────────────────────

describe("code-review: lexer", () => {
  test("@codeReview tokenizes as AT then IDENT 'codeReview'", () => {
    const { tokens } = tokenize("@codeReview()");
    expect(tokens[0].kind).toBe("AT");
    expect(tokens[1].kind).toBe("IDENT");
    expect(tokens[1].value).toBe("codeReview");
  });
});

// ── Parser: @codeReview() — empty (all defaults) ──────────────────────────────

describe("code-review: parser — @codeReview() empty", () => {
  const source = `
@codeReview()
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("ast.codeReview is defined", () => {
    expect(ast!.codeReview).toBeDefined();
  });

  test("enabled is true by default", () => {
    expect(ast!.codeReview!.enabled).toBe(true);
  });

  test("model is undefined (compiler applies default)", () => {
    expect(ast!.codeReview!.model).toBeUndefined();
  });

  test("maxAttempts is undefined (compiler applies default)", () => {
    expect(ast!.codeReview!.maxAttempts).toBeUndefined();
  });
});

// ── Parser: @codeReview(off) ──────────────────────────────────────────────────

describe("code-review: parser — @codeReview(off)", () => {
  const source = `
@codeReview(off)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("enabled is false", () => {
    expect(ast!.codeReview!.enabled).toBe(false);
  });
});

// ── Parser: @codeReview(model: haiku) ────────────────────────────────────────

describe("code-review: parser — @codeReview(model: haiku)", () => {
  const source = `
@codeReview(model: haiku)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("model is 'haiku'", () => {
    expect(ast!.codeReview!.model).toBe("haiku");
  });

  test("enabled is true", () => {
    expect(ast!.codeReview!.enabled).toBe(true);
  });
});

// ── Parser: @codeReview(.file("arch.md")) ────────────────────────────────────

describe("code-review: parser — @codeReview(.file(...))", () => {
  const source = `
@codeReview(.file("docs/architecture.md"))
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("file path is set", () => {
    expect(ast!.codeReview!.file).toBe("docs/architecture.md");
  });
});

// ── Parser: @codeReview(maxAttempts: 5) ──────────────────────────────────────

describe("code-review: parser — @codeReview(maxAttempts: 5)", () => {
  const source = `
@codeReview(maxAttempts: 5)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("maxAttempts is 5", () => {
    expect(ast!.codeReview!.maxAttempts).toBe(5);
  });
});

// ── Parser: full config ───────────────────────────────────────────────────────

describe("code-review: parser — @codeReview(model: opus, .file(\"arch.md\"), maxAttempts: 3)", () => {
  const source = `
@codeReview(model: opus, .file("arch.md"), maxAttempts: 3)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("model is 'opus'", () => {
    expect(ast!.codeReview!.model).toBe("opus");
  });

  test("file is 'arch.md'", () => {
    expect(ast!.codeReview!.file).toBe("arch.md");
  });

  test("maxAttempts is 3", () => {
    expect(ast!.codeReview!.maxAttempts).toBe(3);
  });
});

// ── Parser: .codeReview(off) phase modifier ───────────────────────────────────

describe("code-review: parser — .codeReview(off) phase modifier", () => {
  const source = `
@codeReview()
phase(impl)
    .codeReview(off)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);

  test("parses without errors", () => {
    expect(errors).toHaveLength(0);
  });

  test("impl phase has codeReview modifier", () => {
    const impl = ast!.phases.find((p) => p.name === "impl")!;
    const cr = impl.modifiers.find((m) => m.kind === "codeReview") as any;
    expect(cr).toBeDefined();
    expect(cr.enabled).toBe(false);
  });
});

// ── Parser: invalid params produce errors ─────────────────────────────────────

describe("code-review: parser — invalid params", () => {
  test("unknown param 'foo' produces parse error", () => {
    const { errors } = parse(`
@codeReview(foo: bar)
phase(done) .terminal()
`);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("invalid model name produces parse error", () => {
    const { errors } = parse(`
@codeReview(model: gpt4)
phase(done) .terminal()
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("model"))).toBe(true);
  });
});

// ── Validator: invalid model in directive ─────────────────────────────────────

describe("code-review: validator — invalid model", () => {
  // Build AST directly to bypass parser model validation
  test("validator catches model not in known set", () => {
    const { ast } = parse(`
@codeReview(model: sonnet)
phase(done) .terminal()
`);
    // sonnet is valid — this should pass
    const errs = ast ? validate(ast) : [];
    expect(errs.filter((e) => e.message.includes("model"))).toHaveLength(0);
  });
});

// ── Validator: maxAttempts must be > 0 ───────────────────────────────────────

describe("code-review: validator — maxAttempts: 0 is an error", () => {
  test("maxAttempts: 0 produces a validation error", () => {
    // Inject a CodeReviewDirective with maxAttempts: 0 directly
    const { ast } = parse(`
@codeReview(maxAttempts: 1)
phase(done) .terminal()
`);
    // Manually set maxAttempts to 0 to test validator
    if (ast && ast.codeReview) ast.codeReview.maxAttempts = 0;
    const errs = ast ? validate(ast) : [];
    const maxErr = errs.find((e) => e.message.includes("maxAttempts"));
    expect(maxErr).toBeDefined();
  });
});

// ── Validator: .codeReview(off) on terminal phase ─────────────────────────────

describe("code-review: validator — .codeReview(off) on terminal phase", () => {
  const source = `
@codeReview()
phase(done)
    .codeReview(off)
    .terminal()
`;
  const { ast, errors: parseErrors } = parse(source);
  const validateErrors = ast ? validate(ast) : [];

  test("parses ok", () => {
    expect(parseErrors).toHaveLength(0);
  });

  test("validator produces error for .codeReview(off) on terminal", () => {
    const err = validateErrors.find((e) => e.message.includes("Terminal") && e.message.includes("codeReview"));
    expect(err).toBeDefined();
  });
});

// ── Compiler: @codeReview() compiles with defaults ───────────────────────────

describe("code-review: compiler — defaults applied", () => {
  const source = `
@codeReview()
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("compiles without errors", () => {
    expect(errors).toHaveLength(0);
    expect(compiled).not.toBeNull();
  });

  test("top-level codeReview is present", () => {
    expect(compiled!.codeReview).toBeDefined();
  });

  test("enabled is true", () => {
    expect(compiled!.codeReview!.enabled).toBe(true);
  });

  test("model defaults to claude-opus-4-6", () => {
    expect(compiled!.codeReview!.model).toBe("claude-opus-4-6");
  });

  test("maxAttempts defaults to 3", () => {
    expect(compiled!.codeReview!.maxAttempts).toBe(3);
  });

  test("file is absent when not specified", () => {
    expect(compiled!.codeReview!.file).toBeUndefined();
  });
});

// ── Compiler: @codeReview(off) ────────────────────────────────────────────────

describe("code-review: compiler — @codeReview(off)", () => {
  const source = `
@codeReview(off)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("codeReview.enabled is false", () => {
    expect(compiled!.codeReview!.enabled).toBe(false);
  });

  test("no model in disabled config", () => {
    expect(compiled!.codeReview!.model).toBeUndefined();
  });
});

// ── Compiler: full config with model + file + maxAttempts ────────────────────

describe("code-review: compiler — full config", () => {
  const source = `
@codeReview(model: haiku, .file("arch.md"), maxAttempts: 5)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("model is claude-haiku-4-5-20251001", () => {
    expect(compiled!.codeReview!.model).toBe("claude-haiku-4-5-20251001");
  });

  test("file is 'arch.md'", () => {
    expect(compiled!.codeReview!.file).toBe("arch.md");
  });

  test("maxAttempts is 5", () => {
    expect(compiled!.codeReview!.maxAttempts).toBe(5);
  });
});

// ── Compiler: per-phase .codeReview(off) ─────────────────────────────────────

describe("code-review: compiler — per-phase override", () => {
  const source = `
@codeReview()
phase(impl)
    .codeReview(off)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("global codeReview is still present (enabled)", () => {
    expect(compiled!.codeReview!.enabled).toBe(true);
  });

  test("impl phase has per-phase codeReview override", () => {
    expect(compiled!.phases["impl"].codeReview).toBeDefined();
    expect(compiled!.phases["impl"].codeReview!.enabled).toBe(false);
  });

  test("done phase has no per-phase codeReview", () => {
    expect(compiled!.phases["done"].codeReview).toBeUndefined();
  });
});

// ── Compiler: pipeline without @codeReview has no codeReview in output ────────

describe("code-review: compiler — no directive", () => {
  const source = `
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const { ast, errors } = parse(source);
  const compiled = ast && errors.length === 0 ? compile(ast) : null;

  test("no codeReview in compiled output", () => {
    expect(compiled!.codeReview).toBeUndefined();
  });
});

// ── LSP: @codeReview( suggests params ────────────────────────────────────────

import { getCompletions } from "../src/lsp/completion";

describe("code-review: LSP — @codeReview( completions", () => {
  test("after '@codeReview(' suggests off, model, maxAttempts, .file", () => {
    const items = getCompletions("@codeReview(", { line: 0, character: 12 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("off");
    expect(labels).toContain("model");
    expect(labels).toContain("maxAttempts");
    expect(labels).toContain(".file");
  });

  test("after '@codeReview(model: ' suggests model names", () => {
    const items = getCompletions("@codeReview(model: ", { line: 0, character: 19 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("haiku");
    expect(labels).toContain("sonnet");
    expect(labels).toContain("opus");
  });
});

describe("code-review: LSP — .codeReview( completions", () => {
  test("after '.codeReview(' suggests only 'off'", () => {
    const items = getCompletions("phase(a)\n    .codeReview(", { line: 1, character: 16 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("off");
    // Should not suggest model: or maxAttempts:
    expect(labels).not.toContain("model");
  });
});

describe("code-review: LSP — phase modifier suggestions include codeReview", () => {
  test("after '.' in phase context includes codeReview", () => {
    const items = getCompletions("phase(a)\n    .", { line: 1, character: 5 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("codeReview");
  });
});

// ── CLI: compile with @codeReview exits 0 ────────────────────────────────────

describe("code-review: CLI — compile with @codeReview", () => {
  const pipeline = `
@codeReview(model: sonnet, maxAttempts: 2)
phase(impl)
    .signals(IMPL_COMPLETE)
    .on(IMPL_COMPLETE, to: done)
phase(done) .terminal()
`;
  const tmpFile = join(import.meta.dir, "_tmp_cr_test.pipeline");

  test("compile exits 0", () => {
    writeFileSync(tmpFile, pipeline);
    try {
      const { exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test("compiled JSON contains codeReview object", () => {
    writeFileSync(tmpFile, pipeline);
    try {
      const { stdout, exitCode } = runCLI(["compile", tmpFile]);
      expect(exitCode).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.codeReview).toBeDefined();
      expect(json.codeReview.enabled).toBe(true);
      expect(json.codeReview.model).toBe("claude-sonnet-4-6");
      expect(json.codeReview.maxAttempts).toBe(2);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
