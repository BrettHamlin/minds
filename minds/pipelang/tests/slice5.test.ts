// BRE-305: Slice 6 — Goal gates and orchestrator context
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

const FULL_EXAMPLE = `
phase(implement)
    .command("/collab.implement")
    .goalGate(.always)
    .orchestratorContext(.file(".collab/config/context/implement.md"))
    .signals(IMPLEMENT_COMPLETE)
    .on(IMPLEMENT_COMPLETE, to: blindqa)

phase(blindqa)
    .terminal()
`.trim();

// ── Parser unit tests ─────────────────────────────────────────────────────────

describe("parse() — slice 5: .goalGate() and .orchestratorContext()", () => {
  test("parses .goalGate(.always)", () => {
    const { ast, errors } = parse(`phase(p)\n    .goalGate(.always)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("goalGate");
    if (mod.kind === "goalGate") expect(mod.value).toBe("always");
  });

  test("parses .goalGate(.ifTriggered)", () => {
    const { ast, errors } = parse(`phase(p)\n    .goalGate(.ifTriggered)\n    .terminal()`);
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("goalGate");
    if (mod.kind === "goalGate") expect(mod.value).toBe("ifTriggered");
  });

  test("invalid goal gate value produces parse error", () => {
    const { errors } = parse(`phase(p)\n    .goalGate(.sometimes)\n    .terminal()`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain(".sometimes");
    expect(errors[0].message).toContain(".always");
    expect(errors[0].message).toContain(".ifTriggered");
  });

  test("parses .orchestratorContext(.file(path))", () => {
    const { ast, errors } = parse(
      `phase(p)\n    .orchestratorContext(.file(".collab/ctx.md"))\n    .terminal()`
    );
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("orchestratorContext");
    if (mod.kind === "orchestratorContext") {
      expect(mod.source.kind).toBe("file");
      if (mod.source.kind === "file") expect(mod.source.path).toBe(".collab/ctx.md");
    }
  });

  test("parses .orchestratorContext(.inline(text))", () => {
    const { ast, errors } = parse(
      `phase(p)\n    .orchestratorContext(.inline("some context text"))\n    .terminal()`
    );
    expect(errors).toHaveLength(0);
    const mod = ast!.phases[0].modifiers[0];
    expect(mod.kind).toBe("orchestratorContext");
    if (mod.kind === "orchestratorContext") {
      expect(mod.source.kind).toBe("inline");
      if (mod.source.kind === "inline") expect(mod.source.text).toBe("some context text");
    }
  });

  test("invalid source form in .orchestratorContext() produces error", () => {
    const { errors } = parse(
      `phase(p)\n    .orchestratorContext(.remote("url"))\n    .terminal()`
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain(".remote");
  });

  test("full example parses without errors", () => {
    const { ast, errors } = parse(FULL_EXAMPLE);
    expect(errors).toHaveLength(0);
    expect(ast!.phases).toHaveLength(2);
  });
});

// ── Compiler unit tests ───────────────────────────────────────────────────────

describe("compile() — slice 5: goal_gate and orchestrator_context", () => {
  test("goalGate(.always) compiles to goal_gate: 'always'", () => {
    const { ast } = parse(`phase(p)\n    .goalGate(.always)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].goal_gate).toBe("always");
  });

  test("goalGate(.ifTriggered) compiles to goal_gate: 'if_triggered'", () => {
    const { ast } = parse(`phase(p)\n    .goalGate(.ifTriggered)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].goal_gate).toBe("if_triggered");
  });

  test("orchestratorContext(.file()) compiles to string path", () => {
    const { ast } = parse(
      `phase(p)\n    .orchestratorContext(.file(".collab/config/ctx.md"))\n    .terminal()`
    );
    const out = compile(ast!);
    expect(out.phases["p"].orchestrator_context).toBe(".collab/config/ctx.md");
  });

  test("orchestratorContext(.inline()) compiles to { inline: text }", () => {
    const { ast } = parse(
      `phase(p)\n    .orchestratorContext(.inline("my inline context"))\n    .terminal()`
    );
    const out = compile(ast!);
    expect(out.phases["p"].orchestrator_context).toEqual({ inline: "my inline context" });
  });

  test("phase without goalGate has no goal_gate key", () => {
    const { ast } = parse(`phase(p)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].goal_gate).toBeUndefined();
  });

  test("phase without orchestratorContext has no orchestrator_context key", () => {
    const { ast } = parse(`phase(p)\n    .terminal()`);
    const out = compile(ast!);
    expect(out.phases["p"].orchestrator_context).toBeUndefined();
  });

  test("full example compiles to expected JSON", () => {
    const { ast } = parse(FULL_EXAMPLE);
    const out = compile(ast!);
    expect(out).toEqual({
      version: "3.1",
      phases: {
        implement: {
          command: "/collab.implement",
          goal_gate: "always",
          orchestrator_context: ".collab/config/context/implement.md",
          signals: ["IMPLEMENT_COMPLETE"],
          transitions: { IMPLEMENT_COMPLETE: { to: "blindqa" } },
        },
        blindqa: { terminal: true },
      },
    });
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("pipelang compile — CLI (slice 5)", () => {
  const fullFile = "/tmp/pipelang-slice5-full.pipeline";
  const badGateFile = "/tmp/pipelang-slice5-bad-gate.pipeline";

  writeFileSync(fullFile, FULL_EXAMPLE);
  writeFileSync(
    badGateFile,
    `phase(p)\n    .goalGate(.sometimes)\n    .terminal()`
  );

  test("valid file with goalGate and orchestratorContext exits 0", () => {
    expect(runCLI(["compile", fullFile]).exitCode).toBe(0);
  });

  test("valid file produces goal_gate and orchestrator_context in output", () => {
    const { stdout } = runCLI(["compile", fullFile]);
    const out = JSON.parse(stdout);
    expect(out.phases.implement.goal_gate).toBe("always");
    expect(out.phases.implement.orchestrator_context).toBe(".collab/config/context/implement.md");
  });

  test("invalid goalGate value exits 1 with readable error", () => {
    const { exitCode, stderr } = runCLI(["compile", badGateFile]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(".sometimes");
  });
});
