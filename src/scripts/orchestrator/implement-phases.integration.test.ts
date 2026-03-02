/**
 * Integration tests for the phased implementation flow.
 *
 * Tests the interaction between implement_phase_plan, registry state,
 * status-table rendering, and phase dispatch command building across
 * the full lifecycle of a phased implementation.
 *
 * Also includes E2E tests for verify-and-complete.sh phase-scoping that
 * invoke the real script with CHECK_ONLY=1 to skip signal emission.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { writeJsonAtomic, readJsonFile } from "../../lib/pipeline";
import { deriveDetail } from "./commands/status-table";
import { buildDispatchCommand } from "./commands/phase-dispatch";
import type { ImplementPhasePlan } from "../../lib/pipeline/registry";

// ---------------------------------------------------------------------------
// Helper: invoke the real verify-and-complete.sh with CHECK_ONLY=1 to count
// incomplete tasks without emitting a signal.
// ---------------------------------------------------------------------------

const SCRIPT_PATH = path.resolve(import.meta.dir, "../verify-and-complete.ts");

/**
 * Run verify-and-complete.sh implement <scope> with CHECK_ONLY=1, using
 * tasksPath's directory as REPO_ROOT (git not required — script falls back
 * to pwd when outside a git repo).
 *
 * Returns the number of incomplete '- [ ]' tasks in the scoped section:
 *   scope == null   → all phases counted
 *   scope == "2"    → only ## Phase 2: section
 *   scope == "1-4"  → ## Phase 1: through ## Phase 4: sections
 *
 * The script already prints "[VerifyComplete] ❌ N incomplete tasks remaining"
 * when N > 0 and exits 1, so we parse that line. When all tasks are complete
 * the script exits 0 with CHECK_ONLY, meaning count == 0.
 */
function countIncomplete(tasksPath: string, scope: string | null): number {
  const args = ["bun", SCRIPT_PATH, "implement", "check-only-test-message"];
  if (scope !== null) args.push(scope);

  const result = Bun.spawnSync(args, {
    cwd: path.dirname(tasksPath),
    env: { ...process.env, CHECK_ONLY: "1" },
  });

  if (result.exitCode === 0) return 0;

  // Exit 1: parse N from "[VerifyComplete] ❌ N incomplete tasks remaining"
  const output = result.stdout.toString();
  const match = output.match(/❌ (\d+) incomplete/);
  return match ? parseInt(match[1], 10) : -1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: "BRE-TEST",
    nonce: "abc123",
    current_step: "implement",
    status: "running",
    agent_pane_id: "%1",
    ...overrides,
  };
}

function makePhasePlan(
  total: number,
  current: number,
  completed: number[] = []
): ImplementPhasePlan {
  const phase_names = Array.from({ length: total }, (_, i) => `Phase ${i + 1}: Step`);
  return { total_phases: total, current_impl_phase: current, phase_names, completed_impl_phases: completed };
}

// ---------------------------------------------------------------------------
// Registry + status-table integration
// ---------------------------------------------------------------------------

describe("phased implement: registry state → status-table rendering", () => {
  test("1. phase 1 of 5: status-table shows 'impl 1/5'", () => {
    const reg = makeRegistry({ implement_phase_plan: makePhasePlan(5, 1) });
    expect(deriveDetail(reg)).toBe("impl 1/5");
  });

  test("2. phase 3 of 5: status-table shows 'impl 3/5'", () => {
    const reg = makeRegistry({ implement_phase_plan: makePhasePlan(5, 3, [1, 2]) });
    expect(deriveDetail(reg)).toBe("impl 3/5");
  });

  test("3. final phase 5 of 5: status-table shows 'impl 5/5'", () => {
    const reg = makeRegistry({ implement_phase_plan: makePhasePlan(5, 5, [1, 2, 3, 4]) });
    expect(deriveDetail(reg)).toBe("impl 5/5");
  });

  test("4. after plan cleared (all phases done): falls back to last_signal", () => {
    const reg = makeRegistry({
      // No implement_phase_plan — cleared after completion
      last_signal: "IMPLEMENT_COMPLETE",
      last_signal_at: "2026-01-01T12:00:00Z",
    });
    const detail = deriveDetail(reg);
    expect(detail).toContain("IMPLEMENT_COMPLETE");
    expect(detail).not.toContain("impl");
  });

  test("5. not in implement phase: phase plan is ignored", () => {
    const reg = makeRegistry({
      current_step: "blindqa",
      implement_phase_plan: makePhasePlan(3, 3, [1, 2]),
    });
    const detail = deriveDetail(reg);
    expect(detail).not.toContain("impl");
  });
});

// ---------------------------------------------------------------------------
// Phase dispatch command building for phased implement
// ---------------------------------------------------------------------------

describe("phased implement: phase-dispatch --args command building", () => {
  test("6. dispatch phase 1 of 3", () => {
    const cmd = buildDispatchCommand("/collab.implement", "phase:1");
    expect(cmd).toBe("/collab.implement phase:1");
  });

  test("7. dispatch phase 2 of 3", () => {
    const cmd = buildDispatchCommand("/collab.implement", "phase:2");
    expect(cmd).toBe("/collab.implement phase:2");
  });

  test("8. dispatch with range (phases 1-4)", () => {
    const cmd = buildDispatchCommand("/collab.implement", "phase:1-4");
    expect(cmd).toBe("/collab.implement phase:1-4");
  });

  test("9. final phase dispatch", () => {
    const cmd = buildDispatchCommand("/collab.implement", "phase:5");
    expect(cmd).toBe("/collab.implement phase:5");
  });

  test("10. no phase arg produces clean command (< 3 phases path)", () => {
    const cmd = buildDispatchCommand("/collab.implement", null);
    expect(cmd).toBe("/collab.implement");
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle simulation (registry read/write)
// ---------------------------------------------------------------------------

describe("phased implement: full lifecycle via registry files", () => {
  let tmpDir: string;
  let registryDir: string;
  let regPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-phases-"));
    registryDir = path.join(tmpDir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    regPath = path.join(registryDir, "BRE-PHASE.json");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("11. initial registry has no implement_phase_plan", () => {
    const reg = makeRegistry({ ticket_id: "BRE-PHASE" });
    writeJsonAtomic(regPath, reg);
    const loaded = readJsonFile(regPath)!;
    expect(loaded.implement_phase_plan).toBeUndefined();
  });

  test("12. writing implement_phase_plan persists correctly", () => {
    const reg = readJsonFile(regPath)!;
    const plan = makePhasePlan(4, 1);
    writeJsonAtomic(regPath, { ...reg, implement_phase_plan: plan });

    const loaded = readJsonFile(regPath)! as Record<string, any>;
    expect(loaded.implement_phase_plan).toBeDefined();
    expect(loaded.implement_phase_plan.total_phases).toBe(4);
    expect(loaded.implement_phase_plan.current_impl_phase).toBe(1);
    expect(loaded.implement_phase_plan.completed_impl_phases).toEqual([]);
  });

  test("13. advancing phase updates current_impl_phase and completed list", () => {
    const reg = readJsonFile(regPath)! as Record<string, any>;
    const plan = reg.implement_phase_plan as ImplementPhasePlan;

    const updated = {
      ...reg,
      implement_phase_plan: {
        ...plan,
        current_impl_phase: plan.current_impl_phase + 1,
        completed_impl_phases: [...plan.completed_impl_phases, plan.current_impl_phase],
      },
    };
    writeJsonAtomic(regPath, updated);

    const loaded = readJsonFile(regPath)! as Record<string, any>;
    expect(loaded.implement_phase_plan.current_impl_phase).toBe(2);
    expect(loaded.implement_phase_plan.completed_impl_phases).toEqual([1]);
    expect(deriveDetail(loaded)).toBe("impl 2/4");
  });

  test("14. deleting implement_phase_plan (all phases done) restores normal detail", () => {
    const reg = readJsonFile(regPath)! as Record<string, any>;
    const { implement_phase_plan: _removed, ...cleanReg } = reg;
    const withSignal = {
      ...cleanReg,
      last_signal: "IMPLEMENT_COMPLETE",
      last_signal_at: "2026-03-01T10:00:00Z",
    };
    writeJsonAtomic(regPath, withSignal);

    const loaded = readJsonFile(regPath)! as Record<string, any>;
    expect(loaded.implement_phase_plan).toBeUndefined();
    expect(deriveDetail(loaded)).toContain("IMPLEMENT_COMPLETE");
  });
});

// ---------------------------------------------------------------------------
// E2E: verify-and-complete.sh awk phase-scope logic
// ---------------------------------------------------------------------------

// Sample tasks.md with 3 phases, mixed complete/incomplete tasks:
//
//   Phase 1: 2 complete, 1 incomplete
//   Phase 2: 1 complete, 2 incomplete
//   Phase 3: 2 complete, 0 incomplete
//
// Total incomplete across all phases: 3
const TASKS_MD = `# Implementation Tasks

## Phase 1: Setup
- [X] Task 1.1 done
- [X] Task 1.2 done
- [ ] Task 1.3 pending

## Phase 2: Core
- [X] Task 2.1 done
- [ ] Task 2.2 pending
- [ ] Task 2.3 pending

## Phase 3: Polish
- [X] Task 3.1 done
- [X] Task 3.2 done
`;

describe("verify-and-complete.sh: phase-scope awk logic (E2E)", () => {
  let tasksFile: string;

  beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "collab-awk-"));
    tasksFile = path.join(tmp, "tasks.md");
    fs.writeFileSync(tasksFile, TASKS_MD);
  });

  afterAll(() => {
    fs.rmSync(path.dirname(tasksFile), { recursive: true, force: true });
  });

  test("15. unscoped: counts all 3 incomplete tasks across all phases", () => {
    expect(countIncomplete(tasksFile, null)).toBe(3);
  });

  test("16. single phase scope '1': counts 1 incomplete task in Phase 1", () => {
    expect(countIncomplete(tasksFile, "1")).toBe(1);
  });

  test("17. single phase scope '2': counts 2 incomplete tasks in Phase 2", () => {
    expect(countIncomplete(tasksFile, "2")).toBe(2);
  });

  test("18. single phase scope '3': counts 0 incomplete tasks in Phase 3", () => {
    expect(countIncomplete(tasksFile, "3")).toBe(0);
  });

  test("19. range scope '1-2': counts 3 incomplete tasks across Phases 1 and 2", () => {
    expect(countIncomplete(tasksFile, "1-2")).toBe(3);
  });

  test("20. range scope '2-3': counts 2 incomplete tasks across Phases 2 and 3", () => {
    expect(countIncomplete(tasksFile, "2-3")).toBe(2);
  });

  test("21. range scope '1-3': counts all 3 incomplete tasks (full range)", () => {
    expect(countIncomplete(tasksFile, "1-3")).toBe(3);
  });

  test("22. single phase scope '4' (non-existent): counts 0", () => {
    expect(countIncomplete(tasksFile, "4")).toBe(0);
  });
});
