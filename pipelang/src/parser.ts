// Recursive descent parser for the pipelang DSL
//
// Modifier parsing is split into:
//   phase-modifiers.ts — .terminal(), .command(), .signals(), .on(), etc.
//   gate-modifiers.ts  — gate(name) .prompt() .skipTo() .on()

import { tokenize } from "./lexer";
import { createParserContext } from "./parser-context";
import { parsePhaseModifier } from "./phase-modifiers";
import { parseGateDecl } from "./gate-modifiers";
import type {
  ParseResult,
  PhaseDecl,
  Modifier,
  ParseError,
} from "./types";

const VALID_MODEL_NAMES = new Set(["haiku", "sonnet", "opus"]);

export function parse(source: string): ParseResult {
  const { tokens, errors: lexErrors } = tokenize(source);
  const parseErrors: ParseError[] = [
    ...lexErrors.map((e) => ({ message: e.message, loc: { line: e.line, col: e.col } })),
  ];
  const ctx = createParserContext(tokens, parseErrors);

  // --- Grammar rules ---

  function parsePhaseDecl(): PhaseDecl | null {
    const kw = ctx.advance(); // consume 'phase'
    const loc = { line: kw.line, col: kw.col };

    if (!ctx.expect("LPAREN")) return null;

    const nameTok = ctx.peek();
    if (nameTok.kind !== "IDENT") {
      ctx.addError(
        `Expected phase name identifier but found '${nameTok.value || nameTok.kind}'`,
        { line: nameTok.line, col: nameTok.col }
      );
      return null;
    }
    ctx.advance(); // consume name

    if (!ctx.expect("RPAREN")) return null;

    const modifiers: Modifier[] = [];

    // Parse modifier chain: .modifier(args)
    while (ctx.check("DOT")) {
      const mod = parsePhaseModifier(ctx);
      if (mod) modifiers.push(mod);
      else break;
    }

    return { name: nameTok.value, loc, nameLoc: { line: nameTok.line, col: nameTok.col }, modifiers };
  }

  // --- Top-level program ---

  const phases: PhaseDecl[] = [];
  const gates: import("./types").GateDecl[] = [];
  let defaultModel: string | undefined;

  while (!ctx.check("EOF")) {
    const tok = ctx.peek();

    // @defaultModel(name) — file-level directive
    if (tok.kind === "AT") {
      ctx.advance(); // consume '@'
      const dirTok = ctx.peek();
      if (dirTok.kind !== "IDENT" || dirTok.value !== "defaultModel") {
        ctx.addError(
          `Expected 'defaultModel' after '@' but found '${dirTok.value || dirTok.kind}'`,
          { line: dirTok.line, col: dirTok.col }
        );
        while (!ctx.check("EOF") && ctx.peek().kind !== "IDENT") ctx.advance();
        continue;
      }
      ctx.advance(); // consume 'defaultModel'
      if (!ctx.expect("LPAREN")) continue;
      const modelTok = ctx.peek();
      if (modelTok.kind !== "IDENT" || !VALID_MODEL_NAMES.has(modelTok.value)) {
        ctx.addError(
          `'@defaultModel()' requires a valid model name: haiku, sonnet, or opus`,
          { line: modelTok.line, col: modelTok.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        continue;
      }
      ctx.advance(); // consume model name
      if (!ctx.expect("RPAREN")) continue;
      defaultModel = modelTok.value;
      continue;
    }

    if (tok.kind === "IDENT" && tok.value === "phase") {
      const decl = parsePhaseDecl();
      if (decl) phases.push(decl);
    } else if (tok.kind === "IDENT" && tok.value === "gate") {
      const decl = parseGateDecl(ctx);
      if (decl) gates.push(decl);
    } else {
      ctx.addError(
        `Unexpected token '${tok.value}' — expected 'phase' or 'gate' declaration`,
        { line: tok.line, col: tok.col }
      );
      ctx.advance(); // skip to recover
    }
  }

  if (parseErrors.length > 0) {
    return { errors: parseErrors };
  }

  return {
    ast: { phases, gates, ...(defaultModel !== undefined ? { defaultModel } : {}) },
    errors: [],
  };
}
