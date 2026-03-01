// Gate declaration parser — extracted from parser.ts
// Handles gate(name) .prompt() .skipTo() .on()

import type { ParserContext } from "./parser-context";
import type {
  GateDecl,
  GateModifier,
  GatePromptModifier,
  GateSkipToModifier,
  GateOnModifier,
  ContextSource,
  ToTarget,
} from "./types";

export function parseGateDecl(ctx: ParserContext): GateDecl | null {
  const kw = ctx.advance(); // consume 'gate'
  const loc = { line: kw.line, col: kw.col };

  if (!ctx.expect("LPAREN")) return null;

  const nameTok = ctx.peek();
  if (nameTok.kind !== "IDENT") {
    ctx.addError(
      `Expected gate name identifier but found '${nameTok.value || nameTok.kind}'`,
      { line: nameTok.line, col: nameTok.col }
    );
    return null;
  }
  ctx.advance(); // consume name

  if (!ctx.expect("RPAREN")) return null;

  const modifiers: GateModifier[] = [];

  while (ctx.check("DOT")) {
    ctx.advance(); // consume '.'
    const mNameTok = ctx.peek();
    if (mNameTok.kind !== "IDENT") {
      ctx.addError(
        `Expected gate modifier name after '.' but found '${mNameTok.value || mNameTok.kind}'`,
        { line: mNameTok.line, col: mNameTok.col }
      );
      break;
    }
    ctx.advance(); // consume modifier name
    const mLoc = { line: mNameTok.line, col: mNameTok.col };

    if (mNameTok.value === "prompt") {
      // .prompt(.file("path")) or .prompt(.inline("text"))
      if (!ctx.expect("LPAREN")) break;

      if (!ctx.check("DOT")) {
        const t = ctx.peek();
        ctx.addError(`'.prompt()' requires .file() or .inline()`, { line: t.line, col: t.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        continue;
      }
      ctx.advance(); // consume '.'

      const typeTok = ctx.peek();
      if (typeTok.kind !== "IDENT" || (typeTok.value !== "file" && typeTok.value !== "inline" && typeTok.value !== "ai")) {
        ctx.addError(
          `Expected '.file()', '.inline()', or '.ai()' in .prompt() but found '.${typeTok.value}'`,
          { line: typeTok.line, col: typeTok.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        continue;
      }
      ctx.advance(); // consume "file" or "inline"

      if (!ctx.expect("LPAREN")) break;
      const strTok = ctx.peek();
      if (strTok.kind !== "STRING") {
        ctx.addError(
          `'.${typeTok.value}()' requires a string argument`,
          { line: strTok.line, col: strTok.col }
        );
        return null;
      }
      ctx.advance(); // consume string
      if (!ctx.expect("RPAREN")) break; // close .file/.inline
      if (!ctx.expect("RPAREN")) break; // close .prompt

      const source: ContextSource =
        typeTok.value === "file"
          ? { kind: "file", path: strTok.value }
          : typeTok.value === "ai"
          ? { kind: "ai", expr: strTok.value }
          : { kind: "inline", text: strTok.value };
      modifiers.push({ kind: "prompt", source, loc: mLoc } satisfies GatePromptModifier);

    } else if (mNameTok.value === "skipTo") {
      // .skipTo(phase_name)
      if (!ctx.expect("LPAREN")) break;
      const phaseTok = ctx.peek();
      if (phaseTok.kind !== "IDENT") {
        ctx.addError(
          `'.skipTo()' requires a phase name but found '${phaseTok.value || phaseTok.kind}'`,
          { line: phaseTok.line, col: phaseTok.col }
        );
        return null;
      }
      ctx.advance(); // consume phase name
      if (!ctx.expect("RPAREN")) break;
      modifiers.push({
        kind: "skipTo",
        phase: phaseTok.value,
        phaseLoc: { line: phaseTok.line, col: phaseTok.col },
        loc: mLoc,
      } satisfies GateSkipToModifier);

    } else if (mNameTok.value === "on") {
      // .on(SIGNAL, to: phase) with optional: feedback: .enrich, maxRetries: N, onExhaust: .skip
      if (!ctx.expect("LPAREN")) break;

      const sigTok = ctx.peek();
      if (sigTok.kind !== "IDENT") {
        ctx.addError(
          `Expected signal name in gate .on() but found '${sigTok.value || sigTok.kind}'`,
          { line: sigTok.line, col: sigTok.col }
        );
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        continue;
      }
      ctx.advance(); // consume signal name
      const gSignalLoc = { line: sigTok.line, col: sigTok.col };

      if (!ctx.check("COMMA")) {
        const t = ctx.peek();
        ctx.addError(`Expected ',' after signal name in gate .on()`, { line: t.line, col: t.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
        if (ctx.check("RPAREN")) ctx.advance();
        continue;
      }
      ctx.advance(); // consume comma

      // Named params (order-independent): to, feedback, maxRetries, onExhaust
      let gTarget: ToTarget | undefined;
      let feedback: "enrich" | "raw" | undefined;
      let maxRetries: number | undefined;
      let onExhaust: "escalate" | "skip" | "abort" | undefined;

      while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
        const paramTok = ctx.peek();
        if (paramTok.kind !== "IDENT") break;
        ctx.advance(); // consume param name

        if (!ctx.expect("COLON")) break;

        if (paramTok.value === "to") {
          const gTargetTok = ctx.peek();
          if (gTargetTok.kind !== "IDENT") {
            ctx.addError(
              `Expected phase name after 'to:' in gate .on() but found '${gTargetTok.value || gTargetTok.kind}'`,
              { line: gTargetTok.line, col: gTargetTok.col }
            );
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF")) ctx.advance();
            continue;
          }
          ctx.advance(); // consume phase name
          gTarget = { kind: "to", phase: gTargetTok.value, phaseLoc: { line: gTargetTok.line, col: gTargetTok.col } };
        } else if (paramTok.value === "feedback") {
          if (!ctx.check("DOT")) {
            const t = ctx.peek();
            ctx.addError(`'feedback:' requires a dot-enum value: .enrich or .raw`, { line: t.line, col: t.col });
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF")) ctx.advance();
            continue;
          }
          ctx.advance(); // consume '.'
          const enumTok = ctx.peek();
          if (enumTok.kind !== "IDENT" || (enumTok.value !== "enrich" && enumTok.value !== "raw")) {
            ctx.addError(
              `Invalid Feedback value '.${enumTok.value}'. Valid values: .enrich, .raw`,
              { line: enumTok.line, col: enumTok.col }
            );
            ctx.advance();
            continue;
          }
          ctx.advance(); // consume enum value
          feedback = enumTok.value as "enrich" | "raw";

        } else if (paramTok.value === "maxRetries") {
          const numTok = ctx.peek();
          if (numTok.kind !== "NUMBER") {
            ctx.addError(
              `'maxRetries:' requires an integer value but found '${numTok.value || numTok.kind}'`,
              { line: numTok.line, col: numTok.col }
            );
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF")) ctx.advance();
            continue;
          }
          ctx.advance(); // consume number
          maxRetries = parseInt(numTok.value, 10);

        } else if (paramTok.value === "onExhaust") {
          if (!ctx.check("DOT")) {
            const t = ctx.peek();
            ctx.addError(
              `'onExhaust:' requires a dot-enum value: .escalate, .skip, or .abort`,
              { line: t.line, col: t.col }
            );
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF")) ctx.advance();
            continue;
          }
          ctx.advance(); // consume '.'
          const enumTok = ctx.peek();
          const validExhaust = new Set(["escalate", "skip", "abort"]);
          if (enumTok.kind !== "IDENT" || !validExhaust.has(enumTok.value)) {
            ctx.addError(
              `Invalid Exhaust value '.${enumTok.value}'. Valid values: .escalate, .skip, .abort`,
              { line: enumTok.line, col: enumTok.col }
            );
            ctx.advance();
            continue;
          }
          ctx.advance(); // consume enum value
          onExhaust = enumTok.value as "escalate" | "skip" | "abort";
        } else {
          ctx.addError(
            `Unknown gate .on() parameter '${paramTok.value}'. Valid: to, feedback, maxRetries, onExhaust`,
            { line: paramTok.line, col: paramTok.col }
          );
          while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF")) ctx.advance();
        }
        // Consume trailing comma to move to next param
        if (ctx.check("COMMA")) ctx.advance();
      }

      if (!ctx.expect("RPAREN")) break;

      const gMod: GateOnModifier = {
        kind: "on",
        signal: sigTok.value,
        signalLoc: gSignalLoc,
        loc: mLoc,
      };
      if (gTarget !== undefined) gMod.target = gTarget;
      if (feedback !== undefined) gMod.feedback = feedback;
      if (maxRetries !== undefined) gMod.maxRetries = maxRetries;
      if (onExhaust !== undefined) gMod.onExhaust = onExhaust;
      modifiers.push(gMod);

    } else {
      ctx.addError(
        `Unknown gate modifier '.${mNameTok.value}()'. Valid: prompt, skipTo, on`,
        mLoc
      );
      if (!ctx.expect("LPAREN")) break;
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) ctx.advance();
      if (ctx.check("RPAREN")) ctx.advance();
    }
  }

  return { name: nameTok.value, loc, nameLoc: { line: nameTok.line, col: nameTok.col }, modifiers };
}
