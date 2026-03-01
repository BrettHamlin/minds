// Phase modifier parser — extracted from parser.ts
// Handles .terminal(), .command(), .signals(), .on(), .goalGate(),
// .orchestratorContext(), .actions{}, .model(), and conditional routing

import type { ParserContext } from "./parser-context";
import type {
  Modifier,
  TerminalModifier,
  CommandModifier,
  SignalsModifier,
  OnModifier,
  OnTarget,
  ConditionalOnModifier,
  ConditionalBranch,
  GoalGateModifier,
  OrchestratorContextModifier,
  ContextSource,
  ActionsModifier,
  Action,
  DisplayValue,
  ToTarget,
  GateTarget,
  ModelModifier,
  SourceLocation,
} from "./types";

const VALID_MODEL_NAMES = new Set(["haiku", "sonnet", "opus"]);

// ── Display value parser ─────────────────────────────────────────────────────

function parseDisplayValue(ctx: ParserContext): DisplayValue | null {
  // Case 1: inline string  — "text"
  if (ctx.check("STRING")) {
    const strTok = ctx.advance();
    return { kind: "inline", text: strTok.value };
  }

  // Case 2: ai() form  — ai("expr")
  if (ctx.check("IDENT") && ctx.peek().value === "ai") {
    ctx.advance(); // consume "ai"
    if (!ctx.expect("LPAREN")) return null;
    const strTok = ctx.peek();
    if (strTok.kind !== "STRING") {
      ctx.addError(`'ai()' requires a string argument`, { line: strTok.line, col: strTok.col });
      return null;
    }
    ctx.advance(); // consume the string
    if (!ctx.expect("RPAREN")) return null;
    return { kind: "ai", expr: strTok.value };
  }

  // Case 3: .file() form  — .file("path")
  if (ctx.check("DOT")) {
    ctx.advance(); // consume '.'
    const typeTok = ctx.peek();
    if (typeTok.kind !== "IDENT" || typeTok.value !== "file") {
      ctx.addError(
        `Expected '.file("path")' but found '.${typeTok.value || typeTok.kind}'`,
        { line: typeTok.line, col: typeTok.col }
      );
      return null;
    }
    ctx.advance(); // consume "file"
    if (!ctx.expect("LPAREN")) return null;
    const strTok = ctx.peek();
    if (strTok.kind !== "STRING") {
      ctx.addError(`'.file()' requires a string path argument`, { line: strTok.line, col: strTok.col });
      return null;
    }
    ctx.advance(); // consume the string
    if (!ctx.expect("RPAREN")) return null;
    return { kind: "file", path: strTok.value };
  }

  const t = ctx.peek();
  ctx.addError(
    `Expected string, ai("..."), or .file("...") but found '${t.value || t.kind}'`,
    { line: t.line, col: t.col }
  );
  return null;
}

// ── Branch body parser (for conditional routing) ──────────────────────────

/** Parses: to = phase_name  or  to = gate(name) */
function parseBranchBody(ctx: ParserContext): OnTarget | null {
  const toTok = ctx.peek();
  if (toTok.kind !== "IDENT" || toTok.value !== "to") {
    ctx.addError(
      `Expected 'to = ...' in branch body but found '${toTok.value || toTok.kind}'`,
      { line: toTok.line, col: toTok.col }
    );
    return null;
  }
  ctx.advance(); // consume "to"

  if (!ctx.expect("EQ")) return null;

  const nextTok = ctx.peek();
  if (nextTok.kind === "IDENT" && nextTok.value === "gate") {
    ctx.advance(); // consume "gate"
    if (!ctx.expect("LPAREN")) return null;
    const gateTok = ctx.peek();
    if (gateTok.kind !== "IDENT") {
      ctx.addError(
        `Expected gate name after 'gate(' but found '${gateTok.value || gateTok.kind}'`,
        { line: gateTok.line, col: gateTok.col }
      );
      return null;
    }
    ctx.advance(); // consume gate name
    if (!ctx.expect("RPAREN")) return null;
    return { kind: "gate", gate: gateTok.value, gateLoc: { line: gateTok.line, col: gateTok.col } } satisfies GateTarget;
  } else if (nextTok.kind === "IDENT") {
    ctx.advance(); // consume phase name
    return { kind: "to", phase: nextTok.value, phaseLoc: { line: nextTok.line, col: nextTok.col } } satisfies ToTarget;
  } else {
    ctx.addError(
      `Expected phase name or 'gate(name)' after 'to =' but found '${nextTok.value || nextTok.kind}'`,
      { line: nextTok.line, col: nextTok.col }
    );
    return null;
  }
}

/**
 * Parses the block body of a conditional .on():
 *   { when(cond) { to = target } ... otherwise { to = target } }
 * The opening LBRACE has already been consumed.
 */
function parseConditionalBranches(ctx: ParserContext): ConditionalBranch[] {
  const branches: ConditionalBranch[] = [];

  while (!ctx.check("RBRACE") && !ctx.check("EOF")) {
    const tok = ctx.peek();

    if (tok.kind !== "IDENT" || (tok.value !== "when" && tok.value !== "otherwise")) {
      ctx.addError(
        `Expected 'when(...)' or 'otherwise' in conditional block but found '${tok.value || tok.kind}'`,
        { line: tok.line, col: tok.col }
      );
      ctx.advance(); // skip for recovery
      continue;
    }

    const branchLoc = { line: tok.line, col: tok.col };
    ctx.advance(); // consume "when" or "otherwise"

    if (tok.value === "when") {
      if (!ctx.expect("LPAREN")) break;

      // Parse condition expression: sequence of IDENT tokens (and/or are also IDENTs)
      const condParts: string[] = [];
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
        const t = ctx.peek();
        if (t.kind !== "IDENT") {
          ctx.addError(
            `Expected identifier in condition expression but found '${t.value || t.kind}'`,
            { line: t.line, col: t.col }
          );
          break;
        }
        condParts.push(t.value);
        ctx.advance();
      }
      if (!ctx.expect("RPAREN")) break;

      if (condParts.length === 0) {
        ctx.addError(`'when()' requires a condition expression`, branchLoc);
      }

      if (!ctx.expect("LBRACE")) break;
      const target = parseBranchBody(ctx);
      if (!ctx.expect("RBRACE")) break;

      if (target) {
        branches.push({ condition: condParts.join(" "), target, loc: branchLoc });
      }
    } else {
      // otherwise — no condition expression
      if (!ctx.expect("LBRACE")) break;
      const target = parseBranchBody(ctx);
      if (!ctx.expect("RBRACE")) break;

      if (target) {
        branches.push({ condition: undefined, target, loc: branchLoc });
      }
    }
  }

  return branches;
}

// ── Modifier parser ───────────────────────────────────────────────────────

export function parsePhaseModifier(ctx: ParserContext): Modifier | null {
  ctx.advance(); // consume '.'

  const nameTok = ctx.peek();
  if (nameTok.kind !== "IDENT") {
    ctx.addError(
      `Expected modifier name after '.' but found '${nameTok.value || nameTok.kind}'`,
      { line: nameTok.line, col: nameTok.col }
    );
    return null;
  }
  ctx.advance(); // consume modifier name

  const loc = { line: nameTok.line, col: nameTok.col };

  // .actions {} uses braces instead of parens
  if (nameTok.value === "actions") {
    if (!ctx.expect("LBRACE")) return null;
    const actions: Action[] = [];

    while (!ctx.check("RBRACE") && !ctx.check("EOF")) {
      const actionTok = ctx.peek();
      if (actionTok.kind !== "IDENT") {
        ctx.addError(
          `Expected action name (display, prompt, command) but found '${actionTok.value || actionTok.kind}'`,
          { line: actionTok.line, col: actionTok.col }
        );
        break;
      }
      const actionLoc = { line: actionTok.line, col: actionTok.col };
      ctx.advance(); // consume action name

      if (actionTok.value === "display" || actionTok.value === "prompt") {
        if (!ctx.expect("LPAREN")) break;
        const val = parseDisplayValue(ctx);
        if (val === null) {
          while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
          ctx.advance(); // consume RPAREN
          continue;
        }
        if (!ctx.expect("RPAREN")) break;
        actions.push({ kind: actionTok.value, value: val, loc: actionLoc } as Action);
      } else if (actionTok.value === "command") {
        if (!ctx.expect("LPAREN")) break;
        const strTok = ctx.peek();
        if (strTok.kind !== "STRING") {
          ctx.addError(
            `'command()' in actions block requires a string argument`,
            { line: strTok.line, col: strTok.col }
          );
          while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
          ctx.advance();
          continue;
        }
        ctx.advance(); // consume the string
        if (!ctx.expect("RPAREN")) break;
        actions.push({ kind: "command", value: strTok.value, loc: actionLoc });
      } else {
        ctx.addError(
          `Unknown action '${actionTok.value}'. Valid actions: display, prompt, command`,
          actionLoc
        );
        // Consume arg list for error recovery
        if (ctx.check("LPAREN")) {
          ctx.advance();
          while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
          ctx.advance();
        }
      }
    }

    if (!ctx.expect("RBRACE")) return null;
    return { kind: "actions", actions, loc } satisfies ActionsModifier;
  }

  if (!ctx.expect("LPAREN")) return null;

  switch (nameTok.value) {
    case "terminal":
      if (!ctx.expect("RPAREN")) return null;
      return { kind: "terminal", loc } satisfies TerminalModifier;

    case "command": {
      const strTok = ctx.peek();
      if (strTok.kind !== "STRING") {
        ctx.addError(
          `'.command()' requires a string argument, e.g. .command("/collab.clarify")`,
          { line: strTok.line, col: strTok.col }
        );
        return null;
      }
      ctx.advance(); // consume the STRING
      if (!ctx.expect("RPAREN")) return null;
      return { kind: "command", value: strTok.value, loc } satisfies CommandModifier;
    }

    case "signals": {
      const signals: string[] = [];
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
        const sigTok = ctx.peek();
        if (sigTok.kind !== "IDENT") {
          ctx.addError(
            `Expected signal name in .signals() but found '${sigTok.value}'`,
            { line: sigTok.line, col: sigTok.col }
          );
          break;
        }
        ctx.advance();
        signals.push(sigTok.value);
        if (ctx.check("COMMA")) ctx.advance();
      }
      if (!ctx.expect("RPAREN")) return null;
      return { kind: "signals", signals, loc } satisfies SignalsModifier;
    }

    case "on": {
      const sigTok = ctx.peek();
      if (sigTok.kind !== "IDENT") {
        ctx.addError(
          `Expected signal name in .on() but found '${sigTok.value || sigTok.kind}'`,
          { line: sigTok.line, col: sigTok.col }
        );
        return null;
      }
      ctx.advance(); // consume signal name
      const signalLoc = { line: sigTok.line, col: sigTok.col };

      // Block form: .on(SIGNAL) { when/otherwise ... }
      if (ctx.check("RPAREN")) {
        ctx.advance(); // consume ')'
        if (!ctx.expect("LBRACE")) return null;
        const branches = parseConditionalBranches(ctx);
        if (!ctx.expect("RBRACE")) return null;
        return { kind: "conditionalOn", signal: sigTok.value, signalLoc, branches, loc } satisfies ConditionalOnModifier;
      }

      // Simple / gate form: .on(SIGNAL, to: phase) or .on(SIGNAL, gate: name)
      if (!ctx.check("COMMA")) {
        const t = ctx.peek();
        ctx.addError(`Expected ',' after signal name in .on()`, { line: t.line, col: t.col });
        return null;
      }
      ctx.advance(); // consume comma

      const paramTok = ctx.peek();
      if (paramTok.kind !== "IDENT" || (paramTok.value !== "to" && paramTok.value !== "gate")) {
        ctx.addError(
          `Expected 'to:' or 'gate:' named parameter in .on() but found '${paramTok.value}'`,
          { line: paramTok.line, col: paramTok.col }
        );
        return null;
      }
      const paramKind = paramTok.value as "to" | "gate";
      ctx.advance(); // consume "to" or "gate"

      if (!ctx.expect("COLON")) return null;

      const targetTok = ctx.peek();
      if (targetTok.kind !== "IDENT") {
        ctx.addError(
          `Expected ${paramKind === "to" ? "phase" : "gate"} name after '${paramKind}:' but found '${targetTok.value || targetTok.kind}'`,
          { line: targetTok.line, col: targetTok.col }
        );
        return null;
      }
      ctx.advance(); // consume target name

      if (!ctx.expect("RPAREN")) return null;

      let target: OnTarget;
      if (paramKind === "to") {
        target = { kind: "to", phase: targetTok.value, phaseLoc: { line: targetTok.line, col: targetTok.col } } satisfies ToTarget;
      } else {
        target = { kind: "gate", gate: targetTok.value, gateLoc: { line: targetTok.line, col: targetTok.col } } satisfies GateTarget;
      }
      return { kind: "on", signal: sigTok.value, signalLoc, target, loc } satisfies OnModifier;
    }

    case "goalGate": {
      if (!ctx.check("DOT")) {
        const t = ctx.peek();
        ctx.addError(`'.goalGate()' requires an enum argument: .always or .ifTriggered`, { line: t.line, col: t.col });
        return null;
      }
      ctx.advance(); // consume '.'

      const valueTok = ctx.peek();
      if (valueTok.kind !== "IDENT") {
        ctx.addError(`Expected enum value after '.' in .goalGate()`, { line: valueTok.line, col: valueTok.col });
        return null;
      }
      ctx.advance(); // consume enum value

      if (valueTok.value !== "always" && valueTok.value !== "ifTriggered") {
        ctx.addError(
          `Invalid GoalGate value '.${valueTok.value}'. Valid values: .always, .ifTriggered`,
          { line: valueTok.line, col: valueTok.col }
        );
        return null;
      }

      if (!ctx.expect("RPAREN")) return null;
      return {
        kind: "goalGate",
        value: valueTok.value as "always" | "ifTriggered",
        loc,
      } satisfies GoalGateModifier;
    }

    case "model": {
      const nameTokM = ctx.peek();
      if (nameTokM.kind !== "IDENT" || !VALID_MODEL_NAMES.has(nameTokM.value)) {
        ctx.addError(
          `'.model()' requires a valid model name: haiku, sonnet, or opus`,
          { line: nameTokM.line, col: nameTokM.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        ctx.advance();
        return null;
      }
      ctx.advance(); // consume model name
      if (!ctx.expect("RPAREN")) return null;
      return {
        kind: "model",
        name: nameTokM.value as "haiku" | "sonnet" | "opus",
        loc,
      } satisfies ModelModifier;
    }

    case "orchestratorContext": {
      if (!ctx.check("DOT")) {
        const t = ctx.peek();
        ctx.addError(`'.orchestratorContext()' requires .file() or .inline()`, { line: t.line, col: t.col });
        return null;
      }
      ctx.advance(); // consume '.'

      const typeTok = ctx.peek();
      if (typeTok.kind !== "IDENT" || (typeTok.value !== "file" && typeTok.value !== "inline")) {
        ctx.addError(
          `Expected '.file()' or '.inline()' in .orchestratorContext() but found '.${typeTok.value}'`,
          { line: typeTok.line, col: typeTok.col }
        );
        return null;
      }
      ctx.advance(); // consume "file" or "inline"

      if (!ctx.expect("LPAREN")) return null;

      const strTok = ctx.peek();
      if (strTok.kind !== "STRING") {
        ctx.addError(`'.${typeTok.value}()' requires a string argument`, { line: strTok.line, col: strTok.col });
        return null;
      }
      ctx.advance(); // consume the string

      if (!ctx.expect("RPAREN")) return null; // close .file() or .inline()
      if (!ctx.expect("RPAREN")) return null; // close .orchestratorContext()

      const source: ContextSource =
        typeTok.value === "file"
          ? { kind: "file", path: strTok.value }
          : { kind: "inline", text: strTok.value };

      return { kind: "orchestratorContext", source, loc } satisfies OrchestratorContextModifier;
    }

    default:
      // Unknown modifier — consume the arg list to keep parsing
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
      if (!ctx.expect("RPAREN")) return null;
      ctx.addError(`Unknown modifier '.${nameTok.value}()'`, loc);
      return null;
  }
}
