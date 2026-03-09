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
  CodeReviewDirective,
  MetricsDirective,
  InteractiveDirective,
} from "./types";
import { VALID_MODEL_NAMES } from "./types";

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
  let codeReview: CodeReviewDirective | undefined;
  let metrics: MetricsDirective | undefined;
  let interactive: InteractiveDirective | undefined;

  while (!ctx.check("EOF")) {
    const tok = ctx.peek();

    // File-level directives: @defaultModel, @codeReview
    if (tok.kind === "AT") {
      ctx.advance(); // consume '@'
      const dirTok = ctx.peek();
      if (dirTok.kind !== "IDENT") {
        ctx.addError(
          `Expected directive name after '@' but found '${dirTok.value || dirTok.kind}'`,
          { line: dirTok.line, col: dirTok.col }
        );
        while (!ctx.check("EOF") && ctx.peek().kind !== "IDENT") ctx.advance();
        continue;
      }

      if (dirTok.value === "defaultModel") {
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

      if (dirTok.value === "codeReview") {
        ctx.advance(); // consume 'codeReview'
        if (!ctx.expect("LPAREN")) continue;

        let enabled = true;
        let crModel: string | undefined;
        let crFile: string | undefined;
        let crMaxAttempts: number | undefined;

        if (ctx.check("RPAREN")) {
          // @codeReview() — all defaults
          ctx.advance();
        } else {
          const firstTok = ctx.peek();
          if (firstTok.kind === "IDENT" && firstTok.value === "off") {
            // @codeReview(off)
            ctx.advance();
            if (!ctx.expect("RPAREN")) continue;
            enabled = false;
          } else {
            // Comma-separated keyword params: model:, .file(), maxAttempts:
            let first = true;
            while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
              if (!first) {
                if (!ctx.check("COMMA")) {
                  ctx.addError(`Expected ',' or ')' in @codeReview()`, { line: ctx.peek().line, col: ctx.peek().col });
                  break;
                }
                ctx.advance(); // consume ','
                if (ctx.check("RPAREN")) break; // trailing comma
              }
              first = false;

              const pt = ctx.peek();
              if (pt.kind === "DOT") {
                // .file("path")
                ctx.advance(); // consume '.'
                const ftok = ctx.peek();
                if (ftok.kind !== "IDENT" || ftok.value !== "file") {
                  ctx.addError(`Expected '.file("path")' in @codeReview() but found '.${ftok.value || ftok.kind}'`, { line: ftok.line, col: ftok.col });
                  while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
                  break;
                }
                ctx.advance(); // consume "file"
                if (!ctx.expect("LPAREN")) { while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance(); break; }
                const strTok = ctx.peek();
                if (strTok.kind !== "STRING") {
                  ctx.addError(`'.file()' requires a string path in @codeReview()`, { line: strTok.line, col: strTok.col });
                  while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
                  break;
                }
                crFile = strTok.value;
                ctx.advance();
                if (!ctx.expect("RPAREN")) { while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance(); break; } // inner ) of .file()
              } else if (pt.kind === "IDENT" && pt.value === "model") {
                ctx.advance(); // consume "model"
                if (!ctx.expect("COLON")) { while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance(); continue; }
                const modelTok = ctx.peek();
                if (modelTok.kind !== "IDENT" || !VALID_MODEL_NAMES.has(modelTok.value)) {
                  ctx.addError(`'model:' in @codeReview() requires a valid model name: haiku, sonnet, or opus`, { line: modelTok.line, col: modelTok.col });
                  while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
                } else {
                  crModel = modelTok.value;
                  ctx.advance();
                }
              } else if (pt.kind === "IDENT" && pt.value === "maxAttempts") {
                ctx.advance(); // consume "maxAttempts"
                if (!ctx.expect("COLON")) { while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance(); continue; }
                const numTok = ctx.peek();
                if (numTok.kind !== "NUMBER") {
                  ctx.addError(`'maxAttempts:' in @codeReview() requires a positive integer`, { line: numTok.line, col: numTok.col });
                  while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
                } else {
                  crMaxAttempts = parseInt(numTok.value, 10);
                  ctx.advance();
                }
              } else {
                ctx.addError(`Unknown parameter '${pt.value || pt.kind}' in @codeReview(). Valid: off, model:, .file(), maxAttempts:`, { line: pt.line, col: pt.col });
                while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
              }
            }
            if (!ctx.expect("RPAREN")) continue;
          }
        }

        codeReview = {
          enabled,
          ...(crModel !== undefined ? { model: crModel } : {}),
          ...(crFile !== undefined ? { file: crFile } : {}),
          ...(crMaxAttempts !== undefined ? { maxAttempts: crMaxAttempts } : {}),
        };
        continue;
      }

      if (dirTok.value === "metrics") {
        ctx.advance(); // consume 'metrics'
        if (!ctx.expect("LPAREN")) continue;

        let enabled = true;

        if (ctx.check("RPAREN")) {
          // @metrics() — enabled (default)
          ctx.advance();
        } else {
          const firstTok = ctx.peek();
          if (firstTok.kind === "IDENT" && (firstTok.value === "off" || firstTok.value === "false")) {
            // @metrics(off) or @metrics(false)
            ctx.advance();
            if (!ctx.expect("RPAREN")) continue;
            enabled = false;
          } else {
            ctx.addError(
              `Unknown parameter '${firstTok.value || firstTok.kind}' in @metrics(). Valid: off, false`,
              { line: firstTok.line, col: firstTok.col }
            );
            while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
            if (ctx.check("RPAREN")) ctx.advance();
          }
        }

        metrics = { enabled };
        continue;
      }

      if (dirTok.value === "interactive") {
        ctx.advance(); // consume 'interactive'
        if (!ctx.expect("LPAREN")) continue;

        let enabled = true;

        if (ctx.check("RPAREN")) {
          // @interactive() — enabled (default)
          ctx.advance();
        } else {
          const firstTok = ctx.peek();
          if (firstTok.kind === "IDENT" && firstTok.value === "off") {
            // @interactive(off)
            ctx.advance();
            if (!ctx.expect("RPAREN")) continue;
            enabled = false;
          } else if (firstTok.kind === "IDENT" && firstTok.value === "on") {
            // @interactive(on) — explicit enabled
            ctx.advance();
            if (!ctx.expect("RPAREN")) continue;
            enabled = true;
          } else {
            ctx.addError(
              `Unknown parameter '${firstTok.value || firstTok.kind}' in @interactive(). Valid: on, off`,
              { line: firstTok.line, col: firstTok.col }
            );
            while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
            if (ctx.check("RPAREN")) ctx.advance();
          }
        }

        interactive = { enabled };
        continue;
      }

      // Unknown directive
      ctx.addError(
        `Unknown directive '@${dirTok.value}'. Valid directives: @defaultModel, @codeReview, @metrics, @interactive`,
        { line: dirTok.line, col: dirTok.col }
      );
      while (!ctx.check("EOF") && ctx.peek().kind !== "IDENT") ctx.advance();
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
    ast: {
      phases,
      gates,
      ...(defaultModel !== undefined ? { defaultModel } : {}),
      ...(codeReview !== undefined ? { codeReview } : {}),
      ...(metrics !== undefined ? { metrics } : {}),
      ...(interactive !== undefined ? { interactive } : {}),
    },
    errors: [],
  };
}
