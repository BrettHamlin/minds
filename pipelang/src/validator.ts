// Two-pass compiler validator for the pipelang DSL
//
// Pass 1: Collect all declared phase names
// Pass 2: Validate all cross-references (to: targets, signal declarations)

import type { PipelineAST, CompileError, DisplayValue } from "./types";
import { BUILTIN_TOKENS, KNOWN_CONDITIONS } from "./types";

const TOKEN_RE = /\$\{([A-Z][A-Z0-9_]*)\}/g;

function validateTokensInString(
  text: string,
  loc: { line: number; col: number },
  errors: CompileError[]
): void {
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const name = m[1];
    if (!BUILTIN_TOKENS.has(name)) {
      errors.push({
        message: `'${name}' is not a built-in token variable. Built-in variables: ${[...BUILTIN_TOKENS].join(", ")}. Use ai("...") for runtime expressions.`,
        loc,
      });
    }
  }
}

function validateDisplayValue(
  dv: DisplayValue,
  loc: { line: number; col: number },
  errors: CompileError[]
): void {
  if (dv.kind === "inline") {
    validateTokensInString(dv.text, loc, errors);
  }
  // ai() and .file() values are not subject to token validation
}

// ── Edit distance for "did you mean?" ────────────────────────────────────────

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function didYouMean(name: string, candidates: Iterable<string>): string | undefined {
  const threshold = Math.max(2, Math.floor(name.length / 3));
  let best: { name: string; dist: number } | undefined;
  for (const c of candidates) {
    const dist = editDistance(name.toLowerCase(), c.toLowerCase());
    if (dist <= threshold && (!best || dist < best.dist)) {
      best = { name: c, dist };
    }
  }
  return best?.name;
}

// ── Cycle detection ───────────────────────────────────────────────────────────

/**
 * DFS-based cycle detection over direct phase-to-phase `to:` edges.
 * Self-loops (A → A) are intentional retry patterns and are skipped.
 * Detected cycles emit warnings, not errors — cycles through gates are
 * intentional (handled by maxRetries), so only direct phase cycles warn.
 */
function detectCycles(
  phases: PipelineAST["phases"],
  edges: Map<string, string[]>,
  errors: CompileError[]
): void {
  const phaseLocMap = new Map(phases.map((p) => [p.name, p.loc]));
  // 0=unvisited, 1=in current path (gray), 2=done (black)
  const color = new Map<string, 0 | 1 | 2>();
  for (const p of phases) color.set(p.name, 0);

  const path: string[] = [];
  const reported = new Set<string>(); // deduplicate by cycle signature

  function dfs(node: string): void {
    color.set(node, 1);
    path.push(node);

    for (const neighbor of edges.get(node) ?? []) {
      if (neighbor === node) continue; // skip self-loops

      if (color.get(neighbor) === 1) {
        // Back edge found — reconstruct cycle from path
        const cycleStart = path.indexOf(neighbor);
        const cycle = [...path.slice(cycleStart), neighbor];
        // Normalise to the smallest-name start to avoid duplicate reports
        const minIdx = cycle.indexOf([...cycle].sort()[0]);
        const canonical = [...cycle.slice(minIdx), ...cycle.slice(1, minIdx + 1)].join(" → ");
        if (!reported.has(canonical)) {
          reported.add(canonical);
          errors.push({
            message: `Cycle detected: ${cycle.join(" → ")}`,
            loc: phaseLocMap.get(node) ?? { line: 1, col: 1 },
            severity: "warning",
          });
        }
      } else if (color.get(neighbor) === 0) {
        dfs(neighbor);
      }
    }

    path.pop();
    color.set(node, 2);
  }

  for (const p of phases) {
    if (color.get(p.name) === 0) dfs(p.name);
  }
}

// ── Validator ─────────────────────────────────────────────────────────────────

export function validate(ast: PipelineAST): CompileError[] {
  const errors: CompileError[] = [];

  // Pass 1: collect all declared phase and gate names (with duplicate detection)
  const phaseNames = new Set<string>();
  for (const phase of ast.phases) {
    if (phaseNames.has(phase.name)) {
      errors.push({
        message: `Duplicate phase name '${phase.name}'`,
        loc: phase.loc,
      });
    }
    phaseNames.add(phase.name);
  }

  const gateNames = new Set<string>();
  for (const gate of ast.gates) {
    if (gateNames.has(gate.name)) {
      errors.push({
        message: `Duplicate gate name '${gate.name}'`,
        loc: gate.loc,
      });
    }
    gateNames.add(gate.name);
  }

  // Pass 1b: validate gate internals (skipTo constraint, prompt, routing completeness)
  for (const gate of ast.gates) {
    const hasSkipTo = gate.modifiers.some((m) => m.kind === "skipTo");
    for (const mod of gate.modifiers) {
      if (mod.kind === "on" && mod.onExhaust === "skip" && !hasSkipTo) {
        errors.push({
          message: `skipTo is required on gate '${gate.name}' because a response uses onExhaust: .skip`,
          loc: mod.loc,
        });
      }
      // Validate to: targets within gates (target is optional — absent when onExhaust handles routing)
      if (mod.kind === "on" && mod.target !== undefined && !phaseNames.has(mod.target.phase)) {
        const suggestion = didYouMean(mod.target.phase, phaseNames);
        errors.push({
          message:
            `Phase '${mod.target.phase}' not declared` +
            (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.target.phaseLoc,
        });
      }
      // Validate skipTo targets
      if (mod.kind === "skipTo" && !phaseNames.has(mod.phase)) {
        const suggestion = didYouMean(mod.phase, phaseNames);
        errors.push({
          message:
            `Phase '${mod.phase}' not declared (in skipTo)` +
            (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.phaseLoc,
        });
      }
      // Warn when gate prompt uses ai() — gate prompts should be static review criteria
      if (mod.kind === "prompt" && mod.source.kind === "ai") {
        errors.push({
          message: `Gate '${gate.name}' uses ai() in .prompt() — gate prompts should be static review criteria. Use .file() for maintainable, auditable prompts.`,
          loc: mod.loc,
          severity: "warning",
        });
      }
      // Error when gate .on() has no routing at all — dead-end at runtime
      if (mod.kind === "on" && mod.target === undefined && mod.onExhaust === undefined) {
        errors.push({
          message: `Gate '${gate.name}' response for '${mod.signal}' has no 'to:' target and no 'onExhaust:' — this creates a dead-end at runtime`,
          loc: mod.loc,
        });
      }
    }
  }

  // Pass 2: validate each phase's modifiers
  for (const phase of ast.phases) {
    const isTerminal = phase.modifiers.some((m) => m.kind === "terminal");

    // Collect declared signals for this phase
    const declaredSignals = new Set<string>();
    for (const mod of phase.modifiers) {
      if (mod.kind === "signals") {
        for (const sig of mod.signals) declaredSignals.add(sig);
      }
    }

    // Validate actions blocks: duplicate command check + token validation
    for (const mod of phase.modifiers) {
      if (mod.kind !== "actions") continue;

      let commandCount = 0;
      for (const action of mod.actions) {
        if (action.kind === "command") {
          commandCount++;
          if (commandCount > 1) {
            errors.push({
              message: `Only one command() allowed per actions block. Split into a separate phase.`,
              loc: action.loc,
            });
          }
        } else if (action.kind === "display" || action.kind === "prompt") {
          validateDisplayValue(action.value, action.loc, errors);
        }
      }
    }

    for (const mod of phase.modifiers) {
      if (mod.kind !== "on") continue;

      // Terminal phases cannot have outbound transitions
      if (isTerminal) {
        errors.push({
          message: `Terminal phases cannot have outbound transitions`,
          loc: mod.loc,
        });
        continue;
      }

      // Signal must be declared in .signals()
      if (!declaredSignals.has(mod.signal)) {
        const suggestion = didYouMean(mod.signal, declaredSignals);
        errors.push({
          message:
            `Signal '${mod.signal}' not declared for phase '${phase.name}'` +
            (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.signalLoc,
        });
      }

      // to: target must be a declared phase; gate: target must be a declared gate
      if (mod.target.kind === "to") {
        if (!phaseNames.has(mod.target.phase)) {
          const suggestion = didYouMean(mod.target.phase, phaseNames);
          errors.push({
            message:
              `Phase '${mod.target.phase}' not declared` +
              (suggestion ? `. Did you mean '${suggestion}'?` : ""),
            loc: mod.target.phaseLoc,
          });
        }
      } else if (mod.target.kind === "gate") {
        if (!gateNames.has(mod.target.gate)) {
          const suggestion = didYouMean(mod.target.gate, gateNames);
          errors.push({
            message:
              `Gate '${mod.target.gate}' not declared` +
              (suggestion ? `. Did you mean '${suggestion}'?` : ""),
            loc: mod.target.gateLoc,
          });
        }
      }
    }

    // Validate conditionalOn modifiers
    for (const mod of phase.modifiers) {
      if (mod.kind !== "conditionalOn") continue;

      // Terminal phases cannot have outbound transitions
      if (isTerminal) {
        errors.push({
          message: `Terminal phases cannot have outbound transitions`,
          loc: mod.loc,
        });
        continue;
      }

      // Signal must be declared in .signals()
      if (!declaredSignals.has(mod.signal)) {
        const suggestion = didYouMean(mod.signal, declaredSignals);
        errors.push({
          message:
            `Signal '${mod.signal}' not declared for phase '${phase.name}'` +
            (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.signalLoc,
        });
      }

      // Conditional block must contain an otherwise branch
      const hasOtherwise = mod.branches.some((b) => b.condition === undefined);
      if (!hasOtherwise) {
        errors.push({
          message: `Conditional transition requires an 'otherwise' branch`,
          loc: mod.loc,
        });
      }

      // Validate each branch
      for (const branch of mod.branches) {
        // Warn on unknown condition identifiers
        if (branch.condition !== undefined) {
          const condIds = branch.condition.split(/\s+/).filter((t) => t !== "and" && t !== "or" && t !== "");
          for (const condId of condIds) {
            if (!KNOWN_CONDITIONS.has(condId)) {
              errors.push({
                message: `Unknown condition '${condId}' — will be AI-evaluated at runtime`,
                loc: branch.loc,
                severity: "warning",
              });
            }
          }
        }

        // Validate targets
        if (branch.target.kind === "to") {
          if (!phaseNames.has(branch.target.phase)) {
            const suggestion = didYouMean(branch.target.phase, phaseNames);
            errors.push({
              message:
                `Phase '${branch.target.phase}' not declared` +
                (suggestion ? `. Did you mean '${suggestion}'?` : ""),
              loc: branch.target.phaseLoc,
            });
          }
        } else if (branch.target.kind === "gate") {
          if (!gateNames.has(branch.target.gate)) {
            const suggestion = didYouMean(branch.target.gate, gateNames);
            errors.push({
              message:
                `Gate '${branch.target.gate}' not declared` +
                (suggestion ? `. Did you mean '${suggestion}'?` : ""),
              loc: branch.target.gateLoc,
            });
          }
        }
      }
    }
  }

  // Pass 3: cycle detection over direct phase-to-phase to: edges
  // Build adjacency list (excluding gate hops — those are intentional retry patterns)
  const cycleEdges = new Map<string, string[]>();
  for (const p of ast.phases) cycleEdges.set(p.name, []);

  for (const phase of ast.phases) {
    for (const mod of phase.modifiers) {
      if (mod.kind === "on" && mod.target.kind === "to") {
        cycleEdges.get(phase.name)!.push(mod.target.phase);
      }
      if (mod.kind === "conditionalOn") {
        for (const branch of mod.branches) {
          if (branch.target.kind === "to") {
            cycleEdges.get(phase.name)!.push(branch.target.phase);
          }
        }
      }
    }
  }

  detectCycles(ast.phases, cycleEdges, errors);

  return errors;
}
