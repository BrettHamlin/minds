// BRE-300: Slice 1 — Hello World compiler tests
import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser";
import { compile } from "../src/compiler";
import { spawnSync } from "bun";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const CLI = join(import.meta.dir, "../cli.ts");
const TMP = join(import.meta.dir, "../..//tmp");

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(["bun", CLI, ...args]);
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode ?? 1,
  };
}

// ── Parser unit tests ─────────────────────────────────────────────────────────

describe("parse() — slice 1", () => {
  test("parses single terminal phase", () => {
    const { ast, errors } = parse("phase(done)\n    .terminal()");
    expect(errors).toHaveLength(0);
    expect(ast).toBeDefined();
    expect(ast!.phases).toHaveLength(1);
    expect(ast!.phases[0].name).toBe("done");
    expect(ast!.phases[0].modifiers).toHaveLength(1);
    expect(ast!.phases[0].modifiers[0].kind).toBe("terminal");
  });

  test("phase name is captured correctly", () => {
    const { ast } = parse("phase(my_phase)\n    .terminal()");
    expect(ast!.phases[0].name).toBe("my_phase");
  });

  test("location of phase declaration is tracked", () => {
    const { ast } = parse("phase(done)\n    .terminal()");
    expect(ast!.phases[0].loc.line).toBe(1);
  });

  test("returns errors for invalid syntax — missing closing paren", () => {
    const { errors } = parse("phase(done\n    .terminal()");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/Expected/i);
    expect(errors[0].loc.line).toBeGreaterThan(0);
  });

  test("returns errors for unknown modifier", () => {
    const { errors } = parse("phase(done)\n    .unknown()");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("unknown");
  });

  test("returns errors for unknown top-level token", () => {
    const { errors } = parse("garbage");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("phase");
    expect(errors[0].loc.line).toBe(1);
  });

  test("error includes line number", () => {
    const { errors } = parse("\n\ngarbage");
    expect(errors[0].loc.line).toBe(3);
  });

  test("skips comments starting with #", () => {
    const { ast, errors } = parse("# this is a comment\nphase(done)\n    .terminal()");
    expect(errors).toHaveLength(0);
    expect(ast!.phases).toHaveLength(1);
  });

  test("skips comments starting with //", () => {
    const { ast, errors } = parse("// comment\nphase(done).terminal()");
    expect(errors).toHaveLength(0);
    expect(ast!.phases[0].name).toBe("done");
  });
});

// ── Compiler unit tests ───────────────────────────────────────────────────────

describe("compile() — slice 1", () => {
  test("compiles terminal phase to expected JSON shape", () => {
    const { ast } = parse("phase(done)\n    .terminal()");
    const output = compile(ast!);
    expect(output).toEqual({
      version: "3.1",
      phases: {
        done: { terminal: true },
      },
    });
  });

  test("version is exactly '3.1'", () => {
    const { ast } = parse("phase(done).terminal()");
    expect(compile(ast!).version).toBe("3.1");
  });

  test("phase with no modifiers compiles to empty object", () => {
    // Phase with no modifiers is valid parse but produces {} in phases map
    // (will have more modifiers in later slices)
    const { ast } = parse("phase(start)\nphase(done)\n    .terminal()");
    const out = compile(ast!);
    expect(out.phases["start"]).toEqual({});
    expect(out.phases["done"]).toEqual({ terminal: true });
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 1)", () => {
  const helloFile = "/tmp/pipelang-hello.pipeline";
  const brokenFile = "/tmp/pipelang-broken.pipeline";

  // Setup test fixtures
  writeFileSync(helloFile, "phase(done)\n    .terminal()\n");
  writeFileSync(brokenFile, "this is garbage input\n");

  test("compile hello.pipeline — exits 0", () => {
    const { exitCode } = runCLI(["compile", helloFile]);
    expect(exitCode).toBe(0);
  });

  test("compile hello.pipeline — outputs valid JSON", () => {
    const { stdout } = runCLI(["compile", helloFile]);
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({
      version: "3.1",
      phases: { done: { terminal: true } },
    });
  });

  test("compile --validate hello.pipeline — exits 0", () => {
    const { exitCode, stdout } = runCLI(["compile", "--validate", helloFile]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(""); // validate mode is silent on success
  });

  test("compile --validate broken.pipeline — exits 1", () => {
    const { exitCode } = runCLI(["compile", "--validate", brokenFile]);
    expect(exitCode).toBe(1);
  });

  test("compile broken.pipeline — error includes line number", () => {
    const { stderr } = runCLI(["compile", brokenFile]);
    expect(stderr).toMatch(/:\d+:/); // has line number
  });

  test("compile broken.pipeline — error message is readable", () => {
    const { stderr } = runCLI(["compile", brokenFile]);
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toContain("error:");
  });

  test("no args — exits 1 with usage", () => {
    const { exitCode, stderr } = runCLI([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("missing file — exits 1", () => {
    const { exitCode, stderr } = runCLI(["compile", "/tmp/nonexistent.pipeline"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("cannot read");
  });
});
