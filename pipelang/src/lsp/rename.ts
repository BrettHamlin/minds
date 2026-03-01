// Rename refactoring handler
// Finds all occurrences of a phase or gate name and returns a WorkspaceEdit
// that replaces all of them with the new name.

import { parse } from "../parser";
import { buildSymbolTable, findAllLocations, findDeclaration } from "./symbols";
import { locToRange } from "./symbols";
import type { SymbolKind } from "./symbols";
import { wordAtPosition } from "./definition";
import type { Position, WorkspaceEdit, TextEdit } from "./protocol";

/**
 * Determine whether the word under the cursor is a renameable symbol.
 * Returns the word and kind, or null.
 */
export function prepareRename(
  text: string,
  pos: Position
): { word: string; kind: SymbolKind } | null {
  const word = wordAtPosition(text, pos);
  if (!word) return null;

  const { ast } = parse(text);
  if (!ast) return null;

  const table = buildSymbolTable(ast);

  if (findDeclaration(table, word, "phase")) return { word, kind: "phase" };
  if (findDeclaration(table, word, "gate")) return { word, kind: "gate" };

  return null;
}

/**
 * Handle textDocument/rename.
 * Returns a WorkspaceEdit replacing all occurrences of the symbol under the
 * cursor with `newName`.
 */
export function getRename(
  text: string,
  documentUri: string,
  pos: Position,
  newName: string
): WorkspaceEdit | null {
  const info = prepareRename(text, pos);
  if (!info) return null;

  const { ast } = parse(text);
  if (!ast) return null;

  const table = buildSymbolTable(ast);
  const locs = findAllLocations(table, info.word, info.kind);

  const edits: TextEdit[] = locs.map((loc) => ({
    range: locToRange(loc, info.word.length),
    newText: newName,
  }));

  if (edits.length === 0) return null;

  return { changes: { [documentUri]: edits } };
}
