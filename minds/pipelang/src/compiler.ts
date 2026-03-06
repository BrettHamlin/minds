// AST → JSON compiler for the pipelang DSL

import type { PipelineAST, DisplayValue, GateDecl } from "./types";

// CROSS-MIND: runtime import only — Pipeline Core owns these types
// Import and re-export compiled types from shared library
import type {
  CompiledTransition,
  CompiledDisplayValue,
  CompiledAction,
  ConditionalTransitionRow,
  CompiledPhase,
  CompiledGateResponse,
  CompiledGate,
  CompiledPipeline,
  CompiledCodeReview,
  CompiledMetrics,
  CompiledInteractive,
} from "../../../src/lib/pipeline/types";
export type {
  CompiledTransition,
  CompiledDisplayValue,
  CompiledAction,
  ConditionalTransitionRow,
  CompiledPhase,
  CompiledGateResponse,
  CompiledGate,
  CompiledPipeline,
  CompiledCodeReview,
  CompiledMetrics,
  CompiledInteractive,
};

// Model name → Claude model ID
export const MODEL_IDS: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

function compileDisplayValue(dv: DisplayValue): CompiledDisplayValue {
  if (dv.kind === "inline") return dv.text;
  if (dv.kind === "ai") return { ai: dv.expr };
  return { file: dv.path };
}

/**
 * Returns all ancestor phase names (phases that must complete before `target` can run),
 * in declaration order (i.e. the order they appear in ast.phases).
 */
function collectAncestors(
  target: string,
  predecessorMap: Map<string, Set<string>>,
  declarationOrder: string[]
): string[] {
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const pred of predecessorMap.get(node) ?? []) {
      if (!visited.has(pred)) {
        visited.add(pred);
        queue.push(pred);
      }
    }
  }
  // Return ancestors in declaration order (stable)
  return declarationOrder.filter((name) => visited.has(name));
}

function compileGate(gateDecl: GateDecl): CompiledGate {
  const on: Record<string, CompiledGateResponse> = {};
  let prompt: string | { ai: string } | { inline: string } | undefined;
  let skipTo: string | undefined;

  for (const mod of gateDecl.modifiers) {
    if (mod.kind === "prompt") {
      prompt =
        mod.source.kind === "file"
          ? mod.source.path
          : mod.source.kind === "ai"
          ? { ai: mod.source.expr }
          : { inline: mod.source.text };
    } else if (mod.kind === "skipTo") {
      skipTo = mod.phase;
    } else if (mod.kind === "on") {
      const resp: CompiledGateResponse = {};
      if (mod.target !== undefined) resp.to = mod.target.phase;
      if (mod.feedback !== undefined) resp.feedback = mod.feedback;
      if (mod.maxRetries !== undefined) resp.maxRetries = mod.maxRetries;
      if (mod.onExhaust !== undefined) resp.onExhaust = mod.onExhaust;
      on[mod.signal] = resp;
    }
  }

  const compiled: CompiledGate = {
    prompt: prompt ?? "",
    on,
  };
  if (skipTo !== undefined) compiled.skipTo = skipTo;
  return compiled;
}

export function compile(ast: PipelineAST): CompiledPipeline {
  const phases: Record<string, CompiledPhase> = {};

  // Determine whether any model config is present — gating I/O derivation
  const hasModelConfig =
    ast.defaultModel !== undefined ||
    ast.phases.some((p) => p.modifiers.some((m) => m.kind === "model"));

  // Declaration order for stable ancestor sorting
  const declarationOrder = ast.phases.map((p) => p.name);

  // Build predecessor map for I/O derivation
  const predecessorMap = new Map<string, Set<string>>();
  for (const p of ast.phases) predecessorMap.set(p.name, new Set());

  for (const phaseDecl of ast.phases) {
    for (const mod of phaseDecl.modifiers) {
      if (mod.kind === "on" && mod.target.kind === "to") {
        const succ = mod.target.phase;
        if (!predecessorMap.has(succ)) predecessorMap.set(succ, new Set());
        predecessorMap.get(succ)!.add(phaseDecl.name);
      }
    }
  }

  // Resolve default model ID
  const defaultModelId = ast.defaultModel ? MODEL_IDS[ast.defaultModel] : undefined;

  for (const phaseDecl of ast.phases) {
    const compiled: CompiledPhase = {};

    const transitions: Record<string, CompiledTransition> = {};
    const conditionalRows: ConditionalTransitionRow[] = [];
    let phaseModelName: string | undefined;
    let isTerminal = false;

    for (const mod of phaseDecl.modifiers) {
      if (mod.kind === "terminal") {
        compiled.terminal = true;
        isTerminal = true;
      } else if (mod.kind === "command") {
        compiled.command = mod.value;
      } else if (mod.kind === "signals") {
        compiled.signals = mod.signals;
      } else if (mod.kind === "on") {
        if (mod.condition !== undefined || mod.isOtherwise) {
          // Conditional branch → goes into conditionalTransitions
          const row: ConditionalTransitionRow = { signal: mod.signal };
          if (mod.condition !== undefined) row.if = mod.condition;
          if (mod.target.kind === "to") {
            row.to = mod.target.phase;
          } else {
            row.gate = mod.target.gate;
          }
          conditionalRows.push(row);
        } else {
          // Simple unconditional transition
          if (mod.target.kind === "to") {
            transitions[mod.signal] = { to: mod.target.phase };
          } else {
            transitions[mod.signal] = { gate: mod.target.gate };
          }
        }
      } else if (mod.kind === "goalGate") {
        compiled.goal_gate = mod.value === "always" ? "always" : "if_triggered";
      } else if (mod.kind === "orchestratorContext") {
        if (mod.source.kind === "file") {
          compiled.orchestrator_context = mod.source.path;
        } else if (mod.source.kind === "inline") {
          compiled.orchestrator_context = { inline: mod.source.text };
        } else {
          compiled.orchestrator_context = { inline: mod.source.expr };
        }
      } else if (mod.kind === "actions") {
        compiled.actions = mod.actions.map((action) => {
          if (action.kind === "display") {
            return { display: compileDisplayValue(action.value) };
          } else if (action.kind === "prompt") {
            return { prompt: compileDisplayValue(action.value) };
          } else {
            return { command: action.value };
          }
        });
      } else if (mod.kind === "model") {
        phaseModelName = mod.name;
      } else if (mod.kind === "before") {
        if (!compiled.before) compiled.before = [];
        compiled.before.push({ phase: mod.phase });
      } else if (mod.kind === "after") {
        if (!compiled.after) compiled.after = [];
        compiled.after.push({ phase: mod.phase });
      } else if (mod.kind === "codeReview") {
        compiled.codeReview = { enabled: false };
      } else if (mod.kind === "metrics") {
        compiled.metrics = { enabled: false };
      } else if (mod.kind === "interactive") {
        compiled.interactive = { enabled: mod.enabled };
      }
    }

    if (Object.keys(transitions).length > 0) {
      compiled.transitions = transitions;
    }

    if (conditionalRows.length > 0) {
      compiled.conditionalTransitions = conditionalRows;
    }

    // Model + I/O derivation — only when pipeline has model config
    if (hasModelConfig && !isTerminal) {
      const resolvedModelName = phaseModelName ?? ast.defaultModel ?? "sonnet";
      compiled.model = MODEL_IDS[resolvedModelName];

      {
        const ancestors = collectAncestors(phaseDecl.name, predecessorMap, declarationOrder);
        compiled.inputs = ["ticket_spec", ...ancestors.map((a) => `${a}_output`)];
        compiled.outputs = [`${phaseDecl.name}_output`];
      }
    }

    phases[phaseDecl.name] = compiled;
  }

  // Compile gates
  const gatesOut: Record<string, CompiledGate> = {};
  for (const gateDecl of ast.gates) {
    gatesOut[gateDecl.name] = compileGate(gateDecl);
  }

  const result: CompiledPipeline = { version: "3.1", phases };
  if (defaultModelId) result.defaultModel = defaultModelId;
  if (Object.keys(gatesOut).length > 0) result.gates = gatesOut;

  // Compile @codeReview directive — apply defaults for omitted fields
  if (ast.codeReview !== undefined) {
    const cr = ast.codeReview;
    if (!cr.enabled) {
      result.codeReview = { enabled: false };
    } else {
      const compiledCr: CompiledCodeReview = {
        enabled: true,
        model: MODEL_IDS[cr.model ?? "opus"],
        maxAttempts: cr.maxAttempts ?? 3,
      };
      if (cr.file !== undefined) compiledCr.file = cr.file;
      result.codeReview = compiledCr;
    }
  }

  // Compile @metrics directive
  if (ast.metrics !== undefined) {
    result.metrics = { enabled: ast.metrics.enabled };
  }

  // Compile @interactive directive
  if (ast.interactive !== undefined) {
    result.interactive = { enabled: ast.interactive.enabled };
  }

  return result;
}
