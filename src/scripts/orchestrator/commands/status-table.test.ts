import { describe, test, expect } from "bun:test";
import { deriveStatus, deriveDetail } from "./status-table";

describe("status-table: deriveStatus()", () => {
  test("1. explicit status field wins", () => {
    expect(deriveStatus({ status: "held" })).toBe("held");
  });

  test("2. no status, no last_signal → running", () => {
    expect(deriveStatus({ current_step: "clarify" })).toBe("running");
  });

  test("3. CLARIFY_COMPLETE → completed", () => {
    expect(deriveStatus({ last_signal: "CLARIFY_COMPLETE" })).toBe("completed");
  });

  test("4. BLINDQA_FAILED → failed", () => {
    expect(deriveStatus({ last_signal: "BLINDQA_FAILED" })).toBe("failed");
  });

  test("5. PLAN_ERROR → error", () => {
    expect(deriveStatus({ last_signal: "PLAN_ERROR" })).toBe("error");
  });

  test("6. CLARIFY_QUESTION → needs_input", () => {
    expect(deriveStatus({ last_signal: "CLARIFY_QUESTION" })).toBe("needs_input");
  });
});

describe("status-table: deriveDetail()", () => {
  test("7. held status shows waiting_for (truncated to COL_DETAIL=30)", () => {
    const detail = deriveDetail({ status: "held", waiting_for: "BRE-200:plan" });
    expect(detail).toContain("held");
    expect(detail).toContain("BRE-200");
    expect(detail.length).toBeLessThanOrEqual(30);
  });

  test("8. last_signal + last_signal_at shows signal info", () => {
    const detail = deriveDetail({
      last_signal: "CLARIFY_COMPLETE",
      last_signal_at: "2026-01-01T00:00:00Z",
    });
    expect(detail).toContain("CLARIFY_COMPLETE");
  });

  test("9. no signal info shows phase name", () => {
    const detail = deriveDetail({ current_step: "implement" });
    expect(detail).toContain("implement");
  });
});
