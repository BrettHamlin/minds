// BRE-301: Slice 2 — Phases with commands
import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
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

// ── Parser unit tests ─────────────────────────────────────────────────────────

describe("parse() — slice 2: .command()", () => {
  test("parses .command() modifier with string arg", () => {
    const { ast, errors } = parse(`phase(clarify)\n    .command("/collab.clarify")`);
    expect(errors).toHaveLength(0);
    expect(ast!.phases[0].modifiers).toHaveLength(1);
    expect(ast!.phases[0].modifiers[0].kind).toBe("command");
    if (ast!.phases[0].modifiers[0].kind === "command") {
      expect(ast!.phases[0].modifiers[0].value).toBe("/collab.clarify");
    }
  });

  test("parses multiple phases in one file", () => {
    const src = `
phase(clarify)
    .command("/collab.clarify")

phase(done)
    .terminal()
`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    expect(ast!.phases).toHaveLength(2);
    expect(ast!.phases[0].name).toBe("clarify");
    expect(ast!.phases[1].name).toBe("done");
  });

  test("command string preserves content including slashes", () => {
    const { ast } = parse(`phase(p)\n    .command("/collab.plan")`);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("command");
    if (mod.kind === "command") expect(mod.value).toBe("/collab.plan");
  });

  test("missing closing quote produces error with line number", () => {
    const { errors } = parse(`phase(p)\n    .command("/collab.clarify)`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].loc.line).toBeGreaterThan(0);
  });

  test("missing string arg for command produces readable error", () => {
    const { errors } = parse(`phase(p)\n    .command()`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("string argument");
  });
});

// ── Compiler unit tests ───────────────────────────────────────────────────────

describe("compile() — slice 2: .command()", () => {
  test("two-phase pipeline compiles to expected JSON", () => {
    const { ast } = parse(`
phase(clarify)
    .command("/collab.clarify")

phase(done)
    .terminal()
`);
    const output = compile(ast!);
    expect(output).toEqual({
      version: "3.1",
      phases: {
        clarify: { command: "/collab.clarify" },
        done: { terminal: true },
      },
    });
  });

  test("command string appears verbatim in JSON output", () => {
    const { ast } = parse(`phase(p)\n    .command("/collab.plan")`);
    expect(compile(ast!).phases["p"].command).toBe("/collab.plan");
  });

  test("phase order matches declaration order", () => {
    const { ast } = parse(`phase(a)\n    .command("cmd-a")\nphase(b)\n    .command("cmd-b")`);
    const keys = Object.keys(compile(ast!).phases);
    expect(keys[0]).toBe("a");
    expect(keys[1]).toBe("b");
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 2)", () => {
  const twoPhasesFile = "/tmp/pipelang-two-phases.pipeline";

  writeFileSync(twoPhasesFile, `
phase(clarify)
    .command("/collab.clarify")

phase(done)
    .terminal()
`.trim());

  test("two-phases.pipeline compiles — exits 0", () => {
    const { exitCode } = runCLI(["compile", twoPhasesFile]);
    expect(exitCode).toBe(0);
  });

  test("two-phases.pipeline — command string present in output", () => {
    const { stdout } = runCLI(["compile", twoPhasesFile]);
    const parsed = JSON.parse(stdout);
    expect(parsed.phases.clarify.command).toBe("/collab.clarify");
  });

  test("two-phases.pipeline — both phases present in output", () => {
    const { stdout } = runCLI(["compile", twoPhasesFile]);
    const parsed = JSON.parse(stdout);
    expect(parsed.phases).toHaveProperty("clarify");
    expect(parsed.phases).toHaveProperty("done");
  });
});
