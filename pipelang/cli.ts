#!/usr/bin/env bun
// pipelang CLI — compiles and runs .pipeline files
//
// Usage:
//   pipelang compile <file.pipeline>           — compile and print JSON
//   pipelang compile --validate <file.pipeline> — validate only, exit 0/1
//   pipelang run <file.pipeline>               — compile and run via tmux agents
//   pipelang run --compiled <file.json>        — run a pre-compiled pipeline JSON

import { readFileSync } from "fs";
import { parse } from "./src/parser";
import { compile } from "./src/compiler";
import { validate } from "./src/validator";
import type { ParseError, CompileError, PipelineAST } from "./src/types";
import type { CompiledPipeline } from "./src/compiler";

function formatErrors(errors: Array<ParseError | CompileError>, file: string): string {
  return errors
    .map((e) => {
      const sev = "severity" in e && e.severity === "warning" ? "warning" : "error";
      return `${file}:${e.loc.line}:${e.loc.col}: ${sev}: ${e.message}`;
    })
    .join("\n");
}

function printUsage(): void {
  process.stderr.write(
    "Usage:\n" +
      "  pipelang compile [--validate] <file.pipeline>\n" +
      "  pipelang run [--compiled] <file.pipeline|file.json>\n"
  );
}

/**
 * Parse, validate, and compile a .pipeline source string.
 * Returns the compiled pipeline + warnings, or prints errors and exits.
 */
function compileSource(
  source: string,
  file: string
): { pipeline: CompiledPipeline; ast: PipelineAST; warnings: CompileError[] } {
  const { ast, errors } = parse(source);

  if (errors.length > 0) {
    process.stderr.write(formatErrors(errors, file) + "\n");
    process.exit(1);
  }

  if (!ast) {
    process.stderr.write(`pipelang: internal error — no AST produced\n`);
    process.exit(1);
  }

  const validationErrors = validate(ast);
  const warnings = validationErrors.filter((e) => e.severity === "warning");
  const fatal = validationErrors.filter((e) => e.severity !== "warning");
  if (warnings.length > 0) {
    process.stderr.write(formatErrors(warnings, file) + "\n");
  }
  if (fatal.length > 0) {
    process.stderr.write(formatErrors(fatal, file) + "\n");
    process.exit(1);
  }

  return { pipeline: compile(ast), ast, warnings };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  // ── compile ────────────────────────────────────────────────────────────────

  if (command === "compile") {
    const compileArgs = args.slice(1);
    const validateOnly = compileArgs.includes("--validate");
    const files = compileArgs.filter((a) => !a.startsWith("--"));

    if (files.length !== 1) {
      process.stderr.write("Usage: pipelang compile [--validate] <file.pipeline>\n");
      process.exit(1);
    }

    const file = files[0];
    let source: string;

    try {
      source = readFileSync(file, "utf-8");
    } catch {
      process.stderr.write(`pipelang: cannot read '${file}': file not found\n`);
      process.exit(1);
    }

    if (validateOnly) {
      // Still need to parse + validate, but don't compile
      compileSource(source, file);
      process.exit(0);
    }

    const { pipeline } = compileSource(source, file);
    process.stdout.write(JSON.stringify(pipeline, null, 2) + "\n");
    return;
  }

  // ── run ────────────────────────────────────────────────────────────────────

  if (command === "run") {
    const { runPipeline } = await import("./src/runner");

    const runArgs = args.slice(1);
    const compiledMode = runArgs.includes("--compiled");
    const files = runArgs.filter((a) => !a.startsWith("--"));

    if (files.length !== 1) {
      process.stderr.write("Usage: pipelang run [--compiled] <file.pipeline|file.json>\n");
      process.exit(1);
    }

    const file = files[0];
    let raw: string;

    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      process.stderr.write(`pipelang: cannot read '${file}': file not found\n`);
      process.exit(1);
    }

    let pipeline: CompiledPipeline;

    if (compiledMode || file.endsWith(".json")) {
      try {
        pipeline = JSON.parse(raw);
      } catch {
        process.stderr.write(`pipelang: invalid JSON in '${file}'\n`);
        process.exit(1);
      }
    } else {
      ({ pipeline } = compileSource(raw, file));
    }

    const result = await runPipeline(pipeline);

    if (!result.success) {
      process.stderr.write(`pipelang: run failed: ${result.error}\n`);
      process.exit(1);
    }

    const phasePath = result.phases.map((p) => `${p.phase}(${p.signal})`).join(" → ");
    process.stdout.write(`Pipeline complete: ${phasePath} → done\n`);
    return;
  }

  // ── unknown command ────────────────────────────────────────────────────────

  printUsage();
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`pipelang: fatal error: ${err.message}\n`);
  process.exit(1);
});
