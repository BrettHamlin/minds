import { describe, expect, test } from "bun:test";
import {
  ALLOWED_FIELDS,
  applyUpdates,
  appendPhaseHistory,
  parseFieldValue,
  advanceImplPhase,
  deleteField,
} from "./registry-update";

// ============================================================================
// parseFieldValue
// ============================================================================

describe("parseFieldValue", () => {
  test("parses valid string field=value", () => {
    const result = parseFieldValue("current_step=plan");
    expect(result).toEqual({ field: "current_step", value: "plan" });
  });

  test("parses numeric value as number", () => {
    const result = parseFieldValue("retry_count=3");
    expect(result).toEqual({ field: "retry_count", value: 3 });
  });

  test("parses zero as number", () => {
    const result = parseFieldValue("error_count=0");
    expect(result).toEqual({ field: "error_count", value: 0 });
  });

  test("returns null for missing equals sign", () => {
    expect(parseFieldValue("current_step")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseFieldValue("")).toBeNull();
  });

  test("returns null for uppercase field name", () => {
    expect(parseFieldValue("FIELD=value")).toBeNull();
  });

  test("returns null for field with hyphens", () => {
    expect(parseFieldValue("my-field=value")).toBeNull();
  });

  test("handles value containing equals sign", () => {
    const result = parseFieldValue("worktree_path=/tmp/foo=bar");
    expect(result).toEqual({ field: "worktree_path", value: "/tmp/foo=bar" });
  });

  test("non-numeric value stays as string", () => {
    const result = parseFieldValue("status=running");
    expect(result).toEqual({ field: "status", value: "running" });
  });
});

// ============================================================================
// applyUpdates
// ============================================================================

describe("applyUpdates", () => {
  test("applies single field update", () => {
    const registry = { ticket_id: "BRE-100", current_step: "clarify" };
    const result = applyUpdates(registry, { current_step: "plan" });

    expect(result.current_step).toBe("plan");
    expect(result.ticket_id).toBe("BRE-100");
    expect(result.updated_at).toBeDefined();
  });

  test("applies multiple field updates", () => {
    const registry = { ticket_id: "BRE-100", status: "running" };
    const result = applyUpdates(registry, {
      status: "held",
      held_at: "clarify",
    });

    expect(result.status).toBe("held");
    expect(result.held_at).toBe("clarify");
  });

  test("preserves numeric values as numbers", () => {
    const registry = { ticket_id: "BRE-100", retry_count: 0 };
    const result = applyUpdates(registry, { retry_count: 3 });

    expect(result.retry_count).toBe(3);
    expect(typeof result.retry_count).toBe("number");
  });

  test("sets updated_at timestamp in ISO format", () => {
    const registry = { ticket_id: "BRE-100" };
    const result = applyUpdates(registry, { status: "running" });

    // Should match ISO 8601 format without milliseconds
    expect(result.updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    );
  });

  test("does not mutate original registry", () => {
    const registry = { ticket_id: "BRE-100", status: "running" };
    const original = { ...registry };
    applyUpdates(registry, { status: "held" });

    expect(registry).toEqual(original);
  });
});

// ============================================================================
// appendPhaseHistory
// ============================================================================

describe("appendPhaseHistory", () => {
  test("appends entry to existing phase_history", () => {
    const registry = {
      ticket_id: "BRE-100",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
      ],
    };
    const entry = {
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00Z",
    };
    const result = appendPhaseHistory(registry, entry);

    expect(result.phase_history).toHaveLength(2);
    expect(result.phase_history[1]).toEqual(entry);
    expect(result.updated_at).toBeDefined();
  });

  test("initializes phase_history array if missing", () => {
    const registry = { ticket_id: "BRE-100" };
    const entry = {
      phase: "clarify",
      signal: "CLARIFY_COMPLETE",
      ts: "2026-01-01T00:00:00Z",
    };
    const result = appendPhaseHistory(registry, entry);

    expect(result.phase_history).toHaveLength(1);
    expect(result.phase_history[0]).toEqual(entry);
  });

  test("does not mutate original registry", () => {
    const originalHistory = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
    ];
    const registry = {
      ticket_id: "BRE-100",
      phase_history: originalHistory,
    };
    appendPhaseHistory(registry, {
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00Z",
    });

    expect(registry.phase_history).toHaveLength(1);
  });

  test("does not mutate original phase_history array", () => {
    const originalHistory = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
    ];
    const registry = { ticket_id: "BRE-100", phase_history: originalHistory };
    appendPhaseHistory(registry, {
      phase: "plan",
      signal: "PLAN_COMPLETE",
      ts: "2026-01-01T01:00:00Z",
    });

    expect(originalHistory).toHaveLength(1);
  });
});

// ============================================================================
// ALLOWED_FIELDS
// ============================================================================

describe("ALLOWED_FIELDS", () => {
  test("contains all expected fields", () => {
    const expected = [
      "current_step", "nonce", "status", "color_index", "group_id",
      "agent_pane_id", "orchestrator_pane_id", "worktree_path",
      "last_signal", "last_signal_at", "error_count", "retry_count",
      "held_at", "waiting_for",
    ];
    for (const field of expected) {
      expect(ALLOWED_FIELDS.has(field)).toBe(true);
    }
  });

  test("contains new registry fields: implement_phase_plan, repo_id, repo_path", () => {
    expect(ALLOWED_FIELDS.has("implement_phase_plan")).toBe(true);
    expect(ALLOWED_FIELDS.has("repo_id")).toBe(true);
    expect(ALLOWED_FIELDS.has("repo_path")).toBe(true);
  });

  test("rejects unknown fields", () => {
    expect(ALLOWED_FIELDS.has("bogus_field")).toBe(false);
    expect(ALLOWED_FIELDS.has("ticket_id")).toBe(false);
  });
});

// ============================================================================
// parseFieldValue — JSON value support
// ============================================================================

describe("parseFieldValue — JSON values", () => {
  test("parses JSON object value", () => {
    const result = parseFieldValue('implement_phase_plan={"total_phases":3,"current_impl_phase":1,"phase_names":[],"completed_impl_phases":[]}');
    expect(result).not.toBeNull();
    expect(result!.field).toBe("implement_phase_plan");
    expect(typeof result!.value).toBe("object");
    expect((result!.value as any).total_phases).toBe(3);
  });

  test("parses JSON array value", () => {
    const result = parseFieldValue("waiting_for=[\"BRE-100\",\"BRE-101\"]");
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.value)).toBe(true);
  });

  test("falls back to string for invalid JSON starting with {", () => {
    const result = parseFieldValue("status={not-valid-json");
    expect(result).not.toBeNull();
    expect(typeof result!.value).toBe("string");
    expect(result!.value).toBe("{not-valid-json");
  });
});

// ============================================================================
// advanceImplPhase
// ============================================================================

describe("advanceImplPhase", () => {
  const basePlan = {
    total_phases: 3,
    current_impl_phase: 1,
    phase_names: ["Phase 1", "Phase 2", "Phase 3"],
    completed_impl_phases: [],
  };

  test("appends current phase to completed and increments current", () => {
    const registry = { ticket_id: "BRE-100", implement_phase_plan: { ...basePlan } };
    const result = advanceImplPhase(registry);
    const plan = result.implement_phase_plan;
    expect(plan.current_impl_phase).toBe(2);
    expect(plan.completed_impl_phases).toEqual([1]);
  });

  test("advances from phase 2 to 3", () => {
    const registry = {
      ticket_id: "BRE-100",
      implement_phase_plan: { ...basePlan, current_impl_phase: 2, completed_impl_phases: [1] },
    };
    const result = advanceImplPhase(registry);
    expect(result.implement_phase_plan.current_impl_phase).toBe(3);
    expect(result.implement_phase_plan.completed_impl_phases).toEqual([1, 2]);
  });

  test("throws when no implement_phase_plan", () => {
    const registry = { ticket_id: "BRE-100" };
    expect(() => advanceImplPhase(registry)).toThrow("No implement_phase_plan");
  });

  test("does not mutate original registry", () => {
    const plan = { ...basePlan };
    const registry = { ticket_id: "BRE-100", implement_phase_plan: plan };
    advanceImplPhase(registry);
    expect(registry.implement_phase_plan.current_impl_phase).toBe(1);
    expect(registry.implement_phase_plan.completed_impl_phases).toEqual([]);
  });

  test("sets updated_at timestamp", () => {
    const registry = { ticket_id: "BRE-100", implement_phase_plan: { ...basePlan } };
    const result = advanceImplPhase(registry);
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ============================================================================
// deleteField
// ============================================================================

describe("deleteField", () => {
  test("removes the specified field", () => {
    const registry = { ticket_id: "BRE-100", implement_phase_plan: { total_phases: 3 }, status: "running" };
    const result = deleteField(registry, "implement_phase_plan");
    expect(result.implement_phase_plan).toBeUndefined();
    expect(result.status).toBe("running");
    expect(result.ticket_id).toBe("BRE-100");
  });

  test("no-ops when field does not exist", () => {
    const registry = { ticket_id: "BRE-100", status: "running" };
    const result = deleteField(registry, "implement_phase_plan");
    expect(result.implement_phase_plan).toBeUndefined();
    expect(result.status).toBe("running");
  });

  test("sets updated_at timestamp", () => {
    const registry = { ticket_id: "BRE-100", foo: "bar" };
    const result = deleteField(registry, "foo");
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("does not mutate original registry", () => {
    const registry = { ticket_id: "BRE-100", implement_phase_plan: { total_phases: 3 } };
    deleteField(registry, "implement_phase_plan");
    expect(registry.implement_phase_plan).toBeDefined();
  });
});
