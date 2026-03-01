// Convert ParseError / CompileError to LSP Diagnostics
// "11 editor validations" — all come from parser.ts + validator.ts

import { parse } from "../parser";
import { validate } from "../validator";
import type { ParseError, CompileError } from "../types";
import { DiagnosticSeverity } from "./protocol";
import type { Diagnostic } from "./protocol";

const SOURCE = "pipelang";

/** Parse + validate a document and return LSP Diagnostic[] */
export function getDiagnostics(text: string): Diagnostic[] {
  const { errors: parseErrors, ast } = parse(text);

  const diagnostics: Diagnostic[] = parseErrors.map((e) => parseErrorToDiagnostic(e));

  if (ast) {
    const compileErrors = validate(ast);
    for (const e of compileErrors) {
      diagnostics.push(compileErrorToDiagnostic(e));
    }
  }

  return diagnostics;
}

function parseErrorToDiagnostic(e: ParseError): Diagnostic {
  const line = e.loc.line - 1;
  const col = e.loc.col - 1;
  return {
    range: {
      start: { line, character: col },
      end: { line, character: col },
    },
    severity: DiagnosticSeverity.Error,
    message: e.message,
    source: SOURCE,
  };
}

function compileErrorToDiagnostic(e: CompileError): Diagnostic {
  const line = e.loc.line - 1;
  const col = e.loc.col - 1;
  return {
    range: {
      start: { line, character: col },
      end: { line, character: col },
    },
    severity: e.severity === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    message: e.message,
    source: SOURCE,
  };
}
