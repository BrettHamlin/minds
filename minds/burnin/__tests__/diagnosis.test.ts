import { describe, test, expect } from "bun:test";
import { diagnoseFailure } from "../lib/diagnosis.ts";

describe("diagnosis", () => {
  // ── Bus failures ───────────────────────────────────────────────────

  test("1. classifies bus startup timeout", () => {
    const result = diagnoseFailure("Error starting bus: timeout after 5s");
    expect(result.category).toBe("bus_failure");
    expect(result.suggestedFiles).toContain("minds/transport/minds-bus-lifecycle.ts");
  });

  test("2. classifies bus server exit", () => {
    const result = diagnoseFailure("bus server exited unexpectedly (code 1)");
    expect(result.category).toBe("bus_failure");
  });

  test("3. classifies bus spawn error", () => {
    const result = diagnoseFailure("bus server spawn error: EADDRINUSE");
    expect(result.category).toBe("bus_failure");
  });

  // ── Merge conflicts ────────────────────────────────────────────────

  test("4. classifies merge conflict", () => {
    const result = diagnoseFailure("CONFLICT (content): Merge conflict in src/index.ts");
    expect(result.category).toBe("merge_conflict");
    expect(result.suggestedFiles).toContain("minds/lib/merge-drone.ts");
  });

  test("5. classifies merge failure", () => {
    const result = diagnoseFailure("Merge failed for minds/pipeline_core branch");
    expect(result.category).toBe("merge_conflict");
  });

  // ── Boundary violations ────────────────────────────────────────────

  test("6. classifies boundary violation", () => {
    const result = diagnoseFailure("BOUNDARY_VIOLATION: @pipeline_core modified src/auth.ts");
    expect(result.category).toBe("boundary_violation");
    expect(result.suggestedFiles).toContain("minds/lib/supervisor/boundary-check.ts");
  });

  test("7. classifies 'outside your boundary' message", () => {
    const result = diagnoseFailure("You modified src/auth.ts, which is outside your boundary");
    expect(result.category).toBe("boundary_violation");
  });

  // ── Contract errors ────────────────────────────────────────────────

  test("8. classifies contract error", () => {
    const result = diagnoseFailure("dangling_consume: @signals consumes interface not produced");
    expect(result.category).toBe("contract_error");
    expect(result.suggestedFiles).toContain("minds/lib/contracts.ts");
  });

  test("9. classifies ownership overlap", () => {
    const result = diagnoseFailure("ownership_overlap: src/shared/ claimed by two minds");
    expect(result.category).toBe("contract_error");
  });

  // ── Task lint ──────────────────────────────────────────────────────

  test("10. classifies task lint failure via 'valid.*false'", () => {
    const result = diagnoseFailure("Lint result: valid: false, 3 errors");
    expect(result.category).toBe("task_lint");
    expect(result.suggestedFiles).toContain("minds/cli/lib/task-parser.ts");
  });

  test("11. classifies task lint failure via 'still failing after'", () => {
    const result = diagnoseFailure("Lint check still failing after 5 attempts");
    expect(result.category).toBe("task_lint");
  });

  // ── Task generation ────────────────────────────────────────────────

  test("12. classifies task generation failure", () => {
    const result = diagnoseFailure("failed to generate tasks for BRE-675");
    expect(result.category).toBe("task_generation");
    expect(result.suggestedFiles).toContain("minds/commands/tasks.md");
  });

  // ── Drone failures ─────────────────────────────────────────────────

  test("13. classifies drone crash", () => {
    const result = diagnoseFailure("drone exited unexpectedly with code 1");
    expect(result.category).toBe("drone_crash");
    expect(result.suggestedFiles).toContain("minds/lib/drone-pane.ts");
  });

  test("14. classifies drone stall via 'Wave N did not complete'", () => {
    const result = diagnoseFailure("Wave 2 did not complete within timeout");
    expect(result.category).toBe("drone_stall");
    expect(result.suggestedFiles).toContain("minds/lib/supervisor/mind-supervisor.ts");
  });

  test("15. classifies drone timeout", () => {
    const result = diagnoseFailure("drone timeout: no response after 20 minutes");
    expect(result.category).toBe("drone_stall");
  });

  // ── Timeout ────────────────────────────────────────────────────────

  test("16. classifies generic timeout", () => {
    const result = diagnoseFailure("Operation timed out after 300s");
    expect(result.category).toBe("timeout");
    expect(result.suggestedFiles).toContain("minds/lib/supervisor/mind-supervisor.ts");
  });

  // ── Unknown ────────────────────────────────────────────────────────

  test("17. classifies unknown failure", () => {
    const result = diagnoseFailure("Something completely unexpected happened\nNo known patterns");
    expect(result.category).toBe("unknown");
    expect(result.summary).toContain("Unclassified");
  });

  // ── Multi-pane diagnosis ───────────────────────────────────────────

  test("18. diagnoses from secondary pane output", () => {
    const result = diagnoseFailure(
      "Main pane: everything looks fine",
      { "%2": "Error starting bus: EADDRINUSE on port 9999" },
    );
    expect(result.category).toBe("bus_failure");
  });

  test("19. preserves allPaneOutputs in diagnosis", () => {
    const panes = { "%1": "main output", "%2": "drone output" };
    const result = diagnoseFailure("Merge failed", panes);
    expect(result.allPaneOutputs).toEqual(panes);
  });

  // ── Summary extraction ─────────────────────────────────────────────

  test("20. extracts summary near the matching pattern", () => {
    const output = [
      "Line 1: starting up",
      "Line 2: connecting to bus",
      "Line 3: Error starting bus: connection refused",
      "Line 4: retrying...",
      "Line 5: giving up",
    ].join("\n");

    const result = diagnoseFailure(output);
    expect(result.summary).toContain("Error starting bus");
    expect(result.summary).toContain("connecting to bus");
  });
});
