// Go-to-definition handler
// Given a cursor position, finds what name is under the cursor and returns
// the declaration location.

import { parse } from "../parser";
import { buildSymbolTable, findDeclaration, locToRange } from "./symbols";
import type { Position, Location } from "./protocol";

/** Extract the identifier word at a given 0-indexed position in the document text */
export function wordAtPosition(text: string, pos: Position): string | null {
  const lines = text.split("\n");
  const line = lines[pos.line];
  if (!line) return null;

  const ch = pos.character;

  // Only return a word if the cursor is ON an identifier character
  if (ch >= line.length || !/[a-zA-Z0-9_]/.test(line[ch])) return null;

  // Find word boundaries — identifiers are [a-zA-Z_][a-zA-Z0-9_]*
  let start = ch;
  let end = ch;

  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) end++;

  const word = line.slice(start, end);
  return word.length > 0 ? word : null;
}

/**
 * Handle textDocument/definition.
 * Returns the declaration Location or null if not found.
 */
export function getDefinition(
  text: string,
  documentUri: string,
  pos: Position
): Location | null {
  const word = wordAtPosition(text, pos);
  if (!word) return null;

  const { ast } = parse(text);
  if (!ast) return null;

  const table = buildSymbolTable(ast);

  // Try to find as phase first, then gate
  const decl =
    findDeclaration(table, word, "phase") ??
    findDeclaration(table, word, "gate");

  if (!decl) return null;

  return {
    uri: documentUri,
    range: locToRange(decl.nameLoc, word.length),
  };
}
