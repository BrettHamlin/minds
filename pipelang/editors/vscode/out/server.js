#!/usr/bin/env bun
// @bun

// ../../src/lsp/transport.ts
class LspTransport {
  input;
  output;
  onMessage;
  buffer = "";
  pendingLength = null;
  constructor(input, output, onMessage) {
    this.input = input;
    this.output = output;
    this.onMessage = onMessage;
  }
  start() {
    this.input.setEncoding("utf8");
    this.input.on("data", (chunk) => this.onData(chunk));
    this.input.on("end", () => process.exit(0));
  }
  send(message) {
    const body = JSON.stringify(message);
    const byteLength = Buffer.byteLength(body, "utf8");
    this.output.write(`Content-Length: ${byteLength}\r
\r
${body}`);
  }
  onData(chunk) {
    this.buffer += chunk;
    this.processBuffer();
  }
  processBuffer() {
    while (true) {
      if (this.pendingLength === null) {
        const headerEnd = this.buffer.indexOf(`\r
\r
`);
        if (headerEnd === -1)
          return;
        const headerStr = this.buffer.slice(0, headerEnd);
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        this.pendingLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }
      if (this.buffer.length < this.pendingLength)
        return;
      const bodyBytes = Buffer.from(this.buffer, "utf8").slice(0, this.pendingLength);
      const body = bodyBytes.toString("utf8");
      this.buffer = Buffer.from(this.buffer, "utf8").slice(this.pendingLength).toString("utf8");
      this.pendingLength = null;
      try {
        const msg = JSON.parse(body);
        this.onMessage(msg);
      } catch {}
    }
  }
}

// ../../src/lexer.ts
function tokenize(source) {
  const tokens = [];
  const errors = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;
  const col = () => pos - lineStart + 1;
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === " " || ch === "\t" || ch === "\r") {
      pos++;
      continue;
    }
    if (ch === `
`) {
      line++;
      lineStart = pos + 1;
      pos++;
      continue;
    }
    if (ch === "#" || ch === "/" && source[pos + 1] === "/") {
      while (pos < source.length && source[pos] !== `
`)
        pos++;
      continue;
    }
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
    if (ch === '"') {
      const startCol = col();
      pos++;
      let str = "";
      while (pos < source.length && source[pos] !== '"') {
        if (source[pos] === `
`) {
          errors.push({ message: "Unterminated string literal", line, col: startCol });
          break;
        }
        if (source[pos] === "\\") {
          const next = source[pos + 1];
          if (next === '"') {
            str += '"';
            pos += 2;
          } else if (next === "n") {
            str += `
`;
            pos += 2;
          } else if (next === "t") {
            str += "\t";
            pos += 2;
          } else if (next === "\\") {
            str += "\\";
            pos += 2;
          } else {
            str += source[pos++];
          }
        } else {
          str += source[pos++];
        }
      }
      if (pos < source.length && source[pos] === '"') {
        pos++;
        tokens.push({ kind: "STRING", value: str, line, col: startCol });
      } else if (!errors.some((e) => e.line === line && e.col === startCol)) {
        errors.push({ message: "Unterminated string literal", line, col: startCol });
      }
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = pos;
      const startCol = col();
      while (pos < source.length && /[0-9]/.test(source[pos]))
        pos++;
      tokens.push({ kind: "NUMBER", value: source.slice(start, pos), line, col: startCol });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = pos;
      const startCol = col();
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos]))
        pos++;
      tokens.push({
        kind: "IDENT",
        value: source.slice(start, pos),
        line,
        col: startCol
      });
      continue;
    }
    errors.push({
      message: `Unexpected character '${ch}'`,
      line,
      col: col()
    });
    pos++;
  }
  tokens.push({ kind: "EOF", value: "", line, col: col() });
  return { tokens, errors };
}

// ../../src/parser-context.ts
function createParserContext(tokens, errors) {
  let pos = 0;
  function peek() {
    return tokens[pos];
  }
  function advance() {
    const tok = tokens[pos];
    if (tok.kind !== "EOF")
      pos++;
    return tok;
  }
  function check(kind, value) {
    const tok = peek();
    if (tok.kind !== kind)
      return false;
    if (value !== undefined && tok.value !== value)
      return false;
    return true;
  }
  function expect(kind, value) {
    if (!check(kind, value)) {
      const tok = peek();
      const expected = value ? `'${value}'` : kind;
      errors.push({
        message: `Expected ${expected} but found '${tok.value || tok.kind}'`,
        loc: { line: tok.line, col: tok.col }
      });
      return null;
    }
    return advance();
  }
  function addError(message, loc) {
    errors.push({ message, loc });
  }
  return { peek, advance, check, expect, addError };
}

// ../../src/phase-modifiers.ts
var VALID_MODEL_NAMES = new Set(["haiku", "sonnet", "opus"]);
function parseDisplayValue(ctx) {
  if (ctx.check("STRING")) {
    const strTok = ctx.advance();
    return { kind: "inline", text: strTok.value };
  }
  if (ctx.check("IDENT") && ctx.peek().value === "ai") {
    ctx.advance();
    if (!ctx.expect("LPAREN"))
      return null;
    const strTok = ctx.peek();
    if (strTok.kind !== "STRING") {
      ctx.addError(`'ai()' requires a string argument`, { line: strTok.line, col: strTok.col });
      return null;
    }
    ctx.advance();
    if (!ctx.expect("RPAREN"))
      return null;
    return { kind: "ai", expr: strTok.value };
  }
  if (ctx.check("DOT")) {
    ctx.advance();
    const typeTok = ctx.peek();
    if (typeTok.kind !== "IDENT" || typeTok.value !== "file") {
      ctx.addError(`Expected '.file("path")' but found '.${typeTok.value || typeTok.kind}'`, { line: typeTok.line, col: typeTok.col });
      return null;
    }
    ctx.advance();
    if (!ctx.expect("LPAREN"))
      return null;
    const strTok = ctx.peek();
    if (strTok.kind !== "STRING") {
      ctx.addError(`'.file()' requires a string path argument`, { line: strTok.line, col: strTok.col });
      return null;
    }
    ctx.advance();
    if (!ctx.expect("RPAREN"))
      return null;
    return { kind: "file", path: strTok.value };
  }
  const t = ctx.peek();
  ctx.addError(`Expected string, ai("..."), or .file("...") but found '${t.value || t.kind}'`, { line: t.line, col: t.col });
  return null;
}
function parseOnTarget(ctx) {
  const paramTok = ctx.peek();
  if (paramTok.kind !== "IDENT" || paramTok.value !== "to" && paramTok.value !== "gate") {
    ctx.addError(`Expected 'to:' or 'gate:' but found '${paramTok.value || paramTok.kind}'`, { line: paramTok.line, col: paramTok.col });
    return null;
  }
  const paramKind = paramTok.value;
  ctx.advance();
  if (!ctx.expect("COLON"))
    return null;
  const targetTok = ctx.peek();
  if (targetTok.kind !== "IDENT") {
    ctx.addError(`Expected ${paramKind === "to" ? "phase" : "gate"} name after '${paramKind}:' but found '${targetTok.value || targetTok.kind}'`, { line: targetTok.line, col: targetTok.col });
    return null;
  }
  ctx.advance();
  if (!ctx.expect("RPAREN"))
    return null;
  return paramKind === "to" ? { kind: "to", phase: targetTok.value, phaseLoc: { line: targetTok.line, col: targetTok.col } } : { kind: "gate", gate: targetTok.value, gateLoc: { line: targetTok.line, col: targetTok.col } };
}
function parsePhaseModifier(ctx) {
  ctx.advance();
  const nameTok = ctx.peek();
  if (nameTok.kind !== "IDENT") {
    ctx.addError(`Expected modifier name after '.' but found '${nameTok.value || nameTok.kind}'`, { line: nameTok.line, col: nameTok.col });
    return null;
  }
  ctx.advance();
  const loc = { line: nameTok.line, col: nameTok.col };
  if (nameTok.value === "actions") {
    if (!ctx.expect("LBRACE"))
      return null;
    const actions = [];
    while (!ctx.check("RBRACE") && !ctx.check("EOF")) {
      const actionTok = ctx.peek();
      if (actionTok.kind !== "IDENT") {
        ctx.addError(`Expected action name (display, prompt, command) but found '${actionTok.value || actionTok.kind}'`, { line: actionTok.line, col: actionTok.col });
        break;
      }
      const actionLoc = { line: actionTok.line, col: actionTok.col };
      ctx.advance();
      if (actionTok.value === "display" || actionTok.value === "prompt") {
        if (!ctx.expect("LPAREN"))
          break;
        const val = parseDisplayValue(ctx);
        if (val === null) {
          while (!ctx.check("RPAREN") && !ctx.check("EOF"))
            ctx.advance();
          ctx.advance();
          continue;
        }
        if (!ctx.expect("RPAREN"))
          break;
        actions.push({ kind: actionTok.value, value: val, loc: actionLoc });
      } else if (actionTok.value === "command") {
        if (!ctx.expect("LPAREN"))
          break;
        const strTok = ctx.peek();
        if (strTok.kind !== "STRING") {
          ctx.addError(`'command()' in actions block requires a string argument`, { line: strTok.line, col: strTok.col });
          while (!ctx.check("RPAREN") && !ctx.check("EOF"))
            ctx.advance();
          ctx.advance();
          continue;
        }
        ctx.advance();
        if (!ctx.expect("RPAREN"))
          break;
        actions.push({ kind: "command", value: strTok.value, loc: actionLoc });
      } else {
        ctx.addError(`Unknown action '${actionTok.value}'. Valid actions: display, prompt, command`, actionLoc);
        if (ctx.check("LPAREN")) {
          ctx.advance();
          while (!ctx.check("RPAREN") && !ctx.check("EOF"))
            ctx.advance();
          ctx.advance();
        }
      }
    }
    if (!ctx.expect("RBRACE"))
      return null;
    return { kind: "actions", actions, loc };
  }
  if (!ctx.expect("LPAREN"))
    return null;
  switch (nameTok.value) {
    case "terminal":
      if (!ctx.expect("RPAREN"))
        return null;
      return { kind: "terminal", loc };
    case "command": {
      const strTok = ctx.peek();
      if (strTok.kind !== "STRING") {
        ctx.addError(`'.command()' requires a string argument, e.g. .command("/collab.clarify")`, { line: strTok.line, col: strTok.col });
        return null;
      }
      ctx.advance();
      if (!ctx.expect("RPAREN"))
        return null;
      return { kind: "command", value: strTok.value, loc };
    }
    case "signals": {
      const signals = [];
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
        const sigTok = ctx.peek();
        if (sigTok.kind !== "IDENT") {
          ctx.addError(`Expected signal name in .signals() but found '${sigTok.value}'`, { line: sigTok.line, col: sigTok.col });
          break;
        }
        ctx.advance();
        signals.push(sigTok.value);
        if (ctx.check("COMMA"))
          ctx.advance();
      }
      if (!ctx.expect("RPAREN"))
        return null;
      return { kind: "signals", signals, loc };
    }
    case "on": {
      const sigTok = ctx.peek();
      if (sigTok.kind !== "IDENT") {
        ctx.addError(`Expected signal name in .on() but found '${sigTok.value || sigTok.kind}'`, { line: sigTok.line, col: sigTok.col });
        return null;
      }
      ctx.advance();
      const signalLoc = { line: sigTok.line, col: sigTok.col };
      if (ctx.check("RPAREN")) {
        ctx.advance();
        if (ctx.check("LBRACE")) {
          ctx.addError(`Block-form .on(${sigTok.value}) { when/otherwise } is not supported. ` + `Use .on(${sigTok.value}, when: cond, to: target) or .on(${sigTok.value}, otherwise, to: target)`, loc);
          let depth = 1;
          ctx.advance();
          while (!ctx.check("EOF") && depth > 0) {
            if (ctx.check("LBRACE"))
              depth++;
            else if (ctx.check("RBRACE"))
              depth--;
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
      ctx.advance();
      const firstParam = ctx.peek();
      if (firstParam.kind === "IDENT" && firstParam.value === "when") {
        ctx.advance();
        if (!ctx.expect("COLON"))
          return null;
        const condParts = [];
        while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF")) {
          const t = ctx.peek();
          if (t.kind !== "IDENT") {
            ctx.addError(`Expected identifier in condition expression but found '${t.value || t.kind}'`, { line: t.line, col: t.col });
            break;
          }
          condParts.push(t.value);
          ctx.advance();
        }
        if (condParts.length === 0) {
          ctx.addError(`'when:' requires a condition expression`, loc);
        }
        if (!ctx.expect("COMMA"))
          return null;
        const target2 = parseOnTarget(ctx);
        if (!target2)
          return null;
        return { kind: "on", signal: sigTok.value, signalLoc, target: target2, condition: condParts.join(" "), loc };
      }
      if (firstParam.kind === "IDENT" && firstParam.value === "otherwise") {
        ctx.advance();
        if (!ctx.expect("COMMA"))
          return null;
        const target2 = parseOnTarget(ctx);
        if (!target2)
          return null;
        return { kind: "on", signal: sigTok.value, signalLoc, target: target2, isOtherwise: true, loc };
      }
      if (firstParam.kind !== "IDENT" || firstParam.value !== "to" && firstParam.value !== "gate") {
        ctx.addError(`Expected 'to:', 'gate:', 'when: cond, to:', or 'otherwise, to:' in .on() but found '${firstParam.value}'`, { line: firstParam.line, col: firstParam.col });
        return null;
      }
      const target = parseOnTarget(ctx);
      if (!target)
        return null;
      return { kind: "on", signal: sigTok.value, signalLoc, target, loc };
    }
    case "goalGate": {
      if (!ctx.check("DOT")) {
        const t = ctx.peek();
        ctx.addError(`'.goalGate()' requires an enum argument: .always or .ifTriggered`, { line: t.line, col: t.col });
        return null;
      }
      ctx.advance();
      const valueTok = ctx.peek();
      if (valueTok.kind !== "IDENT") {
        ctx.addError(`Expected enum value after '.' in .goalGate()`, { line: valueTok.line, col: valueTok.col });
        return null;
      }
      ctx.advance();
      if (valueTok.value !== "always" && valueTok.value !== "ifTriggered") {
        ctx.addError(`Invalid GoalGate value '.${valueTok.value}'. Valid values: .always, .ifTriggered`, { line: valueTok.line, col: valueTok.col });
        return null;
      }
      if (!ctx.expect("RPAREN"))
        return null;
      return {
        kind: "goalGate",
        value: valueTok.value,
        loc
      };
    }
    case "model": {
      const nameTokM = ctx.peek();
      if (nameTokM.kind !== "IDENT" || !VALID_MODEL_NAMES.has(nameTokM.value)) {
        ctx.addError(`'.model()' requires a valid model name: haiku, sonnet, or opus`, { line: nameTokM.line, col: nameTokM.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        ctx.advance();
        return null;
      }
      ctx.advance();
      if (!ctx.expect("RPAREN"))
        return null;
      return {
        kind: "model",
        name: nameTokM.value,
        loc
      };
    }
    case "orchestratorContext": {
      if (!ctx.check("DOT")) {
        const t = ctx.peek();
        ctx.addError(`'.orchestratorContext()' requires .file() or .inline()`, { line: t.line, col: t.col });
        return null;
      }
      ctx.advance();
      const typeTok = ctx.peek();
      if (typeTok.kind !== "IDENT" || typeTok.value !== "file" && typeTok.value !== "inline") {
        ctx.addError(`Expected '.file()' or '.inline()' in .orchestratorContext() but found '.${typeTok.value}'`, { line: typeTok.line, col: typeTok.col });
        return null;
      }
      ctx.advance();
      if (!ctx.expect("LPAREN"))
        return null;
      const strTok = ctx.peek();
      if (strTok.kind !== "STRING") {
        ctx.addError(`'.${typeTok.value}()' requires a string argument`, { line: strTok.line, col: strTok.col });
        return null;
      }
      ctx.advance();
      if (!ctx.expect("RPAREN"))
        return null;
      if (!ctx.expect("RPAREN"))
        return null;
      const source = typeTok.value === "file" ? { kind: "file", path: strTok.value } : { kind: "inline", text: strTok.value };
      return { kind: "orchestratorContext", source, loc };
    }
    case "before":
    case "after": {
      const phaseTok = ctx.peek();
      if (phaseTok.kind !== "IDENT") {
        ctx.addError(`'.${nameTok.value}()' requires a phase name argument`, { line: phaseTok.line, col: phaseTok.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        ctx.advance();
        return null;
      }
      ctx.advance();
      const phaseLoc = { line: phaseTok.line, col: phaseTok.col };
      if (!ctx.expect("RPAREN"))
        return null;
      return {
        kind: nameTok.value,
        phase: phaseTok.value,
        phaseLoc,
        loc
      };
    }
    case "codeReview": {
      const t = ctx.peek();
      if (t.kind !== "IDENT" || t.value !== "off") {
        ctx.addError(`.codeReview() only supports .codeReview(off) from a phase. Use @codeReview() directive for full configuration.`, { line: t.line, col: t.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        if (ctx.check("RPAREN"))
          ctx.advance();
        return null;
      }
      ctx.advance();
      if (!ctx.expect("RPAREN"))
        return null;
      return { kind: "codeReview", enabled: false, loc };
    }
    default:
      while (!ctx.check("RPAREN") && !ctx.check("EOF"))
        ctx.advance();
      if (!ctx.expect("RPAREN"))
        return null;
      ctx.addError(`Unknown modifier '.${nameTok.value}()'`, loc);
      return null;
  }
}

// ../../src/gate-modifiers.ts
function parseGateDecl(ctx) {
  const kw = ctx.advance();
  const loc = { line: kw.line, col: kw.col };
  if (!ctx.expect("LPAREN"))
    return null;
  const nameTok = ctx.peek();
  if (nameTok.kind !== "IDENT") {
    ctx.addError(`Expected gate name identifier but found '${nameTok.value || nameTok.kind}'`, { line: nameTok.line, col: nameTok.col });
    return null;
  }
  ctx.advance();
  if (!ctx.expect("RPAREN"))
    return null;
  const modifiers = [];
  while (ctx.check("DOT")) {
    ctx.advance();
    const mNameTok = ctx.peek();
    if (mNameTok.kind !== "IDENT") {
      ctx.addError(`Expected gate modifier name after '.' but found '${mNameTok.value || mNameTok.kind}'`, { line: mNameTok.line, col: mNameTok.col });
      break;
    }
    ctx.advance();
    const mLoc = { line: mNameTok.line, col: mNameTok.col };
    if (mNameTok.value === "prompt") {
      if (!ctx.expect("LPAREN"))
        break;
      if (!ctx.check("DOT")) {
        const t = ctx.peek();
        ctx.addError(`'.prompt()' requires .file() or .inline()`, { line: t.line, col: t.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        if (ctx.check("RPAREN"))
          ctx.advance();
        continue;
      }
      ctx.advance();
      const typeTok = ctx.peek();
      if (typeTok.kind !== "IDENT" || typeTok.value !== "file" && typeTok.value !== "inline" && typeTok.value !== "ai") {
        ctx.addError(`Expected '.file()', '.inline()', or '.ai()' in .prompt() but found '.${typeTok.value}'`, { line: typeTok.line, col: typeTok.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        if (ctx.check("RPAREN"))
          ctx.advance();
        continue;
      }
      ctx.advance();
      if (!ctx.expect("LPAREN"))
        break;
      const strTok = ctx.peek();
      if (strTok.kind !== "STRING") {
        ctx.addError(`'.${typeTok.value}()' requires a string argument`, { line: strTok.line, col: strTok.col });
        return null;
      }
      ctx.advance();
      if (!ctx.expect("RPAREN"))
        break;
      if (!ctx.expect("RPAREN"))
        break;
      const source = typeTok.value === "file" ? { kind: "file", path: strTok.value } : typeTok.value === "ai" ? { kind: "ai", expr: strTok.value } : { kind: "inline", text: strTok.value };
      modifiers.push({ kind: "prompt", source, loc: mLoc });
    } else if (mNameTok.value === "skipTo") {
      if (!ctx.expect("LPAREN"))
        break;
      const phaseTok = ctx.peek();
      if (phaseTok.kind !== "IDENT") {
        ctx.addError(`'.skipTo()' requires a phase name but found '${phaseTok.value || phaseTok.kind}'`, { line: phaseTok.line, col: phaseTok.col });
        return null;
      }
      ctx.advance();
      if (!ctx.expect("RPAREN"))
        break;
      modifiers.push({
        kind: "skipTo",
        phase: phaseTok.value,
        phaseLoc: { line: phaseTok.line, col: phaseTok.col },
        loc: mLoc
      });
    } else if (mNameTok.value === "on") {
      if (!ctx.expect("LPAREN"))
        break;
      const sigTok = ctx.peek();
      if (sigTok.kind !== "IDENT") {
        ctx.addError(`Expected signal name in gate .on() but found '${sigTok.value || sigTok.kind}'`, { line: sigTok.line, col: sigTok.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        if (ctx.check("RPAREN"))
          ctx.advance();
        continue;
      }
      ctx.advance();
      const gSignalLoc = { line: sigTok.line, col: sigTok.col };
      if (!ctx.check("COMMA")) {
        const t = ctx.peek();
        ctx.addError(`Expected ',' after signal name in gate .on()`, { line: t.line, col: t.col });
        while (!ctx.check("RPAREN") && !ctx.check("EOF"))
          ctx.advance();
        if (ctx.check("RPAREN"))
          ctx.advance();
        continue;
      }
      ctx.advance();
      let gTarget;
      let feedback;
      let maxRetries;
      let onExhaust;
      while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
        const paramTok = ctx.peek();
        if (paramTok.kind !== "IDENT")
          break;
        ctx.advance();
        if (!ctx.expect("COLON"))
          break;
        if (paramTok.value === "to") {
          const gTargetTok = ctx.peek();
          if (gTargetTok.kind !== "IDENT") {
            ctx.addError(`Expected phase name after 'to:' in gate .on() but found '${gTargetTok.value || gTargetTok.kind}'`, { line: gTargetTok.line, col: gTargetTok.col });
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF"))
              ctx.advance();
            continue;
          }
          ctx.advance();
          gTarget = { kind: "to", phase: gTargetTok.value, phaseLoc: { line: gTargetTok.line, col: gTargetTok.col } };
        } else if (paramTok.value === "feedback") {
          if (!ctx.check("DOT")) {
            const t = ctx.peek();
            ctx.addError(`'feedback:' requires a dot-enum value: .enrich or .raw`, { line: t.line, col: t.col });
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF"))
              ctx.advance();
            continue;
          }
          ctx.advance();
          const enumTok = ctx.peek();
          if (enumTok.kind !== "IDENT" || enumTok.value !== "enrich" && enumTok.value !== "raw") {
            ctx.addError(`Invalid Feedback value '.${enumTok.value}'. Valid values: .enrich, .raw`, { line: enumTok.line, col: enumTok.col });
            ctx.advance();
            continue;
          }
          ctx.advance();
          feedback = enumTok.value;
        } else if (paramTok.value === "maxRetries") {
          const numTok = ctx.peek();
          if (numTok.kind !== "NUMBER") {
            ctx.addError(`'maxRetries:' requires an integer value but found '${numTok.value || numTok.kind}'`, { line: numTok.line, col: numTok.col });
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF"))
              ctx.advance();
            continue;
          }
          ctx.advance();
          maxRetries = parseInt(numTok.value, 10);
        } else if (paramTok.value === "onExhaust") {
          if (!ctx.check("DOT")) {
            const t = ctx.peek();
            ctx.addError(`'onExhaust:' requires a dot-enum value: .escalate, .skip, or .abort`, { line: t.line, col: t.col });
            while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF"))
              ctx.advance();
            continue;
          }
          ctx.advance();
          const enumTok = ctx.peek();
          const validExhaust = new Set(["escalate", "skip", "abort"]);
          if (enumTok.kind !== "IDENT" || !validExhaust.has(enumTok.value)) {
            ctx.addError(`Invalid Exhaust value '.${enumTok.value}'. Valid values: .escalate, .skip, .abort`, { line: enumTok.line, col: enumTok.col });
            ctx.advance();
            continue;
          }
          ctx.advance();
          onExhaust = enumTok.value;
        } else {
          ctx.addError(`Unknown gate .on() parameter '${paramTok.value}'. Valid: to, feedback, maxRetries, onExhaust`, { line: paramTok.line, col: paramTok.col });
          while (!ctx.check("RPAREN") && !ctx.check("COMMA") && !ctx.check("EOF"))
            ctx.advance();
        }
        if (ctx.check("COMMA"))
          ctx.advance();
      }
      if (!ctx.expect("RPAREN"))
        break;
      const gMod = {
        kind: "on",
        signal: sigTok.value,
        signalLoc: gSignalLoc,
        loc: mLoc
      };
      if (gTarget !== undefined)
        gMod.target = gTarget;
      if (feedback !== undefined)
        gMod.feedback = feedback;
      if (maxRetries !== undefined)
        gMod.maxRetries = maxRetries;
      if (onExhaust !== undefined)
        gMod.onExhaust = onExhaust;
      modifiers.push(gMod);
    } else {
      ctx.addError(`Unknown gate modifier '.${mNameTok.value}()'. Valid: prompt, skipTo, on`, mLoc);
      if (!ctx.expect("LPAREN"))
        break;
      while (!ctx.check("RPAREN") && !ctx.check("EOF"))
        ctx.advance();
      if (ctx.check("RPAREN"))
        ctx.advance();
    }
  }
  return { name: nameTok.value, loc, nameLoc: { line: nameTok.line, col: nameTok.col }, modifiers };
}

// ../../src/parser.ts
var VALID_MODEL_NAMES2 = new Set(["haiku", "sonnet", "opus"]);
function parse(source) {
  const { tokens, errors: lexErrors } = tokenize(source);
  const parseErrors = [
    ...lexErrors.map((e) => ({ message: e.message, loc: { line: e.line, col: e.col } }))
  ];
  const ctx = createParserContext(tokens, parseErrors);
  function parsePhaseDecl() {
    const kw = ctx.advance();
    const loc = { line: kw.line, col: kw.col };
    if (!ctx.expect("LPAREN"))
      return null;
    const nameTok = ctx.peek();
    if (nameTok.kind !== "IDENT") {
      ctx.addError(`Expected phase name identifier but found '${nameTok.value || nameTok.kind}'`, { line: nameTok.line, col: nameTok.col });
      return null;
    }
    ctx.advance();
    if (!ctx.expect("RPAREN"))
      return null;
    const modifiers = [];
    while (ctx.check("DOT")) {
      const mod = parsePhaseModifier(ctx);
      if (mod)
        modifiers.push(mod);
      else
        break;
    }
    return { name: nameTok.value, loc, nameLoc: { line: nameTok.line, col: nameTok.col }, modifiers };
  }
  const phases = [];
  const gates = [];
  let defaultModel;
  let codeReview;
  while (!ctx.check("EOF")) {
    const tok = ctx.peek();
    if (tok.kind === "AT") {
      ctx.advance();
      const dirTok = ctx.peek();
      if (dirTok.kind !== "IDENT") {
        ctx.addError(`Expected directive name after '@' but found '${dirTok.value || dirTok.kind}'`, { line: dirTok.line, col: dirTok.col });
        while (!ctx.check("EOF") && ctx.peek().kind !== "IDENT")
          ctx.advance();
        continue;
      }
      if (dirTok.value === "defaultModel") {
        ctx.advance();
        if (!ctx.expect("LPAREN"))
          continue;
        const modelTok = ctx.peek();
        if (modelTok.kind !== "IDENT" || !VALID_MODEL_NAMES2.has(modelTok.value)) {
          ctx.addError(`'@defaultModel()' requires a valid model name: haiku, sonnet, or opus`, { line: modelTok.line, col: modelTok.col });
          while (!ctx.check("RPAREN") && !ctx.check("EOF"))
            ctx.advance();
          if (ctx.check("RPAREN"))
            ctx.advance();
          continue;
        }
        ctx.advance();
        if (!ctx.expect("RPAREN"))
          continue;
        defaultModel = modelTok.value;
        continue;
      }
      if (dirTok.value === "codeReview") {
        ctx.advance();
        if (!ctx.expect("LPAREN"))
          continue;
        let enabled = true;
        let crModel;
        let crFile;
        let crMaxAttempts;
        if (ctx.check("RPAREN")) {
          ctx.advance();
        } else {
          const firstTok = ctx.peek();
          if (firstTok.kind === "IDENT" && firstTok.value === "off") {
            ctx.advance();
            if (!ctx.expect("RPAREN"))
              continue;
            enabled = false;
          } else {
            let first = true;
            while (!ctx.check("RPAREN") && !ctx.check("EOF")) {
              if (!first) {
                if (!ctx.check("COMMA")) {
                  ctx.addError(`Expected ',' or ')' in @codeReview()`, { line: ctx.peek().line, col: ctx.peek().col });
                  break;
                }
                ctx.advance();
                if (ctx.check("RPAREN"))
                  break;
              }
              first = false;
              const pt = ctx.peek();
              if (pt.kind === "DOT") {
                ctx.advance();
                const ftok = ctx.peek();
                if (ftok.kind !== "IDENT" || ftok.value !== "file") {
                  ctx.addError(`Expected '.file("path")' in @codeReview() but found '.${ftok.value || ftok.kind}'`, { line: ftok.line, col: ftok.col });
                  while (!ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                  break;
                }
                ctx.advance();
                if (!ctx.expect("LPAREN")) {
                  while (!ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                  break;
                }
                const strTok = ctx.peek();
                if (strTok.kind !== "STRING") {
                  ctx.addError(`'.file()' requires a string path in @codeReview()`, { line: strTok.line, col: strTok.col });
                  while (!ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                  break;
                }
                crFile = strTok.value;
                ctx.advance();
                if (!ctx.expect("RPAREN")) {
                  while (!ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                  break;
                }
              } else if (pt.kind === "IDENT" && pt.value === "model") {
                ctx.advance();
                if (!ctx.expect("COLON")) {
                  while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                  continue;
                }
                const modelTok = ctx.peek();
                if (modelTok.kind !== "IDENT" || !VALID_MODEL_NAMES2.has(modelTok.value)) {
                  ctx.addError(`'model:' in @codeReview() requires a valid model name: haiku, sonnet, or opus`, { line: modelTok.line, col: modelTok.col });
                  while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                } else {
                  crModel = modelTok.value;
                  ctx.advance();
                }
              } else if (pt.kind === "IDENT" && pt.value === "maxAttempts") {
                ctx.advance();
                if (!ctx.expect("COLON")) {
                  while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                  continue;
                }
                const numTok = ctx.peek();
                if (numTok.kind !== "NUMBER") {
                  ctx.addError(`'maxAttempts:' in @codeReview() requires a positive integer`, { line: numTok.line, col: numTok.col });
                  while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF"))
                    ctx.advance();
                } else {
                  crMaxAttempts = parseInt(numTok.value, 10);
                  ctx.advance();
                }
              } else {
                ctx.addError(`Unknown parameter '${pt.value || pt.kind}' in @codeReview(). Valid: off, model:, .file(), maxAttempts:`, { line: pt.line, col: pt.col });
                while (!ctx.check("COMMA") && !ctx.check("RPAREN") && !ctx.check("EOF"))
                  ctx.advance();
              }
            }
            if (!ctx.expect("RPAREN"))
              continue;
          }
        }
        codeReview = {
          enabled,
          ...crModel !== undefined ? { model: crModel } : {},
          ...crFile !== undefined ? { file: crFile } : {},
          ...crMaxAttempts !== undefined ? { maxAttempts: crMaxAttempts } : {}
        };
        continue;
      }
      ctx.addError(`Unknown directive '@${dirTok.value}'. Valid directives: @defaultModel, @codeReview`, { line: dirTok.line, col: dirTok.col });
      while (!ctx.check("EOF") && ctx.peek().kind !== "IDENT")
        ctx.advance();
      continue;
    }
    if (tok.kind === "IDENT" && tok.value === "phase") {
      const decl = parsePhaseDecl();
      if (decl)
        phases.push(decl);
    } else if (tok.kind === "IDENT" && tok.value === "gate") {
      const decl = parseGateDecl(ctx);
      if (decl)
        gates.push(decl);
    } else {
      ctx.addError(`Unexpected token '${tok.value}' — expected 'phase' or 'gate' declaration`, { line: tok.line, col: tok.col });
      ctx.advance();
    }
  }
  if (parseErrors.length > 0) {
    return { errors: parseErrors };
  }
  return {
    ast: {
      phases,
      gates,
      ...defaultModel !== undefined ? { defaultModel } : {},
      ...codeReview !== undefined ? { codeReview } : {}
    },
    errors: []
  };
}

// ../../src/types.ts
var BUILTIN_TOKENS = new Set([
  "TICKET_ID",
  "TICKET_TITLE",
  "PHASE",
  "INCOMING_SIGNAL",
  "INCOMING_DETAIL"
]);
var KNOWN_CONDITIONS = new Set([
  "hasGroup",
  "isBackend",
  "isFrontend",
  "hasTests",
  "isUrgent"
]);

// ../../src/validator.ts
var VALID_MODEL_NAMES3 = new Set(["haiku", "sonnet", "opus"]);
var TOKEN_RE = /\$\{([A-Z][A-Z0-9_]*)\}/g;
function validateTokensInString(text, loc, errors) {
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const name = m[1];
    if (!BUILTIN_TOKENS.has(name)) {
      errors.push({
        message: `'${name}' is not a built-in token variable. Built-in variables: ${[...BUILTIN_TOKENS].join(", ")}. Use ai("...") for runtime expressions.`,
        loc
      });
    }
  }
}
function validateDisplayValue(dv, loc, errors) {
  if (dv.kind === "inline") {
    validateTokensInString(dv.text, loc, errors);
  }
}
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1;i <= m; i++) {
    for (let j = 1;j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function didYouMean(name, candidates) {
  const threshold = Math.max(2, Math.floor(name.length / 3));
  let best;
  for (const c of candidates) {
    const dist = editDistance(name.toLowerCase(), c.toLowerCase());
    if (dist <= threshold && (!best || dist < best.dist)) {
      best = { name: c, dist };
    }
  }
  return best?.name;
}
function detectCycles(phases, edges, errors) {
  const phaseLocMap = new Map(phases.map((p) => [p.name, p.loc]));
  const color = new Map;
  for (const p of phases)
    color.set(p.name, 0);
  const path = [];
  const reported = new Set;
  function dfs(node) {
    color.set(node, 1);
    path.push(node);
    for (const neighbor of edges.get(node) ?? []) {
      if (neighbor === node)
        continue;
      if (color.get(neighbor) === 1) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = [...path.slice(cycleStart), neighbor];
        const minIdx = cycle.indexOf([...cycle].sort()[0]);
        const canonical = [...cycle.slice(minIdx), ...cycle.slice(1, minIdx + 1)].join(" → ");
        if (!reported.has(canonical)) {
          reported.add(canonical);
          errors.push({
            message: `Cycle detected: ${cycle.join(" → ")}`,
            loc: phaseLocMap.get(node) ?? { line: 1, col: 1 },
            severity: "warning"
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
    if (color.get(p.name) === 0)
      dfs(p.name);
  }
}
function validate(ast) {
  const errors = [];
  if (ast.codeReview) {
    const cr = ast.codeReview;
    const directiveLoc = { line: 1, col: 1 };
    if (cr.model !== undefined && !VALID_MODEL_NAMES3.has(cr.model)) {
      errors.push({
        message: `Invalid model '${cr.model}' in @codeReview(). Valid models: haiku, sonnet, opus`,
        loc: directiveLoc
      });
    }
    if (cr.maxAttempts !== undefined && (cr.maxAttempts <= 0 || !Number.isInteger(cr.maxAttempts))) {
      errors.push({
        message: `'maxAttempts' in @codeReview() must be a positive integer (got ${cr.maxAttempts})`,
        loc: directiveLoc
      });
    }
  }
  const phaseNames = new Set;
  for (const phase of ast.phases) {
    if (phaseNames.has(phase.name)) {
      errors.push({
        message: `Duplicate phase name '${phase.name}'`,
        loc: phase.loc
      });
    }
    phaseNames.add(phase.name);
  }
  const gateNames = new Set;
  for (const gate of ast.gates) {
    if (gateNames.has(gate.name)) {
      errors.push({
        message: `Duplicate gate name '${gate.name}'`,
        loc: gate.loc
      });
    }
    gateNames.add(gate.name);
  }
  for (const gate of ast.gates) {
    const hasSkipTo = gate.modifiers.some((m) => m.kind === "skipTo");
    for (const mod of gate.modifiers) {
      if (mod.kind === "on" && mod.onExhaust === "skip" && !hasSkipTo) {
        errors.push({
          message: `skipTo is required on gate '${gate.name}' because a response uses onExhaust: .skip`,
          loc: mod.loc
        });
      }
      if (mod.kind === "on" && mod.target !== undefined && !phaseNames.has(mod.target.phase)) {
        const suggestion = didYouMean(mod.target.phase, phaseNames);
        errors.push({
          message: `Phase '${mod.target.phase}' not declared` + (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.target.phaseLoc
        });
      }
      if (mod.kind === "skipTo" && !phaseNames.has(mod.phase)) {
        const suggestion = didYouMean(mod.phase, phaseNames);
        errors.push({
          message: `Phase '${mod.phase}' not declared (in skipTo)` + (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.phaseLoc
        });
      }
      if (mod.kind === "prompt" && mod.source.kind === "ai") {
        errors.push({
          message: `Gate '${gate.name}' uses ai() in .prompt() — gate prompts should be static review criteria. Use .file() for maintainable, auditable prompts.`,
          loc: mod.loc,
          severity: "warning"
        });
      }
      if (mod.kind === "on" && mod.target === undefined && mod.onExhaust === undefined) {
        errors.push({
          message: `Gate '${gate.name}' response for '${mod.signal}' has no 'to:' target and no 'onExhaust:' — this creates a dead-end at runtime`,
          loc: mod.loc
        });
      }
    }
  }
  const phasesWithCommand = new Set;
  for (const phase of ast.phases) {
    for (const mod of phase.modifiers) {
      if (mod.kind === "command") {
        phasesWithCommand.add(phase.name);
      }
      if (mod.kind === "actions" && mod.actions.some((a) => a.kind === "command")) {
        phasesWithCommand.add(phase.name);
      }
    }
  }
  for (const phase of ast.phases) {
    const isTerminal = phase.modifiers.some((m) => m.kind === "terminal");
    const declaredSignals = new Set;
    for (const mod of phase.modifiers) {
      if (mod.kind === "signals") {
        for (const sig of mod.signals)
          declaredSignals.add(sig);
      }
    }
    for (const mod of phase.modifiers) {
      if (mod.kind !== "actions")
        continue;
      let commandCount = 0;
      for (const action of mod.actions) {
        if (action.kind === "command") {
          commandCount++;
          if (commandCount > 1) {
            errors.push({
              message: `Only one command() allowed per actions block. Split into a separate phase.`,
              loc: action.loc
            });
          }
        } else if (action.kind === "display" || action.kind === "prompt") {
          validateDisplayValue(action.value, action.loc, errors);
        }
      }
    }
    for (const mod of phase.modifiers) {
      if (mod.kind !== "on")
        continue;
      if (isTerminal) {
        errors.push({
          message: `Terminal phases cannot have outbound transitions`,
          loc: mod.loc
        });
        continue;
      }
      if (!declaredSignals.has(mod.signal)) {
        const suggestion = didYouMean(mod.signal, declaredSignals);
        errors.push({
          message: `Signal '${mod.signal}' not declared for phase '${phase.name}'` + (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.signalLoc
        });
      }
      if (mod.target.kind === "to") {
        if (!phaseNames.has(mod.target.phase)) {
          const suggestion = didYouMean(mod.target.phase, phaseNames);
          errors.push({
            message: `Phase '${mod.target.phase}' not declared` + (suggestion ? `. Did you mean '${suggestion}'?` : ""),
            loc: mod.target.phaseLoc
          });
        }
      } else if (mod.target.kind === "gate") {
        if (!gateNames.has(mod.target.gate)) {
          const suggestion = didYouMean(mod.target.gate, gateNames);
          errors.push({
            message: `Gate '${mod.target.gate}' not declared` + (suggestion ? `. Did you mean '${suggestion}'?` : ""),
            loc: mod.target.gateLoc
          });
        }
      }
      if (mod.condition !== undefined) {
        const condIds = mod.condition.split(/\s+/).filter((t) => t !== "and" && t !== "or" && t !== "not" && t !== "");
        for (const condId of condIds) {
          if (!KNOWN_CONDITIONS.has(condId)) {
            errors.push({
              message: `Unknown condition '${condId}' — will be AI-evaluated at runtime`,
              loc: mod.loc,
              severity: "warning"
            });
          }
        }
      }
    }
    const conditionalSignals = new Map;
    for (const mod of phase.modifiers) {
      if (mod.kind !== "on")
        continue;
      if (mod.condition !== undefined || mod.isOtherwise) {
        if (!conditionalSignals.has(mod.signal)) {
          conditionalSignals.set(mod.signal, { hasOtherwise: false, firstLoc: mod.loc });
        }
        if (mod.isOtherwise) {
          conditionalSignals.get(mod.signal).hasOtherwise = true;
        }
      }
    }
    for (const [, entry] of conditionalSignals) {
      if (!entry.hasOtherwise) {
        errors.push({
          message: `Conditional transition requires an 'otherwise' branch`,
          loc: entry.firstLoc
        });
      }
    }
  }
  for (const phase of ast.phases) {
    const isTerminal = phase.modifiers.some((m) => m.kind === "terminal");
    for (const mod of phase.modifiers) {
      if (mod.kind === "codeReview" && isTerminal) {
        errors.push({
          message: `Terminal phases cannot have a .codeReview() modifier`,
          loc: mod.loc
        });
      }
    }
  }
  for (const phase of ast.phases) {
    for (const mod of phase.modifiers) {
      if (mod.kind !== "before" && mod.kind !== "after")
        continue;
      if (!phaseNames.has(mod.phase)) {
        const suggestion = didYouMean(mod.phase, phaseNames);
        errors.push({
          message: `Phase '${mod.phase}' not declared (in .${mod.kind}())` + (suggestion ? `. Did you mean '${suggestion}'?` : ""),
          loc: mod.phaseLoc
        });
        continue;
      }
      if (!phasesWithCommand.has(mod.phase)) {
        errors.push({
          message: `Phase '${mod.phase}' has no .command() or .actions{} block — hook phases must be dispatchable`,
          loc: mod.phaseLoc
        });
      }
    }
  }
  const cycleEdges = new Map;
  for (const p of ast.phases)
    cycleEdges.set(p.name, []);
  for (const phase of ast.phases) {
    for (const mod of phase.modifiers) {
      if (mod.kind === "on" && mod.target.kind === "to") {
        cycleEdges.get(phase.name).push(mod.target.phase);
      }
    }
  }
  detectCycles(ast.phases, cycleEdges, errors);
  const hookEdges = new Map;
  for (const p of ast.phases)
    hookEdges.set(p.name, []);
  for (const phase of ast.phases) {
    for (const mod of phase.modifiers) {
      if (mod.kind === "before" && phaseNames.has(mod.phase)) {
        hookEdges.get(phase.name).push(mod.phase);
      }
      if (mod.kind === "after" && phaseNames.has(mod.phase)) {
        const existing = hookEdges.get(mod.phase);
        if (existing)
          existing.push(phase.name);
      }
    }
  }
  detectCycles(ast.phases, hookEdges, errors);
  return errors;
}

// ../../src/lsp/protocol.ts
var DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4
};
var CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25
};

// ../../src/lsp/diagnostics.ts
var SOURCE = "pipelang";
function getDiagnostics(text) {
  const { errors: parseErrors, ast } = parse(text);
  const diagnostics = parseErrors.map((e) => parseErrorToDiagnostic(e));
  if (ast) {
    const compileErrors = validate(ast);
    for (const e of compileErrors) {
      diagnostics.push(compileErrorToDiagnostic(e));
    }
  }
  return diagnostics;
}
function parseErrorToDiagnostic(e) {
  const line = e.loc.line - 1;
  const col = e.loc.col - 1;
  return {
    range: {
      start: { line, character: col },
      end: { line, character: col }
    },
    severity: DiagnosticSeverity.Error,
    message: e.message,
    source: SOURCE
  };
}
function compileErrorToDiagnostic(e) {
  const line = e.loc.line - 1;
  const col = e.loc.col - 1;
  return {
    range: {
      start: { line, character: col },
      end: { line, character: col }
    },
    severity: e.severity === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    message: e.message,
    source: SOURCE
  };
}

// ../../src/lsp/symbols.ts
function locToRange(loc, nameLength) {
  const line = loc.line - 1;
  const col = loc.col - 1;
  return {
    start: { line, character: col },
    end: { line, character: col + nameLength }
  };
}
function buildSymbolTable(ast) {
  const declarations = [];
  const references = [];
  for (const phase of ast.phases) {
    declarations.push({
      name: phase.name,
      kind: "phase",
      nameLoc: phase.nameLoc
    });
    for (const mod of phase.modifiers) {
      if (mod.kind === "signals") {
        for (let i = 0;i < mod.signals.length; i++) {
          declarations.push({
            name: mod.signals[i],
            kind: "signal",
            nameLoc: mod.loc
          });
        }
      } else if (mod.kind === "on") {
        references.push({ name: mod.signal, kind: "signal", loc: mod.signalLoc });
        if (mod.target.kind === "to") {
          references.push({ name: mod.target.phase, kind: "phase", loc: mod.target.phaseLoc });
        } else {
          references.push({ name: mod.target.gate, kind: "gate", loc: mod.target.gateLoc });
        }
      }
    }
  }
  for (const gate of ast.gates) {
    declarations.push({
      name: gate.name,
      kind: "gate",
      nameLoc: gate.nameLoc
    });
    for (const mod of gate.modifiers) {
      if (mod.kind === "skipTo") {
        references.push({ name: mod.phase, kind: "phase", loc: mod.phaseLoc });
      } else if (mod.kind === "on") {
        references.push({ name: mod.signal, kind: "signal", loc: mod.signalLoc });
        if (mod.target) {
          references.push({ name: mod.target.phase, kind: "phase", loc: mod.target.phaseLoc });
        }
      }
    }
  }
  return { declarations, references };
}
function findDeclaration(table, name, kind) {
  return table.declarations.find((d) => d.name === name && (kind === undefined || d.kind === kind));
}
function findAllLocations(table, name, kind) {
  const locs = [];
  const decl = table.declarations.find((d) => d.name === name && d.kind === kind);
  if (decl)
    locs.push(decl.nameLoc);
  for (const ref of table.references) {
    if (ref.name === name && ref.kind === kind) {
      locs.push(ref.loc);
    }
  }
  return locs;
}

// ../../src/lsp/definition.ts
function wordAtPosition(text, pos) {
  const lines = text.split(`
`);
  const line = lines[pos.line];
  if (!line)
    return null;
  const ch = pos.character;
  if (ch >= line.length || !/[a-zA-Z0-9_]/.test(line[ch]))
    return null;
  let start = ch;
  let end = ch;
  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1]))
    start--;
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end]))
    end++;
  const word = line.slice(start, end);
  return word.length > 0 ? word : null;
}
function getDefinition(text, documentUri, pos) {
  const word = wordAtPosition(text, pos);
  if (!word)
    return null;
  const { ast } = parse(text);
  if (!ast)
    return null;
  const table = buildSymbolTable(ast);
  const decl = findDeclaration(table, word, "phase") ?? findDeclaration(table, word, "gate");
  if (!decl)
    return null;
  return {
    uri: documentUri,
    range: locToRange(decl.nameLoc, word.length)
  };
}

// ../../src/lsp/definition.ts
function wordAtPosition2(text, pos) {
  const lines = text.split(`
`);
  const line = lines[pos.line];
  if (!line)
    return null;
  const ch = pos.character;
  if (ch >= line.length || !/[a-zA-Z0-9_]/.test(line[ch]))
    return null;
  let start = ch;
  let end = ch;
  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1]))
    start--;
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end]))
    end++;
  const word = line.slice(start, end);
  return word.length > 0 ? word : null;
}

// ../../src/lsp/rename.ts
function prepareRename(text, pos) {
  const word = wordAtPosition2(text, pos);
  if (!word)
    return null;
  const { ast } = parse(text);
  if (!ast)
    return null;
  const table = buildSymbolTable(ast);
  if (findDeclaration(table, word, "phase"))
    return { word, kind: "phase" };
  if (findDeclaration(table, word, "gate"))
    return { word, kind: "gate" };
  return null;
}
function getRename(text, documentUri, pos, newName) {
  const info = prepareRename(text, pos);
  if (!info)
    return null;
  const { ast } = parse(text);
  if (!ast)
    return null;
  const table = buildSymbolTable(ast);
  const locs = findAllLocations(table, info.word, info.kind);
  const edits = locs.map((loc) => ({
    range: locToRange(loc, info.word.length),
    newText: newName
  }));
  if (edits.length === 0)
    return null;
  return { changes: { [documentUri]: edits } };
}

// ../../src/lsp/completion.ts
var PHASE_MODIFIERS = [
  "command",
  "signals",
  "on",
  "terminal",
  "model",
  "goalGate",
  "orchestratorContext",
  "actions",
  "before",
  "after",
  "codeReview"
].map((label) => ({ label, kind: CompletionItemKind.Method, detail: "Phase modifier" }));
var GATE_MODIFIERS = [
  "prompt",
  "skipTo",
  "on"
].map((label) => ({ label, kind: CompletionItemKind.Method, detail: "Gate modifier" }));
var MODEL_VALUES = ["haiku", "sonnet", "opus"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
  detail: "Model name"
}));
var GOAL_GATE_VALUES = ["always", "ifTriggered"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
  detail: "GoalGate value"
}));
var ON_NAMED_ARGS = [
  { label: "when", kind: CompletionItemKind.Keyword, detail: "Conditional branch (when: cond, to: target)" },
  { label: "otherwise", kind: CompletionItemKind.Keyword, detail: "Otherwise branch (otherwise, to: target)" },
  { label: "to", kind: CompletionItemKind.Keyword, detail: "Phase target" },
  { label: "gate", kind: CompletionItemKind.Keyword, detail: "Gate target" }
];
var FEEDBACK_VALUES = ["enrich", "raw"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember
}));
var EXHAUST_VALUES = ["escalate", "skip", "abort"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember
}));
var CONTEXT_SOURCE_VALUES = ["file", "inline"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember
}));
var CODE_REVIEW_PARAMS = [
  { label: "off", kind: CompletionItemKind.Keyword, detail: "Disable codeReview globally" },
  { label: "model", kind: CompletionItemKind.Keyword, detail: "Review agent model (model: opus)" },
  { label: "maxAttempts", kind: CompletionItemKind.Keyword, detail: "Max review cycles before escalation" },
  { label: ".file", kind: CompletionItemKind.Keyword, detail: "Architecture doc for the reviewer" }
];
var TOP_LEVEL_KEYWORDS = [
  { label: "phase", kind: CompletionItemKind.Keyword, insertText: "phase(${1:name})\n    " },
  { label: "gate", kind: CompletionItemKind.Keyword, insertText: "gate(${1:name})\n    " },
  { label: "@defaultModel", kind: CompletionItemKind.Keyword, insertText: "@defaultModel(${1:sonnet})" },
  { label: "@codeReview", kind: CompletionItemKind.Keyword, insertText: "@codeReview()" }
];
function prefixAt(text, pos) {
  const lines = text.split(`
`);
  const line = lines[pos.line] ?? "";
  return line.slice(0, pos.character);
}
function phaseNames(text) {
  return [...text.matchAll(/^phase\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gm)].map((m) => ({
    label: m[1],
    kind: CompletionItemKind.Function,
    detail: "Phase"
  }));
}
function gateNames(text) {
  return [...text.matchAll(/^gate\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gm)].map((m) => ({
    label: m[1],
    kind: CompletionItemKind.Interface,
    detail: "Gate"
  }));
}
function signalNames(text) {
  const seen = new Set;
  const items = [];
  for (const m of text.matchAll(/\.signals\s*\(([^)]*)\)/gm)) {
    for (const sig of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!seen.has(sig)) {
        seen.add(sig);
        items.push({ label: sig, kind: CompletionItemKind.Event, detail: "Signal" });
      }
    }
  }
  return items;
}
function getCompletions(text, pos) {
  const prefix = prefixAt(text, pos);
  const trimmed = prefix.trimStart();
  if (/\.goalGate\s*\(\s*\.\s*\w*$/.test(prefix)) {
    return GOAL_GATE_VALUES;
  }
  if (/\bfeedback\s*:\s*\.\s*\w*$/.test(prefix)) {
    return FEEDBACK_VALUES;
  }
  if (/\bonExhaust\s*:\s*\.\s*\w*$/.test(prefix)) {
    return EXHAUST_VALUES;
  }
  if (/\.(orchestratorContext|prompt)\s*\(\s*\.\s*\w*$/.test(prefix)) {
    return CONTEXT_SOURCE_VALUES;
  }
  if (/\.\w*$/.test(prefix)) {
    const allLines = text.split(`
`).slice(0, pos.line + 1).join(`
`);
    const inGate = /\bgate\s*\([^)]+\)[^{]*$/.test(allLines.replace(/\/\/[^\n]*/g, "").replace(/#[^\n]*/g, ""));
    return inGate ? GATE_MODIFIERS : PHASE_MODIFIERS;
  }
  if (/@codeReview\s*\([^)]*$/.test(prefix)) {
    if (/\bmodel\s*:\s*\w*$/.test(prefix)) {
      return MODEL_VALUES;
    }
    return CODE_REVIEW_PARAMS;
  }
  if (/\.codeReview\s*\(\s*\w*$/.test(prefix)) {
    return [{ label: "off", kind: CompletionItemKind.Keyword, detail: "Disable codeReview for this phase" }];
  }
  if (/\bto\s*:\s*\w*$/.test(prefix)) {
    return phaseNames(text);
  }
  if (/\bgate\s*:\s*\w*$/.test(prefix) || /to\s*=\s*gate\s*\(\s*\w*$/.test(prefix)) {
    return gateNames(text);
  }
  if (/\.(model|defaultModel)\s*\(\s*\w*$/.test(prefix) || /@defaultModel\s*\(\s*\w*$/.test(prefix)) {
    return MODEL_VALUES;
  }
  if (/\.(before|after)\s*\(\s*\w*$/.test(prefix)) {
    return phaseNames(text);
  }
  if (/\bwhen\s*:\s*\w*$/.test(prefix)) {
    return [...KNOWN_CONDITIONS].map((c) => ({
      label: c,
      kind: CompletionItemKind.EnumMember,
      detail: "Known condition"
    }));
  }
  if (/\.on\s*\([A-Z_][A-Z0-9_]*\s*,\s*\w*$/.test(prefix)) {
    return ON_NAMED_ARGS;
  }
  if (/\.on\s*\(\s*\w*$/.test(prefix)) {
    return signalNames(text);
  }
  if (/\.signals\s*\([^)]*$/.test(prefix)) {
    return signalNames(text);
  }
  if (/^\s*$/.test(trimmed) || /^[a-zA-Z@]/.test(trimmed)) {
    return TOP_LEVEL_KEYWORDS;
  }
  return [];
}

// ../../src/lsp/server.ts
var documents = new Map;
var transport = new LspTransport(process.stdin, process.stdout, handleMessage);
function respond(id, result) {
  transport.send({ jsonrpc: "2.0", id, result });
}
function respondError(id, code, message) {
  transport.send({ jsonrpc: "2.0", id, error: { code, message } });
}
function notify(method, params) {
  transport.send({ jsonrpc: "2.0", method, params });
}
function publishDiagnostics(uri, text) {
  const diagnostics = getDiagnostics(text);
  notify("textDocument/publishDiagnostics", { uri, diagnostics });
}
function handleMessage(msg) {
  if ("method" in msg) {
    if ("id" in msg) {
      handleRequest(msg);
    } else {
      handleNotification(msg);
    }
  }
}
function handleRequest(req) {
  const { id, method, params } = req;
  const p = params;
  try {
    switch (method) {
      case "initialize":
        respond(id, {
          capabilities: {
            textDocumentSync: 1,
            definitionProvider: true,
            renameProvider: true,
            prepareRenameProvider: true,
            completionProvider: {
              triggerCharacters: [".", ":"],
              resolveProvider: false
            }
          }
        });
        break;
      case "shutdown":
        respond(id, null);
        break;
      case "textDocument/definition": {
        const uri = p?.textDocument?.uri;
        const position = p?.position;
        const text = documents.get(uri);
        if (!text || !position) {
          respond(id, null);
          break;
        }
        const loc = getDefinition(text, uri, position);
        respond(id, loc);
        break;
      }
      case "textDocument/prepareRename": {
        const uri = p?.textDocument?.uri;
        const position = p?.position;
        const text = documents.get(uri);
        if (!text || !position) {
          respond(id, null);
          break;
        }
        const info = prepareRename(text, position);
        if (!info) {
          respond(id, null);
          break;
        }
        respond(id, {
          start: { line: position.line, character: position.character },
          end: { line: position.line, character: position.character + info.word.length }
        });
        break;
      }
      case "textDocument/rename": {
        const uri = p?.textDocument?.uri;
        const position = p?.position;
        const newName = p?.newName;
        const text = documents.get(uri);
        if (!text || !position || !newName) {
          respond(id, null);
          break;
        }
        const edit = getRename(text, uri, position, newName);
        respond(id, edit);
        break;
      }
      case "textDocument/completion": {
        const uri = p?.textDocument?.uri;
        const position = p?.position;
        const text = documents.get(uri);
        if (!text || !position) {
          respond(id, []);
          break;
        }
        const items = getCompletions(text, position);
        respond(id, items);
        break;
      }
      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    respondError(id, -32603, `Internal error: ${msg}`);
  }
}
function handleNotification(notif) {
  const p = notif.params ?? {};
  switch (notif.method) {
    case "initialized":
      break;
    case "textDocument/didOpen": {
      const item = p?.textDocument;
      if (item?.uri && item?.text !== undefined) {
        documents.set(item.uri, item.text);
        publishDiagnostics(item.uri, item.text);
      }
      break;
    }
    case "textDocument/didChange": {
      const uri = p?.textDocument?.uri;
      const changes = p?.contentChanges;
      if (uri && changes?.length > 0) {
        const text = changes[changes.length - 1].text;
        documents.set(uri, text);
        publishDiagnostics(uri, text);
      }
      break;
    }
    case "textDocument/didClose": {
      const uri = p?.textDocument?.uri;
      if (uri) {
        documents.delete(uri);
        notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
      }
      break;
    }
    case "exit":
      process.exit(0);
  }
}
transport.start();
