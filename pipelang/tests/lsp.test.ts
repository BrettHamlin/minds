// LSP unit tests — no editor required
// Tests diagnostics, symbols, go-to-definition, rename, and completions

import { describe, test, expect } from "bun:test";
import { getDiagnostics } from "../src/lsp/diagnostics";
import { buildSymbolTable, findDeclaration, findAllLocations } from "../src/lsp/symbols";
import { getDefinition, wordAtPosition } from "../src/lsp/definition";
import { getRename, prepareRename } from "../src/lsp/rename";
import { getCompletions } from "../src/lsp/completion";
import { parse } from "../src/parser";
import { DiagnosticSeverity } from "../src/lsp/protocol";

// ── Fixture ───────────────────────────────────────────────────────────────────

const SIMPLE_PIPELINE = `
phase(clarify)
    .command("/collab.clarify")
    .signals(CLARIFY_COMPLETE, CLARIFY_ERROR)
    .on(CLARIFY_COMPLETE, to: plan)
    .on(CLARIFY_ERROR, to: clarify)

phase(plan)
    .command("/collab.plan")
    .signals(PLAN_COMPLETE, PLAN_ERROR)
    .on(PLAN_COMPLETE, gate: plan_review)
    .on(PLAN_ERROR, to: plan)

gate(plan_review)
    .prompt(.file("gates/plan.md"))
    .skipTo(plan)
    .on(APPROVED, to: plan)
    .on(REVISION_NEEDED, to: plan, feedback: .enrich, maxRetries: 3, onExhaust: .skip)

phase(done)
    .terminal()
`.trim();

// ── Diagnostics ───────────────────────────────────────────────────────────────

describe("getDiagnostics: valid pipeline", () => {
  test("no errors for valid pipeline", () => {
    const diags = getDiagnostics(SIMPLE_PIPELINE);
    const errors = diags.filter((d) => d.severity === DiagnosticSeverity.Error);
    expect(errors).toHaveLength(0);
  });
});

describe("getDiagnostics: parse errors", () => {
  test("unclosed paren produces error", () => {
    const diags = getDiagnostics("phase(missing_close\n    .terminal()");
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error)).toBe(true);
  });
});

describe("getDiagnostics: validation errors (the 11 editor validations)", () => {
  test("undeclared phase target is an error", () => {
    const src = `
phase(a)
    .command("/cmd")
    .signals(SIG)
    .on(SIG, to: undeclared_phase)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.includes("undeclared_phase"))).toBe(true);
  });

  test("undeclared gate target is an error", () => {
    const src = `
phase(a)
    .command("/cmd")
    .signals(SIG)
    .on(SIG, gate: missing_gate)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.includes("missing_gate"))).toBe(true);
  });

  test("signal used in .on() not declared in .signals() is an error", () => {
    const src = `
phase(a)
    .command("/cmd")
    .signals(DECLARED)
    .on(UNDECLARED_SIGNAL, to: done)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.includes("UNDECLARED_SIGNAL"))).toBe(true);
  });

  test("terminal phase with outbound transition is an error", () => {
    const src = `
phase(done)
    .terminal()
    .on(SIG, to: done)
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error)).toBe(true);
  });

  test("duplicate phase name is an error", () => {
    const src = `
phase(a).command("/x").signals(S).on(S, to: done)
phase(a).command("/y").signals(T).on(T, to: done)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.toLowerCase().includes("duplicate"))).toBe(true);
  });

  test("missing otherwise in conditional block is an error", () => {
    const src = `
phase(a)
    .command("/x")
    .signals(SIG)
    .on(SIG) {
        when(hasGroup) { to = done }
    }
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.toLowerCase().includes("otherwise"))).toBe(true);
  });

  test("onExhaust: skip without gate skipTo is an error", () => {
    const src = `
phase(a).command("/x").signals(S).on(S, gate: g)
gate(g)
    .prompt(.file("p.md"))
    .on(APPROVED, to: a)
    .on(FAILED, to: a, maxRetries: 2, onExhaust: .skip)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.includes("skipTo"))).toBe(true);
  });

  test("unknown condition in when() produces warning", () => {
    const src = `
phase(a)
    .command("/x")
    .signals(SIG)
    .on(SIG) {
        when(myCustomCondition) { to = done }
        otherwise { to = done }
    }
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Warning && d.message.toLowerCase().includes("myCustomCondition".toLowerCase()))).toBe(true);
  });

  test("unknown ${TOKEN} in string is an error", () => {
    const src = `
phase(a)
    .actions {
        display("Hello \${UNKNOWN_TOKEN}")
        command("/cmd")
    }
    .signals(SIG)
    .on(SIG, to: done)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.includes("UNKNOWN_TOKEN"))).toBe(true);
  });

  test("gate .prompt(.ai(...)) is a warning", () => {
    const src = `
phase(a).command("/x").signals(S).on(S, gate: g)
gate(g)
    .prompt(.ai("summarize the spec"))
    .on(APPROVED, to: a)
    .on(FAILED, to: a)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Warning && d.message.includes("ai()"))).toBe(true);
    // Should NOT be an error — ai() is allowed but flagged
    const errors = diags.filter((d) => d.severity === DiagnosticSeverity.Error);
    expect(errors).toHaveLength(0);
  });

  test("gate .on() with no to: and no onExhaust is an error", () => {
    const src = `
phase(a).command("/x").signals(S).on(S, gate: g)
gate(g)
    .prompt(.file("p.md"))
    .on(APPROVED, to: a)
    .on(FAILED, feedback: .enrich, maxRetries: 3)
phase(done).terminal()
    `.trim();
    const diags = getDiagnostics(src);
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Error && d.message.includes("dead-end"))).toBe(true);
  });
});

// ── Symbol table ──────────────────────────────────────────────────────────────

describe("buildSymbolTable", () => {
  test("finds phase declarations", () => {
    const { ast } = parse(SIMPLE_PIPELINE);
    const table = buildSymbolTable(ast!);

    const clarify = findDeclaration(table, "clarify", "phase");
    expect(clarify).toBeDefined();
    expect(clarify!.nameLoc.line).toBeGreaterThan(0);
  });

  test("finds gate declarations", () => {
    const { ast } = parse(SIMPLE_PIPELINE);
    const table = buildSymbolTable(ast!);

    const gate = findDeclaration(table, "plan_review", "gate");
    expect(gate).toBeDefined();
  });

  test("finds phase references in .on()", () => {
    const { ast } = parse(SIMPLE_PIPELINE);
    const table = buildSymbolTable(ast!);

    const locs = findAllLocations(table, "plan", "phase");
    // "plan" appears as: declaration, clarify .on(CLARIFY_COMPLETE, to: plan),
    // plan .on(PLAN_ERROR, to: plan), gate .on(APPROVED, to: plan), gate .on(REVISION_NEEDED, to: plan)
    // and gate .skipTo(plan)
    expect(locs.length).toBeGreaterThanOrEqual(2); // at least decl + 1 ref
  });

  test("unknown name returns undefined", () => {
    const { ast } = parse(SIMPLE_PIPELINE);
    const table = buildSymbolTable(ast!);
    expect(findDeclaration(table, "nonexistent", "phase")).toBeUndefined();
  });
});

// ── wordAtPosition ────────────────────────────────────────────────────────────

describe("wordAtPosition", () => {
  const text = "phase(clarify)\n    .on(SIGNAL, to: plan)";

  test("cursor on 'clarify' returns 'clarify'", () => {
    expect(wordAtPosition(text, { line: 0, character: 8 })).toBe("clarify");
  });

  test("cursor on 'plan' returns 'plan'", () => {
    expect(wordAtPosition(text, { line: 1, character: 20 })).toBe("plan");
  });

  test("cursor on '(' returns null", () => {
    expect(wordAtPosition(text, { line: 0, character: 5 })).toBeNull();
  });

  test("cursor beyond line length returns null", () => {
    expect(wordAtPosition(text, { line: 99, character: 0 })).toBeNull();
  });
});

// ── Go-to-definition ──────────────────────────────────────────────────────────

describe("getDefinition", () => {
  const uri = "file:///test.pipeline";

  test("click on phase name reference returns declaration location", () => {
    // line 4 (0-indexed): "    .on(CLARIFY_COMPLETE, to: plan)"
    // "plan" starts at character 30 in that line
    const lines = SIMPLE_PIPELINE.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("to: plan"));
    const charIdx = lines[lineIdx].indexOf("plan", lines[lineIdx].indexOf("to:"));

    const result = getDefinition(SIMPLE_PIPELINE, uri, { line: lineIdx, character: charIdx });
    expect(result).not.toBeNull();
    expect(result!.uri).toBe(uri);
    // Should point to where "plan" is declared: phase(plan)
    const declLine = lines.findIndex((l) => /^phase\(plan\)/.test(l));
    expect(result!.range.start.line).toBe(declLine);
  });

  test("click on gate name reference returns gate declaration", () => {
    const lines = SIMPLE_PIPELINE.split("\n");
    const lineIdx = lines.findIndex((l) => l.includes("gate: plan_review"));
    const charIdx = lines[lineIdx].indexOf("plan_review");

    const result = getDefinition(SIMPLE_PIPELINE, uri, { line: lineIdx, character: charIdx });
    expect(result).not.toBeNull();
    const declLine = lines.findIndex((l) => /^gate\(plan_review\)/.test(l));
    expect(result!.range.start.line).toBe(declLine);
  });

  test("click on unknown word returns null", () => {
    expect(getDefinition(SIMPLE_PIPELINE, uri, { line: 0, character: 0 })).toBeNull();
  });
});

// ── Rename ────────────────────────────────────────────────────────────────────

describe("prepareRename", () => {
  test("phase name is renameable", () => {
    const lines = SIMPLE_PIPELINE.split("\n");
    const lineIdx = lines.findIndex((l) => /^phase\(plan\)/.test(l));
    // cursor on 'plan' — starts at character 6 (inside 'phase(plan)')
    const result = prepareRename(SIMPLE_PIPELINE, { line: lineIdx, character: 7 });
    expect(result).not.toBeNull();
    expect(result!.word).toBe("plan");
    expect(result!.kind).toBe("phase");
  });

  test("gate name is renameable", () => {
    const lines = SIMPLE_PIPELINE.split("\n");
    const lineIdx = lines.findIndex((l) => /^gate\(plan_review\)/.test(l));
    const result = prepareRename(SIMPLE_PIPELINE, { line: lineIdx, character: 7 });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("gate");
  });

  test("non-symbol word is not renameable", () => {
    const result = prepareRename(SIMPLE_PIPELINE, { line: 0, character: 0 });
    expect(result).toBeNull();
  });
});

describe("getRename", () => {
  const uri = "file:///test.pipeline";

  test("renames phase in declaration and all references", () => {
    const lines = SIMPLE_PIPELINE.split("\n");
    const lineIdx = lines.findIndex((l) => /^phase\(plan\)/.test(l));

    const edit = getRename(SIMPLE_PIPELINE, uri, { line: lineIdx, character: 7 }, "planning");
    expect(edit).not.toBeNull();

    const changes = edit!.changes![uri];
    expect(changes).toBeDefined();
    // All edits should replace "plan" with "planning"
    expect(changes.every((e) => e.newText === "planning")).toBe(true);
    // At least 2: declaration + at least one reference
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Completions ───────────────────────────────────────────────────────────────

describe("getCompletions", () => {
  const uri = "file:///test.pipeline";

  test("after '.' in phase context suggests phase modifiers", () => {
    const text = "phase(a)\n    .";
    const items = getCompletions(text, { line: 1, character: 5 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("command");
    expect(labels).toContain("signals");
    expect(labels).toContain("on");
    expect(labels).toContain("terminal");
    expect(labels).toContain("model");
  });

  test("after 'to:' suggests phase names", () => {
    const items = getCompletions(SIMPLE_PIPELINE + "\n    .on(X, to: ", {
      line: SIMPLE_PIPELINE.split("\n").length,
      character: 16,
    });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("clarify");
    expect(labels).toContain("plan");
  });

  test("after 'gate:' suggests gate names", () => {
    const items = getCompletions(SIMPLE_PIPELINE + "\n    .on(X, gate: ", {
      line: SIMPLE_PIPELINE.split("\n").length,
      character: 17,
    });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("plan_review");
  });

  test("after '.model(' suggests model names", () => {
    const items = getCompletions("phase(a)\n    .model(", { line: 1, character: 11 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("haiku");
    expect(labels).toContain("sonnet");
    expect(labels).toContain("opus");
  });

  test("after '@defaultModel(' suggests model names", () => {
    const items = getCompletions("@defaultModel(", { line: 0, character: 14 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("haiku");
    expect(labels).toContain("sonnet");
    expect(labels).toContain("opus");
  });

  test("after '.goalGate(.' suggests .always and .ifTriggered", () => {
    const items = getCompletions("phase(a)\n    .goalGate(.", { line: 1, character: 15 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("always");
    expect(labels).toContain("ifTriggered");
  });

  test("after 'feedback: .' suggests .enrich and .raw", () => {
    const items = getCompletions(".on(S, to: x, feedback: .", { line: 0, character: 25 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("enrich");
    expect(labels).toContain("raw");
  });

  test("after 'onExhaust: .' suggests .escalate, .skip, .abort", () => {
    const items = getCompletions(".on(S, to: x, onExhaust: .", { line: 0, character: 26 });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("escalate");
    expect(labels).toContain("skip");
    expect(labels).toContain("abort");
  });

  test("inside .on( suggests signal names", () => {
    const items = getCompletions(SIMPLE_PIPELINE + "\nphase(b)\n    .command(\"/x\")\n    .on(", {
      line: SIMPLE_PIPELINE.split("\n").length + 2,
      character: 8,
    });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("CLARIFY_COMPLETE");
    expect(labels).toContain("PLAN_COMPLETE");
  });
});
