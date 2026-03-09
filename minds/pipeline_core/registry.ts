/**
 * Pipeline registry — shared types and operations for ticket registry files.
 *
 * Registry files live at .minds/state/pipeline-registry/{TICKET_ID}.json
 * and track the current state of a running pipeline instance.
 */

// ============================================================================
// Constants
// ============================================================================

export const ALLOWED_FIELDS = new Set([
  "current_step",
  "nonce",
  "status",
  "color_index",
  "group_id",
  "agent_pane_id",
  "orchestrator_pane_id",
  "worktree_path",
  "last_signal",
  "last_signal_at",
  "error_count",
  "retry_count",
  "held_at",
  "waiting_for",
  "implement_phase_plan",
  "repo_id",
  "repo_path",
  "code_review_attempts",
]);

// ============================================================================
// Types
// ============================================================================

export interface PhaseHistoryEntry {
  phase: string;
  signal: string;
  ts: string;
}

export interface ImplementPhasePlan {
  total_phases: number;
  current_impl_phase: number;
  phase_names: string[];
  completed_impl_phases: number[];
}

export interface Registry {
  ticket_id: string;
  nonce: string;
  current_step: string;
  status: string;
  agent_pane_id?: string;
  orchestrator_pane_id?: string;
  worktree_path?: string;
  phase_history?: PhaseHistoryEntry[];
  implement_phase_plan?: ImplementPhasePlan;
  repo_id?: string;
  repo_path?: string;
  [key: string]: any;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Parse a "field=value" string into its components.
 * Returns null if the format is invalid (no '=' or field not lowercase/underscore).
 * Values are coerced: integers → number, valid JSON objects/arrays → parsed, else string.
 */
export function parseFieldValue(
  pair: string
): { field: string; value: string | number | object | null } | null {
  const match = pair.match(/^([a-z_]+)=(.+)$/);
  if (!match) return null;

  const field = match[1];
  const rawValue = match[2];

  // Numeric values stay as numbers
  if (/^\d+$/.test(rawValue)) {
    return { field, value: parseInt(rawValue, 10) };
  }

  // JSON objects and arrays are parsed
  if (rawValue.startsWith("{") || rawValue.startsWith("[")) {
    try {
      return { field, value: JSON.parse(rawValue) };
    } catch {
      // Fall through to string
    }
  }

  return { field, value: rawValue };
}

/**
 * Apply field=value updates to a registry object.
 * Returns a new object with updates applied and updated_at timestamp set.
 * Does NOT validate field names - caller must validate against ALLOWED_FIELDS.
 */
export function applyUpdates(
  registry: Record<string, any>,
  updates: Record<string, any>
): Record<string, any> {
  return {
    ...registry,
    ...updates,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/**
 * Advance the implement_phase_plan by one step:
 * - Appends current_impl_phase to completed_impl_phases
 * - Increments current_impl_phase by 1
 * Returns a new registry object. Throws if no plan exists.
 */
export function advanceImplPhase(
  registry: Record<string, any>
): Record<string, any> {
  const plan = registry.implement_phase_plan as ImplementPhasePlan | undefined;
  if (!plan) {
    throw new Error("No implement_phase_plan in registry");
  }
  const updated_plan: ImplementPhasePlan = {
    ...plan,
    completed_impl_phases: [...plan.completed_impl_phases, plan.current_impl_phase],
    current_impl_phase: plan.current_impl_phase + 1,
  };
  return {
    ...registry,
    implement_phase_plan: updated_plan,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/**
 * Delete a top-level field from the registry.
 * Returns a new registry object without the field.
 */
export function deleteField(
  registry: Record<string, any>,
  fieldName: string
): Record<string, any> {
  const { [fieldName]: _removed, ...rest } = registry;
  return {
    ...rest,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/**
 * Append an entry to the phase_history array.
 * Initializes the array if missing. Returns a new registry object.
 */
export function appendPhaseHistory(
  registry: Record<string, any>,
  entry: any
): Record<string, any> {
  const history = Array.isArray(registry.phase_history)
    ? [...registry.phase_history]
    : [];
  history.push(entry);
  return {
    ...registry,
    phase_history: history,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
