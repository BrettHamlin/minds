/**
 * Pipelang Mind — DSL lexer, parser, compiler, validator, and LSP.
 *
 * Owns the .pipeline DSL: compile, validate, diff, and language-server protocol.
 * Cross-Mind type imports from Pipeline Core are runtime-only (Rule 1).
 *
 * Leaf Mind: no children, no discoverChildren().
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const req = workUnit.request.toLowerCase().trim();
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  // "compile pipeline source" — compiles .pipeline source to JSON
  if (req.startsWith("compile pipeline source")) {
    const { compile } = await import("./src/compiler.js");
    const { parse } = await import("./src/parser.js");
    const source = ctx.source as string | undefined;
    if (!source) {
      return { status: "handled", error: "Missing context.source" };
    }
    const ast = parse(source);
    const compiled = compile(ast);
    return { status: "handled", result: { compiled } };
  }

  // "validate pipeline" — validates a pipeline config object
  if (req.startsWith("validate pipeline")) {
    const { validate } = await import("./src/validator.js");
    const pipeline = ctx.pipeline;
    if (!pipeline) {
      return { status: "handled", error: "Missing context.pipeline" };
    }
    const errors = validate(pipeline as Parameters<typeof validate>[0]);
    return { status: "handled", result: { valid: errors.length === 0, errors } };
  }

  // "diff pipelines" — diffs two pipeline versions
  if (req.startsWith("diff pipelines")) {
    const { parse } = await import("./src/parser.js");
    const { compile } = await import("./src/compiler.js");
    const { source: sourceA, sourceB } = ctx as { source: string; sourceB: string };
    if (!sourceA || !sourceB) {
      return { status: "handled", error: "Missing context.source and context.sourceB" };
    }
    const compiledA = compile(parse(sourceA));
    const compiledB = compile(parse(sourceB));
    const diff = JSON.stringify(compiledA) === JSON.stringify(compiledB)
      ? { identical: true, changes: [] }
      : { identical: false, a: compiledA, b: compiledB };
    return { status: "handled", result: { diff } };
  }

  return { status: "escalate" };
}

export default createMind({
  name: "pipelang",
  domain: "Pipeline DSL: lexer, parser, compiler, validator, and LSP for .pipeline files.",
  keywords: ["pipelang", "pipeline", "dsl", "compile", "validate", "diff", "lsp", "language", "syntax"],
  owns_files: ["minds/pipelang/"],
  capabilities: [
    "compile pipeline source to JSON",
    "validate pipeline config",
    "diff two pipeline versions",
  ],
  handle,
});
