// Shared parser context — token stream + error accumulator
// Used by parser.ts, phase-modifiers.ts, and gate-modifiers.ts

import type { Token } from "./lexer";
import type { SourceLocation, ParseError } from "./types";

export interface ParserContext {
  peek(): Token;
  advance(): Token;
  check(kind: Token["kind"], value?: string): boolean;
  expect(kind: Token["kind"], value?: string): Token | null;
  addError(message: string, loc: SourceLocation): void;
}

export function createParserContext(tokens: Token[], errors: ParseError[]): ParserContext {
  let pos = 0;

  function peek(): Token {
    return tokens[pos];
  }

  function advance(): Token {
    const tok = tokens[pos];
    if (tok.kind !== "EOF") pos++;
    return tok;
  }

  function check(kind: Token["kind"], value?: string): boolean {
    const tok = peek();
    if (tok.kind !== kind) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }

  function expect(kind: Token["kind"], value?: string): Token | null {
    if (!check(kind, value)) {
      const tok = peek();
      const expected = value ? `'${value}'` : kind;
      errors.push({
        message: `Expected ${expected} but found '${tok.value || tok.kind}'`,
        loc: { line: tok.line, col: tok.col },
      });
      return null;
    }
    return advance();
  }

  function addError(message: string, loc: SourceLocation): void {
    errors.push({ message, loc });
  }

  return { peek, advance, check, expect, addError };
}
