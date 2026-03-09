/**
 * tests/e2e/helpers.ts
 *
 * Shared helpers for E2E tests. Compiles collab.pipeline once per call
 * and returns the result. Test files call this at module top level so
 * compilation happens once per test file (module cache handles the rest).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "../../minds/pipelang/src/parser";
import { compile } from "../../minds/pipelang/src/compiler";
import type { CompiledPipeline } from "../../minds/pipeline_core/types";

const PIPELINE_FILE = join(import.meta.dir, "../../minds/pipelang/collab.pipeline");

/**
 * Parse and compile collab.pipeline, throwing on any parse error.
 * Returns the typed CompiledPipeline ready for use in tests.
 */
export function compileCollab(): CompiledPipeline {
  const source = readFileSync(PIPELINE_FILE, "utf-8");
  const { ast, errors } = parse(source);

  if (errors.length > 0 || !ast) {
    throw new Error(
      `collab.pipeline failed to parse: ${errors.map((e) => e.message).join(", ")}`
    );
  }

  return compile(ast) as CompiledPipeline;
}
