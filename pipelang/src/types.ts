// AST type definitions for the pipelang compiler

export interface SourceLocation {
  line: number;
  col: number;
}

export interface ParseError {
  message: string;
  loc: SourceLocation;
}

export interface ParseResult {
  ast?: PipelineAST;
  errors: ParseError[];
}

export interface PipelineAST {
  phases: PhaseDecl[];
  gates: GateDecl[];
  defaultModel?: string; // "haiku" | "sonnet" | "opus"
}

export interface PhaseDecl {
  name: string;
  loc: SourceLocation;
  /** Location of the name token itself (inside the parens), used by LSP for go-to-def */
  nameLoc: SourceLocation;
  modifiers: Modifier[];
}

export type Modifier =
  | TerminalModifier
  | CommandModifier
  | SignalsModifier
  | OnModifier
  | ConditionalOnModifier
  | GoalGateModifier
  | OrchestratorContextModifier
  | ActionsModifier
  | ModelModifier;

export interface ModelModifier {
  kind: "model";
  name: "haiku" | "sonnet" | "opus";
  loc: SourceLocation;
}

export interface TerminalModifier {
  kind: "terminal";
  loc: SourceLocation;
}

export interface CommandModifier {
  kind: "command";
  value: string;
  loc: SourceLocation;
}

export interface SignalsModifier {
  kind: "signals";
  signals: string[];
  loc: SourceLocation;
}

export interface OnModifier {
  kind: "on";
  signal: string;
  signalLoc: SourceLocation;
  target: OnTarget;
  loc: SourceLocation;
}

/** Phase .on() target — either to: phase or gate: name */
export type OnTarget = ToTarget | GateTarget;

export interface ToTarget {
  kind: "to";
  phase: string;
  phaseLoc: SourceLocation;
}

export interface GateTarget {
  kind: "gate";
  gate: string;
  gateLoc: SourceLocation;
}

// ── Conditional routing ───────────────────────────────────────────────────────

/** One branch inside a block-form .on() — either when(cond) or otherwise */
export interface ConditionalBranch {
  /** condition expression (e.g. "hasGroup and isBackend"); undefined = otherwise */
  condition?: string;
  target: OnTarget;
  loc: SourceLocation;
}

export interface ConditionalOnModifier {
  kind: "conditionalOn";
  signal: string;
  signalLoc: SourceLocation;
  branches: ConditionalBranch[];
  loc: SourceLocation;
}

export interface GoalGateModifier {
  kind: "goalGate";
  /** .always | .ifTriggered */
  value: "always" | "ifTriggered";
  loc: SourceLocation;
}

export type ContextSource =
  | { kind: "file"; path: string }
  | { kind: "inline"; text: string }
  | { kind: "ai"; expr: string };

export interface OrchestratorContextModifier {
  kind: "orchestratorContext";
  source: ContextSource;
  loc: SourceLocation;
}

// ── Actions block ─────────────────────────────────────────────────────────────

/** Argument to display() or prompt() */
export type DisplayValue =
  | { kind: "inline"; text: string }
  | { kind: "ai"; expr: string }
  | { kind: "file"; path: string };

export interface DisplayAction {
  kind: "display";
  value: DisplayValue;
  loc: SourceLocation;
}

export interface PromptAction {
  kind: "prompt";
  value: DisplayValue;
  loc: SourceLocation;
}

export interface CommandAction {
  kind: "command";
  value: string;
  loc: SourceLocation;
}

export type Action = DisplayAction | PromptAction | CommandAction;

export interface ActionsModifier {
  kind: "actions";
  actions: Action[];
  loc: SourceLocation;
}

// ── Gate declarations ─────────────────────────────────────────────────────────

export type GateModifier = GatePromptModifier | GateSkipToModifier | GateOnModifier;

export interface GatePromptModifier {
  kind: "prompt";
  source: ContextSource;
  loc: SourceLocation;
}

export interface GateSkipToModifier {
  kind: "skipTo";
  phase: string;
  phaseLoc: SourceLocation;
  loc: SourceLocation;
}

export interface GateOnModifier {
  kind: "on";
  signal: string;
  signalLoc: SourceLocation;
  target?: ToTarget; // optional — not required when onExhaust handles routing (e.g. .abort)
  feedback?: "enrich" | "raw";
  maxRetries?: number;
  onExhaust?: "escalate" | "skip" | "abort";
  loc: SourceLocation;
}

export interface GateDecl {
  name: string;
  loc: SourceLocation;
  /** Location of the name token itself (inside the parens), used by LSP for go-to-def */
  nameLoc: SourceLocation;
  modifiers: GateModifier[];
}

/** The 5 built-in token variables available for ${TOKEN} interpolation */
export const BUILTIN_TOKENS = new Set([
  "TICKET_ID",
  "TICKET_TITLE",
  "PHASE",
  "INCOMING_SIGNAL",
  "INCOMING_DETAIL",
]);

/** Formally-known condition identifiers — unknown conditions produce a warning */
export const KNOWN_CONDITIONS = new Set([
  "hasGroup",
  "isBackend",
  "isFrontend",
  "hasTests",
  "isUrgent",
]);

/** Validation error (or warning) produced by the two-pass compiler validator */
export interface CompileError {
  message: string;
  loc: SourceLocation;
  /** "error" (default when absent) blocks compilation; "warning" prints to stderr but allows compilation */
  severity?: "error" | "warning";
}
