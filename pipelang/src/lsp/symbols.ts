// Symbol table builder — walks the AST to collect declaration + reference locations
// Used by go-to-definition and rename refactoring

import type { PipelineAST, SourceLocation } from "../types";
import type { Range } from "./protocol";

export type SymbolKind = "phase" | "gate" | "signal";

export interface SymbolDeclaration {
  name: string;
  kind: SymbolKind;
  /** Location of the name token in the declaration (e.g. inside phase(NAME)) */
  nameLoc: SourceLocation;
}

export interface SymbolReference {
  name: string;
  kind: SymbolKind;
  /** Location of the reference (e.g. inside .on(SIG, to: NAME)) */
  loc: SourceLocation;
}

export interface SymbolTable {
  declarations: SymbolDeclaration[];
  references: SymbolReference[];
}

/** Convert a 1-indexed SourceLocation to a 0-indexed LSP Range (single token) */
export function locToRange(loc: SourceLocation, nameLength: number): Range {
  const line = loc.line - 1;
  const col = loc.col - 1;
  return {
    start: { line, character: col },
    end: { line, character: col + nameLength },
  };
}

/** Build a SymbolTable from a parsed AST */
export function buildSymbolTable(ast: PipelineAST): SymbolTable {
  const declarations: SymbolDeclaration[] = [];
  const references: SymbolReference[] = [];

  // Phase declarations and their modifier references
  for (const phase of ast.phases) {
    declarations.push({
      name: phase.name,
      kind: "phase",
      nameLoc: phase.nameLoc,
    });

    for (const mod of phase.modifiers) {
      if (mod.kind === "signals") {
        // Signal declarations (declared by the phase)
        for (let i = 0; i < mod.signals.length; i++) {
          declarations.push({
            name: mod.signals[i],
            kind: "signal",
            // Signals modifier doesn't store per-token locations; we skip those
            // (signal go-to-def would need lexer-level location tracking per signal token)
            nameLoc: mod.loc,
          });
        }
      } else if (mod.kind === "on") {
        // Signal reference
        references.push({ name: mod.signal, kind: "signal", loc: mod.signalLoc });
        // Phase/gate target reference
        if (mod.target.kind === "to") {
          references.push({ name: mod.target.phase, kind: "phase", loc: mod.target.phaseLoc });
        } else {
          references.push({ name: mod.target.gate, kind: "gate", loc: mod.target.gateLoc });
        }
      } else if (mod.kind === "conditionalOn") {
        // Signal reference
        references.push({ name: mod.signal, kind: "signal", loc: mod.signalLoc });
        // Branch targets
        for (const branch of mod.branches) {
          if (branch.target.kind === "to") {
            references.push({ name: branch.target.phase, kind: "phase", loc: branch.target.phaseLoc });
          } else {
            references.push({ name: branch.target.gate, kind: "gate", loc: branch.target.gateLoc });
          }
        }
      }
    }
  }

  // Gate declarations and their modifier references
  for (const gate of ast.gates) {
    declarations.push({
      name: gate.name,
      kind: "gate",
      nameLoc: gate.nameLoc,
    });

    for (const mod of gate.modifiers) {
      if (mod.kind === "skipTo") {
        references.push({ name: mod.phase, kind: "phase", loc: mod.phaseLoc });
      } else if (mod.kind === "on") {
        // Signal reference
        references.push({ name: mod.signal, kind: "signal", loc: mod.signalLoc });
        // Phase target reference (optional — missing when onExhaust handles routing)
        if (mod.target) {
          references.push({ name: mod.target.phase, kind: "phase", loc: mod.target.phaseLoc });
        }
      }
    }
  }

  return { declarations, references };
}

/** Find the declaration of a name (phase/gate) in the symbol table */
export function findDeclaration(
  table: SymbolTable,
  name: string,
  kind?: SymbolKind
): SymbolDeclaration | undefined {
  return table.declarations.find(
    (d) => d.name === name && (kind === undefined || d.kind === kind)
  );
}

/** Find all locations (declaration + references) for a name */
export function findAllLocations(
  table: SymbolTable,
  name: string,
  kind: SymbolKind
): SourceLocation[] {
  const locs: SourceLocation[] = [];

  // Declaration location
  const decl = table.declarations.find((d) => d.name === name && d.kind === kind);
  if (decl) locs.push(decl.nameLoc);

  // Reference locations
  for (const ref of table.references) {
    if (ref.name === name && ref.kind === kind) {
      locs.push(ref.loc);
    }
  }

  return locs;
}
