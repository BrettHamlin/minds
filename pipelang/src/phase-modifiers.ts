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
  GoalGateModifier,
  OrchestratorContextModifier,
  ContextSource,
  ActionsModifier,
  Action,
  DisplayValue,
  ToTarget,
  GateTarget,
  ModelModifier,
  BeforeModifier,
  AfterModifier,
  CodeReviewModifier,
  MetricsModifier,
  InteractiveModifier,
  SourceLocation,
} from "./types";
import { VALID_MODEL_NAMES } from "./types";

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

// ── On-target parser (shared by when:/otherwise/simple .on() forms) ──────────

function parseOnTarget(ctx: ParserContext): OnTarget | null {
  const paramTok = ctx.peek();
  if (paramTok.kind !== "IDENT" || (paramTok.value !== "to" && paramTok.value !== "gate")) {
    ctx.addError(
      `Expected 'to:' or 'gate:' but found '${paramTok.value || paramTok.kind}'`,
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
  ctx.advance();
  if (!ctx.expect("RPAREN")) return null;
  return paramKind === "to"
    ? { kind: "to", phase: targetTok.value, phaseLoc: { line: targetTok.line, col: targetTok.col } } satisfies ToTarget
    : { kind: "gate", gate: targetTok.value, gateLoc: { line: targetTok.line, col: targetTok.col } } satisfies GateTarget;
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

      // Detect old block form: .on(SIGNAL) { when/otherwise } — not supported
      if (ctx.check("RPAREN")) {
        ctx.advance(); // consume ')'
        if (ctx.check("LBRACE")) {
          ctx.addError(
            `Block-form .on(${sigTok.value}) { when/otherwise } is not supported. ` +
            `Use .on(${sigTok.value}, when: cond, to: target) or .on(${sigTok.value}, otherwise, to: target)`,
            loc
          );
          // Skip block body for error recovery
          let depth = 1;
          ctx.advance(); // consume '{'
          while (!ctx.check("EOF") && depth > 0) {
            if (ctx.check("LBRACE")) depth++;
            else if (ctx.check("RBRACE")) depth--;
            ctx.advance();
          }
          return null;
        }
        const t = ctx.peek();
        ctx.addError(`Expected ',' after signal name in .on()`, { line: t.line, col: t.col });
        return null;
      }

      if (!ctx.check("COMMA")) {
        const t = ctx.peek();
        ctx.addError(`Expected ',' after signal name in .on()`, { line: t.line, col: t.col });
        return null;
      }
      ctx.advance(); // consume comma

      const firstParam = ctx.peek();

      // when: condition, to: target  or  when: condition, gate: target
      if (firstParam.kind === "IDENT" && firstParam.value === "when") {
        ctx.advance(); // consume "when"
        if (!ctx.expect("COLON")) return null;

        // Parse condition — IDENTs until COMMA
        const condParts: string[] = [];
        while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) {
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
        if (condParts.length === 0) {
          ctx.addError(`'when:' requires a condition expression`, loc);
        }
        if (!ctx.expect("COMMA")) return null;

        const target = parseOnTarget(ctx);
        if (!target) return null;
        return { kind: "on", signal: sigTok.value, signalLoc, target, condition: condParts.join(" "), loc } satisfies OnModifier;
      }

      // otherwise, to: target  or  otherwise, gate: target
      if (firstParam.kind === "IDENT" && firstParam.value === "otherwise") {
        ctx.advance(); // consume "otherwise"
        if (!ctx.expect("COMMA")) return null;
        const target = parseOnTarget(ctx);
        if (!target) return null;
        return { kind: "on", signal: sigTok.value, signalLoc, target, isOtherwise: true, loc } satisfies OnModifier;
      }

      // Simple to: or gate: form
      if (firstParam.kind !== "IDENT" || (firstParam.value !== "to" && firstParam.value !== "gate")) {
        ctx.addError(
          `Expected 'to:', 'gate:', 'when: cond, to:', or 'otherwise, to:' in .on() but found '${firstParam.value}'`,
          { line: firstParam.line, col: firstParam.col }
        );
        return null;
      }
      const target = parseOnTarget(ctx);
      if (!target) return null;
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

    case "before":
    case "after": {
      const phaseTok = ctx.peek();
      if (phaseTok.kind !== "IDENT") {
        ctx.addError(
          `'.${nameTok.value}()' requires a phase name argument`,
          { line: phaseTok.line, col: phaseTok.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        ctx.advance();
        return null;
      }
      ctx.advance(); // consume phase name
      const phaseLoc = { line: phaseTok.line, col: phaseTok.col };
      if (!ctx.expect("RPAREN")) return null;
      return {
        kind: nameTok.value as "before" | "after",
        phase: phaseTok.value,
        phaseLoc,
        loc,
      } satisfies BeforeModifier | AfterModifier;
    }

    case "codeReview": {
      const t = ctx.peek();
      if (t.kind !== "IDENT" || t.value !== "off") {
        ctx.addError(
          `.codeReview() only supports .codeReview(off) from a phase. Use @codeReview() directive for full configuration.`,
          { line: t.line, col: t.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        return null;
      }
      ctx.advance(); // consume "off"
      if (!ctx.expect("RPAREN")) return null;
      return { kind: "codeReview", enabled: false, loc } satisfies CodeReviewModifier;
    }

    case "metrics": {
      const t = ctx.peek();
      if (t.kind !== "IDENT" || t.value !== "off") {
        ctx.addError(
          `.metrics() only supports .metrics(off) from a phase. Use @metrics() directive for global configuration.`,
          { line: t.line, col: t.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        return null;
      }
      ctx.advance(); // consume "off"
      if (!ctx.expect("RPAREN")) return null;
      return { kind: "metrics", enabled: false, loc } satisfies MetricsModifier;
    }

    case "interactive": {
      const t = ctx.peek();
      if (t.kind !== "IDENT" || (t.value !== "on" && t.value !== "off")) {
        ctx.addError(
          `.interactive() requires .interactive(on) or .interactive(off). Use @interactive() directive for global configuration.`,
          { line: t.line, col: t.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        return null;
      }
      const enabled = t.value === "on";
      ctx.advance(); // consume "on" or "off"
      if (!ctx.expect("RPAREN")) return null;
      return { kind: "interactive", enabled, loc } satisfies InteractiveModifier;
    }

    default:
      // Unknown modifier — consume the arg list to keep parsing
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
      if (!ctx.expect("RPAREN")) return null;
      ctx.addError(`Unknown modifier '.${nameTok.value}()'`, loc);
      return null;
  }
}
