// BRE-306: Slice 7 — Actions blocks (display, prompt, command)
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
phase(blindqa)
    .actions {
        display("Running QA for \${TICKET_ID}")
        display(ai("summarize the changes"))
        display(.file("templates/qa-header.md"))
        command("/collab.blindqa")
    }
    .signals(BLINDQA_PASSED, BLINDQA_FAILED)
    .on(BLINDQA_PASSED, to: done)
    .on(BLINDQA_FAILED, to: implement)

phase(implement)
    .command("/collab.implement")
    .signals(IMPLEMENT_COMPLETE)
    .on(IMPLEMENT_COMPLETE, to: blindqa)

phase(done)
    .terminal()
`.trim();

// ── Lexer: braces must tokenize correctly ─────────────────────────────────────

describe("tokenize() — slice 6: LBRACE/RBRACE tokens", () => {
  test("{ tokenizes to LBRACE", () => {
    const { tokenize } = require("../src/lexer");
    const { tokens } = tokenize("phase(p) .actions { }");
    expect(tokens.some((t: any) => t.kind === "LBRACE")).toBe(true);
    expect(tokens.some((t: any) => t.kind === "RBRACE")).toBe(true);
  });
});

// ── Parser unit tests ─────────────────────────────────────────────────────────

describe("parse() — slice 6: actions blocks", () => {
  test("parses .actions {} block", () => {
    const { ast, errors } = parse(`phase(p)\n    .actions {\n        command("/cmd")\n    }\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("actions");
  });

  test("parses display() with inline string", () => {
    const { ast, errors } = parse(`phase(p)\n    .actions {\n        display("hello")\n    }\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const actions = (ast!.phases[0].modifiers[0] as any).actions;
    expect(actions[0].kind).toBe("display");
    expect(actions[0].value).toEqual({ kind: "inline", text: "hello" });
  });

  test("parses display() with ai() form", () => {
    const { ast, errors } = parse(`phase(p)\n    .actions {\n        display(ai("summarize"))\n    }\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const actions = (ast!.phases[0].modifiers[0] as any).actions;
    expect(actions[0].value).toEqual({ kind: "ai", expr: "summarize" });
  });

  test("parses display() with .file() form", () => {
    const { ast, errors } = parse(`phase(p)\n    .actions {\n        display(.file("header.md"))\n    }\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const actions = (ast!.phases[0].modifiers[0] as any).actions;
    expect(actions[0].value).toEqual({ kind: "file", path: "header.md" });
  });

  test("parses prompt() with inline string", () => {
    const { ast, errors } = parse(`phase(p)\n    .actions {\n        prompt("Enter value")\n    }\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const actions = (ast!.phases[0].modifiers[0] as any).actions;
    expect(actions[0].kind).toBe("prompt");
    expect(actions[0].value).toEqual({ kind: "inline", text: "Enter value" });
  });

  test("parses command() in actions block", () => {
    const { ast, errors } = parse(`phase(p)\n    .actions {\n        command("/collab.blindqa")\n    }\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const actions = (ast!.phases[0].modifiers[0] as any).actions;
    expect(actions[0]).toEqual({ kind: "command", value: "/collab.blindqa", loc: { line: 3, col: 9 } });
  });

  test("parses all three action types in order", () => {
    const { ast, errors } = parse(FULL_EXAMPLE);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0] as any;
    expect(mod.kind).toBe("actions");
    expect(mod.actions).toHaveLength(4);
    expect(mod.actions[0].kind).toBe("display"); // inline
    expect(mod.actions[1].kind).toBe("display"); // ai
    expect(mod.actions[2].kind).toBe("display"); // .file
    expect(mod.actions[3].kind).toBe("command");
  });

  test("full example parses without errors", () => {
    const { errors } = parse(FULL_EXAMPLE);
    expect(errors).toHaveLength(0);
  });
});

// ── Validator unit tests ──────────────────────────────────────────────────────

describe("validate() — slice 6: actions block constraints", () => {
  test("duplicate command() in actions block produces error", () => {
    const { ast } = parse(`
phase(p)
    .actions {
        command("/collab.blindqa")
        command("/collab.another")
    }
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("Only one command"))).toBe(true);
  });

  test("single command() is valid", () => {
    const { ast } = parse(`phase(p)\n    .actions {\n        command("/cmd")\n    }\n    .terminal()`);
    expect(validate(ast!)).toHaveLength(0);
  });

  test("unknown ${TOKEN} in display() produces error", () => {
    const { ast } = parse(`
phase(p)
    .actions {
        display("Hello \${UNKNOWN_VAR}")
    }
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors.some((e) => e.message.includes("UNKNOWN_VAR"))).toBe(true);
  });

  test("built-in ${TOKEN} variables are valid", () => {
    const { ast } = parse(`
phase(p)
    .actions {
        display("Running \${TICKET_ID} in phase \${PHASE}")
        display("Signal was \${INCOMING_SIGNAL}")
    }
    .terminal()
`);
    const errors = validate(ast!);
    expect(errors).toHaveLength(0);
  });

  test("all 5 built-in tokens are valid", () => {
    const { ast } = parse(`
phase(p)
    .actions {
        display("\${TICKET_ID} \${TICKET_TITLE} \${PHASE} \${INCOMING_SIGNAL} \${INCOMING_DETAIL}")
    }
    .terminal()
`);
    expect(validate(ast!)).toHaveLength(0);
  });

  test("ai() and .file() values are exempt from token validation", () => {
    const { ast } = parse(`
phase(p)
    .actions {
        display(ai("use \${ANYTHING} freely"))
        display(.file("any/path"))
    }
    .terminal()
`);
    // ai() and .file() bypass token validation — no errors
    expect(validate(ast!)).toHaveLength(0);
  });
});

// ── Compiler unit tests ───────────────────────────────────────────────────────

describe("compile() — slice 6: actions blocks", () => {
  test("inline string display compiles to string value", () => {
    const { ast } = parse(`phase(p)\n    .actions {\n        display("hello")\n    }\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toEqual([{ display: "hello" }]);
  });

  test("ai() display compiles to { ai: expr }", () => {
    const { ast } = parse(`phase(p)\n    .actions {\n        display(ai("summarize"))\n    }\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toEqual([{ display: { ai: "summarize" } }]);
  });

  test(".file() display compiles to { file: path }", () => {
    const { ast } = parse(`phase(p)\n    .actions {\n        display(.file("header.md"))\n    }\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toEqual([{ display: { file: "header.md" } }]);
  });

  test("prompt() compiles to prompt key", () => {
    const { ast } = parse(`phase(p)\n    .actions {\n        prompt("Enter value")\n    }\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toEqual([{ prompt: "Enter value" }]);
  });

  test("command() in actions compiles to command key", () => {
    const { ast } = parse(`phase(p)\n    .actions {\n        command("/collab.blindqa")\n    }\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toEqual([{ command: "/collab.blindqa" }]);
  });

  test("action order is preserved in compiled output", () => {
    const src = `phase(p)\n    .actions {\n        display("first")\n        display(ai("second"))\n        command("/cmd")\n    }\n    .terminal()`;
    const { ast } = parse(src);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toEqual([
      { display: "first" },
      { display: { ai: "second" } },
      { command: "/cmd" },
    ]);
  });

  test("phase without actions has no actions key", () => {
    const { ast } = parse(`phase(p)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].actions).toBeUndefined();
  });

  test("full example compiles to expected JSON", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out.phases["blindqa"]).toEqual({
      actions: [
        { display: "Running QA for ${TICKET_ID}" },
        { display: { ai: "summarize the changes" } },
        { display: { file: "templates/qa-header.md" } },
        { command: "/collab.blindqa" },
      ],
      signals: ["BLINDQA_PASSED", "BLINDQA_FAILED"],
      transitions: {
        BLINDQA_PASSED: { to: "done" },
        BLINDQA_FAILED: { to: "implement" },
      },
    });
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 6)", () => {
  const fullFile = "/tmp/pipelang-slice6-full.pipeline";
  const dualCmdFile = "/tmp/pipelang-slice6-dual-cmd.pipeline";

  writeFileSync(fullFile, FULL_EXAMPLE);
  writeFileSync(
    dualCmdFile,
    `phase(p)\n    .actions {\n        command("/a")\n        command("/b")\n    }\n    .terminal()`
  );

  test("valid actions block exits 0", () => {
    expect(runCLI(["compile", fullFile]).exitCode).toBe(0);
  });

  test("valid actions block produces correct JSON output", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.phases.blindqa.actions[0]).toEqual({ display: "Running QA for ${TICKET_ID}" });
    expect(out.phases.blindqa.actions[1]).toEqual({ display: { ai: "summarize the changes" } });
    expect(out.phases.blindqa.actions[2]).toEqual({ display: { file: "templates/qa-header.md" } });
    expect(out.phases.blindqa.actions[3]).toEqual({ command: "/collab.blindqa" });
  });

  test("duplicate command() exits 1", () => {
    const { exitCode, stderr } = runCLI(["compile", dualCmdFile]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Only one command");
  });
});

// ── Lexer: string escape sequences ────────────────────────────────────────────

describe("lexer: string escape sequences", () => {
  const { tokenize } = require("../src/lexer");

  test('\\\\" unescapes to double-quote', () => {
    const { tokens } = tokenize('"say \\"hello\\""');
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe('say "hello"');
  });

  test("\\\\n unescapes to newline character", () => {
    const { tokens } = tokenize('"line1\\nline2"');
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("line1\nline2");
  });

  test("\\\\t unescapes to tab character", () => {
    const { tokens } = tokenize('"col1\\tcol2"');
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("col1\tcol2");
  });

  test("\\\\\\\\ unescapes to single backslash", () => {
    const { tokens } = tokenize('"C:\\\\path"');
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("C:\\path");
  });

  test("unknown escape sequence keeps backslash", () => {
    const { tokens } = tokenize('"\\x"');
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("\\x");
  });
});
