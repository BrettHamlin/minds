// Lexer for the pipelang DSL

export type TokenKind =
  | "IDENT"   // identifiers and keywords: phase, done, terminal, etc.
  | "STRING"  // quoted string literal: "..." (value excludes quotes)
  | "LPAREN"  // (
  | "RPAREN"  // )
  | "LBRACE"  // {
  | "RBRACE"  // }
  | "DOT"     // .
  | "COLON"   // :
  | "COMMA"   // ,
  | "AT"      // @
  | "NUMBER"  // integer: [0-9]+
  | "EQ"      // =
  | "EOF";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

export interface LexError {
  message: string;
  line: number;
  col: number;
}

export interface LexResult {
  tokens: Token[];
  errors: LexError[];
}

export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  const col = () => pos - lineStart + 1;

  while (pos < source.length) {
    const ch = source[pos];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r") {
      pos++;
      continue;
    }

    // Newline
    if (ch === "\n") {
      line++;
      lineStart = pos + 1;
      pos++;
      continue;
    }

    // Comments: # or // to end of line
    if (ch === "#" || (ch === "/" && source[pos + 1] === "/")) {
      while (pos < source.length && source[pos] !== "\n") pos++;
      continue;
    }

    // Single-character tokens
    if (ch === "(") {
      tokens.push({ kind: "LPAREN", value: "(", line, col: col() });
      pos++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "RPAREN", value: ")", line, col: col() });
      pos++;
      continue;
    }
    if (ch === ".") {
      tokens.push({ kind: "DOT", value: ".", line, col: col() });
      pos++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "COLON", value: ":", line, col: col() });
      pos++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "COMMA", value: ",", line, col: col() });
      pos++;
      continue;
    }
    if (ch === "{") {
      tokens.push({ kind: "LBRACE", value: "{", line, col: col() });
      pos++;
      continue;
    }
    if (ch === "}") {
      tokens.push({ kind: "RBRACE", value: "}", line, col: col() });
      pos++;
      continue;
    }
    if (ch === "@") {
      tokens.push({ kind: "AT", value: "@", line, col: col() });
      pos++;
      continue;
    }
    if (ch === "=") {
      tokens.push({ kind: "EQ", value: "=", line, col: col() });
      pos++;
      continue;
    }

    // String literals: "..." with \" escape support
    if (ch === '"') {
      const startCol = col();
      pos++; // skip opening quote
      let str = "";
      while (pos < source.length && source[pos] !== '"') {
        if (source[pos] === "\n") {
          errors.push({ message: "Unterminated string literal", line, col: startCol });
          break;
        }
        if (source[pos] === "\\") {
          const next = source[pos + 1];
          if (next === '"') { str += '"'; pos += 2; }
          else if (next === "n") { str += "\n"; pos += 2; }
          else if (next === "t") { str += "\t"; pos += 2; }
          else if (next === "\\") { str += "\\"; pos += 2; }
          else { str += source[pos++]; } // unknown escape — keep backslash
        } else {
          str += source[pos++];
        }
      }
      if (pos < source.length && source[pos] === '"') {
        pos++; // skip closing quote
        tokens.push({ kind: "STRING", value: str, line, col: startCol });
      } else if (!errors.some((e) => e.line === line && e.col === startCol)) {
        errors.push({ message: "Unterminated string literal", line, col: startCol });
      }
      continue;
    }

    // Integer literals: [0-9]+
    if (/[0-9]/.test(ch)) {
      const start = pos;
      const startCol = col();
      while (pos < source.length && /[0-9]/.test(source[pos])) pos++;
      tokens.push({ kind: "NUMBER", value: source.slice(start, pos), line, col: startCol });
      continue;
    }

    // Identifiers: [a-zA-Z_][a-zA-Z0-9_]*
    if (/[a-zA-Z_]/.test(ch)) {
      const start = pos;
      const startCol = col();
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) pos++;
      tokens.push({
        kind: "IDENT",
        value: source.slice(start, pos),
        line,
        col: startCol,
      });
      continue;
    }

    // Unknown character
    errors.push({
      message: `Unexpected character '${ch}'`,
      line,
      col: col(),
    });
    pos++;
  }

  tokens.push({ kind: "EOF", value: "", line, col: col() });
  return { tokens, errors };
}
