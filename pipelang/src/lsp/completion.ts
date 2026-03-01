// Context-aware autocompletion handler
// Analyzes the text before the cursor to determine what to suggest.

import type { Position, CompletionItem } from "./protocol";
import { CompletionItemKind } from "./protocol";

// Fixed keyword completions
const PHASE_MODIFIERS: CompletionItem[] = [
  "command", "signals", "on", "terminal", "model",
  "goalGate", "orchestratorContext", "actions",
].map((label) => ({ label, kind: CompletionItemKind.Method, detail: "Phase modifier" }));

const GATE_MODIFIERS: CompletionItem[] = [
  "prompt", "skipTo", "on",
].map((label) => ({ label, kind: CompletionItemKind.Method, detail: "Gate modifier" }));

const MODEL_VALUES: CompletionItem[] = ["haiku", "sonnet", "opus"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
  detail: "Model name",
}));

const GOAL_GATE_VALUES: CompletionItem[] = ["always", "ifTriggered"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
  detail: "GoalGate value",
}));

const FEEDBACK_VALUES: CompletionItem[] = ["enrich", "raw"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
}));

const EXHAUST_VALUES: CompletionItem[] = ["escalate", "skip", "abort"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
}));

const CONTEXT_SOURCE_VALUES: CompletionItem[] = ["file", "inline"].map((label) => ({
  label,
  kind: CompletionItemKind.EnumMember,
}));

const TOP_LEVEL_KEYWORDS: CompletionItem[] = [
  { label: "phase", kind: CompletionItemKind.Keyword, insertText: "phase(${1:name})\n    " },
  { label: "gate", kind: CompletionItemKind.Keyword, insertText: "gate(${1:name})\n    " },
  { label: "@defaultModel", kind: CompletionItemKind.Keyword, insertText: "@defaultModel(${1:sonnet})" },
];

/** Get the text of the line up to the cursor */
function prefixAt(text: string, pos: Position): string {
  const lines = text.split("\n");
  const line = lines[pos.line] ?? "";
  return line.slice(0, pos.character);
}

/** Collect all phase names using regex (tolerant of incomplete documents) */
function phaseNames(text: string): CompletionItem[] {
  return [...text.matchAll(/^phase\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gm)].map((m) => ({
    label: m[1],
    kind: CompletionItemKind.Function,
    detail: "Phase",
  }));
}

/** Collect all gate names using regex (tolerant of incomplete documents) */
function gateNames(text: string): CompletionItem[] {
  return [...text.matchAll(/^gate\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gm)].map((m) => ({
    label: m[1],
    kind: CompletionItemKind.Interface,
    detail: "Gate",
  }));
}

/** Collect all signal names declared in .signals(...) using regex (tolerant of incomplete documents) */
function signalNames(text: string): CompletionItem[] {
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
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

/**
 * Handle textDocument/completion.
 * Returns context-appropriate completion items.
 */
export function getCompletions(text: string, pos: Position): CompletionItem[] {
  const prefix = prefixAt(text, pos);
  const trimmed = prefix.trimStart();

  // Specific dot-value completions must come BEFORE the generic `.\w*` modifier check,
  // because prefixes like `feedback: .` and `.goalGate(.` also end with `.`

  // After `.goalGate(.` — enum values
  if (/\.goalGate\s*\(\s*\.\s*\w*$/.test(prefix)) {
    return GOAL_GATE_VALUES;
  }

  // After `feedback: .` — feedback enum
  if (/\bfeedback\s*:\s*\.\s*\w*$/.test(prefix)) {
    return FEEDBACK_VALUES;
  }

  // After `onExhaust: .` — exhaust enum
  if (/\bonExhaust\s*:\s*\.\s*\w*$/.test(prefix)) {
    return EXHAUST_VALUES;
  }

  // After `.orchestratorContext(.` or `.prompt(.` — file/inline
  if (/\.(orchestratorContext|prompt)\s*\(\s*\.\s*\w*$/.test(prefix)) {
    return CONTEXT_SOURCE_VALUES;
  }

  // After `.` — modifier names (we detect if inside gate or phase by looking backwards)
  if (/\.\w*$/.test(prefix)) {
    // Check if we're in a gate context (look backwards for 'gate(')
    const allLines = text.split("\n").slice(0, pos.line + 1).join("\n");
    const inGate = /\bgate\s*\([^)]+\)[^{]*$/.test(allLines.replace(/\/\/[^\n]*/g, "").replace(/#[^\n]*/g, ""));
    return inGate ? GATE_MODIFIERS : PHASE_MODIFIERS;
  }

  // After `to:` or `to =` — phase names
  if (/\bto\s*:\s*\w*$/.test(prefix) || /\bto\s*=\s*\w*$/.test(prefix)) {
    return phaseNames(text);
  }

  // After `gate:` or `to = gate(` — gate names
  if (/\bgate\s*:\s*\w*$/.test(prefix) || /to\s*=\s*gate\s*\(\s*\w*$/.test(prefix)) {
    return gateNames(text);
  }

  // Inside `.model(` or `@defaultModel(` — model names
  if (/\.(model|defaultModel)\s*\(\s*\w*$/.test(prefix) || /@defaultModel\s*\(\s*\w*$/.test(prefix)) {
    return MODEL_VALUES;
  }

  // Inside `.on(` — signal names
  if (/\.on\s*\(\s*\w*$/.test(prefix)) {
    return signalNames(text);
  }

  // Inside `.signals(` — show existing signals as hints
  if (/\.signals\s*\([^)]*$/.test(prefix)) {
    return signalNames(text);
  }

  // At top level (line starts with non-whitespace or is empty)
  if (/^\s*$/.test(trimmed) || /^[a-zA-Z@]/.test(trimmed)) {
    return TOP_LEVEL_KEYWORDS;
  }

  return [];
}
