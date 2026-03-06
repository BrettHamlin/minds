import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { deriveStatus, deriveDetail, renderTable } from "./status-table";

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

  test("10. implement + implement_phase_plan shows 'impl N/M'", () => {
    const detail = deriveDetail({
      current_step: "implement",
      implement_phase_plan: { total_phases: 5, current_impl_phase: 2, phase_names: [], completed_impl_phases: [1] },
    });
    expect(detail).toBe("impl 2/5");
  });

  test("11. implement phase plan on first phase shows 'impl 1/3'", () => {
    const detail = deriveDetail({
      current_step: "implement",
      implement_phase_plan: { total_phases: 3, current_impl_phase: 1, phase_names: [], completed_impl_phases: [] },
    });
    expect(detail).toBe("impl 1/3");
  });

  test("12. implement_phase_plan without current_step==implement falls back to normal", () => {
    const detail = deriveDetail({
      current_step: "plan",
      implement_phase_plan: { total_phases: 5, current_impl_phase: 2, phase_names: [], completed_impl_phases: [1] },
    });
    // Should not show impl progress since we're not in implement phase
    expect(detail).not.toContain("impl");
    expect(detail).toContain("plan");
  });

  test("13. held takes priority over implement_phase_plan", () => {
    const detail = deriveDetail({
      status: "held",
      waiting_for: "BRE-300:plan",
      current_step: "implement",
      implement_phase_plan: { total_phases: 3, current_impl_phase: 1, phase_names: [], completed_impl_phases: [] },
    });
    expect(detail).toContain("held");
    expect(detail).not.toContain("impl");
  });
});

// ---------------------------------------------------------------------------
// renderTable multi-repo tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-status-"));
  fs.mkdirSync(path.join(tmpDir, "registry"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "groups"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("status-table: renderTable() multi-repo", () => {
  test("14. without multi-repo config → no Repo column in header", () => {
    const table = renderTable(
      path.join(tmpDir, "registry"),
      path.join(tmpDir, "groups")
    );
    expect(table).not.toContain("Repo");
  });

  test("15. with multi-repo config present → Repo column in header", () => {
    const multiRepoPath = path.join(tmpDir, "multi-repo.json");
    fs.writeFileSync(multiRepoPath, JSON.stringify({ repos: { backend: { path: "/some/path" } } }));

    const table = renderTable(
      path.join(tmpDir, "registry"),
      path.join(tmpDir, "groups"),
      { multiRepoConfigPath: multiRepoPath }
    );
    expect(table).toContain("Repo");

    fs.unlinkSync(multiRepoPath);
  });

  test("16. multi-repo table shows repo_id from registry", () => {
    const multiRepoPath = path.join(tmpDir, "multi-repo.json");
    fs.writeFileSync(multiRepoPath, JSON.stringify({ repos: { frontend: { path: "/some/path" } } }));

    const regFile = path.join(tmpDir, "registry", "BRE-500.json");
    fs.writeFileSync(
      regFile,
      JSON.stringify({
        ticket_id: "BRE-500",
        current_step: "clarify",
        repo_id: "frontend",
        nonce: "aa00",
      })
    );

    const table = renderTable(
      path.join(tmpDir, "registry"),
      path.join(tmpDir, "groups"),
      { multiRepoConfigPath: multiRepoPath }
    );
    expect(table).toContain("frontend");

    fs.unlinkSync(multiRepoPath);
    fs.unlinkSync(regFile);
  });

  test("17. multi-repo config path that does not exist → no Repo column", () => {
    const table = renderTable(
      path.join(tmpDir, "registry"),
      path.join(tmpDir, "groups"),
      { multiRepoConfigPath: "/nonexistent/multi-repo.json" }
    );
    expect(table).not.toContain("Repo");
  });
});
