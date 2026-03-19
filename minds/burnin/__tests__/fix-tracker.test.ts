import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import os from "os";
import {
  createSession,
  loadSession,
  saveSession,
  getTicketState,
  recordAttempt,
  advanceTicket,
  consecutiveSameCategoryCount,
  type Diagnosis,
} from "../lib/fix-tracker.ts";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), "burnin-fix-tracker-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const makeDiagnosis = (category: Diagnosis["category"] = "unknown"): Diagnosis => ({
  category,
  summary: "test failure",
  rawOutput: "error output",
  allPaneOutputs: {},
  suggestedFiles: [],
});

describe("fix-tracker", () => {
  test("1. createSession creates state file and returns valid state", () => {
    const state = createSession(tmpDir, "/path/to/repo", ["BRE-100", "BRE-101"]);

    expect(state.sessionId).toBeTruthy();
    expect(state.targetRepo).toBe("/path/to/repo");
    expect(state.tickets).toHaveLength(2);
    expect(state.tickets[0].ticketId).toBe("BRE-100");
    expect(state.tickets[0].phase).toBe("pending");
    expect(state.tickets[0].attempts).toHaveLength(0);
    expect(state.tickets[1].ticketId).toBe("BRE-101");

    // Verify file was written
    const filePath = join(tmpDir, ".minds", "state", `burnin-${state.sessionId}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  test("2. loadSession returns null for non-existent session", () => {
    const result = loadSession(tmpDir, "nonexistent");
    expect(result).toBeNull();
  });

  test("3. loadSession returns saved state", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-200"]);
    const loaded = loadSession(tmpDir, state.sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(state.sessionId);
    expect(loaded!.tickets).toHaveLength(1);
    expect(loaded!.tickets[0].ticketId).toBe("BRE-200");
  });

  test("4. saveSession persists changes", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-300"]);
    state.tickets[0].phase = "tasks";
    saveSession(tmpDir, state);

    const loaded = loadSession(tmpDir, state.sessionId);
    expect(loaded!.tickets[0].phase).toBe("tasks");
  });

  test("5. getTicketState returns correct ticket", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-400", "BRE-401"]);
    const ticket = getTicketState(state, "BRE-401");

    expect(ticket).toBeDefined();
    expect(ticket!.ticketId).toBe("BRE-401");
  });

  test("6. getTicketState returns undefined for missing ticket", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-500"]);
    expect(getTicketState(state, "BRE-999")).toBeUndefined();
  });

  test("7. recordAttempt adds attempt with auto-number and timestamp", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-600"]);

    const updated = recordAttempt(state, "BRE-600", {
      phase: "tasks",
      diagnosis: makeDiagnosis("task_lint"),
      fixDescription: "fixed lint error",
      outcome: "failure",
    });

    expect(updated.tickets[0].attempts).toHaveLength(1);
    expect(updated.tickets[0].attempts[0].attemptNumber).toBe(1);
    expect(updated.tickets[0].attempts[0].phase).toBe("tasks");
    expect(updated.tickets[0].attempts[0].diagnosis.category).toBe("task_lint");
    expect(updated.tickets[0].attempts[0].timestamp).toBeTruthy();
  });

  test("8. recordAttempt increments attempt number", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-700"]);

    recordAttempt(state, "BRE-700", {
      phase: "tasks",
      diagnosis: makeDiagnosis(),
      fixDescription: "first fix",
      outcome: "failure",
    });
    recordAttempt(state, "BRE-700", {
      phase: "tasks",
      diagnosis: makeDiagnosis(),
      fixDescription: "second fix",
      outcome: "success",
    });

    expect(state.tickets[0].attempts).toHaveLength(2);
    expect(state.tickets[0].attempts[0].attemptNumber).toBe(1);
    expect(state.tickets[0].attempts[1].attemptNumber).toBe(2);
  });

  test("9. recordAttempt throws for unknown ticket", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-800"]);
    expect(() =>
      recordAttempt(state, "BRE-UNKNOWN", {
        phase: "tasks",
        diagnosis: makeDiagnosis(),
        fixDescription: "",
        outcome: "failure",
      }),
    ).toThrow("Ticket BRE-UNKNOWN not found");
  });

  test("10. advanceTicket updates phase", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-900"]);

    advanceTicket(state, "BRE-900", "tasks");
    expect(state.tickets[0].phase).toBe("tasks");

    advanceTicket(state, "BRE-900", "implement");
    expect(state.tickets[0].phase).toBe("implement");

    advanceTicket(state, "BRE-900", "done");
    expect(state.tickets[0].phase).toBe("done");
  });

  test("11. advanceTicket throws for unknown ticket", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-1000"]);
    expect(() => advanceTicket(state, "NOPE", "tasks")).toThrow("Ticket NOPE not found");
  });

  test("12. consecutiveSameCategoryCount counts trailing same-category attempts", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-1100"]);

    recordAttempt(state, "BRE-1100", {
      phase: "implement",
      diagnosis: makeDiagnosis("merge_conflict"),
      fixDescription: "",
      outcome: "failure",
    });
    recordAttempt(state, "BRE-1100", {
      phase: "implement",
      diagnosis: makeDiagnosis("bus_failure"),
      fixDescription: "",
      outcome: "failure",
    });
    recordAttempt(state, "BRE-1100", {
      phase: "implement",
      diagnosis: makeDiagnosis("bus_failure"),
      fixDescription: "",
      outcome: "failure",
    });
    recordAttempt(state, "BRE-1100", {
      phase: "implement",
      diagnosis: makeDiagnosis("bus_failure"),
      fixDescription: "",
      outcome: "failure",
    });

    expect(consecutiveSameCategoryCount(state, "BRE-1100", "bus_failure")).toBe(3);
    expect(consecutiveSameCategoryCount(state, "BRE-1100", "merge_conflict")).toBe(0);
  });

  test("13. consecutiveSameCategoryCount returns 0 for unknown ticket", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-1200"]);
    expect(consecutiveSameCategoryCount(state, "NOPE", "unknown")).toBe(0);
  });

  test("14. full lifecycle: create → tasks → implement → done", () => {
    const state = createSession(tmpDir, "/repo", ["BRE-1300"]);

    advanceTicket(state, "BRE-1300", "tasks");
    advanceTicket(state, "BRE-1300", "implement");
    recordAttempt(state, "BRE-1300", {
      phase: "implement",
      diagnosis: makeDiagnosis("drone_stall"),
      fixDescription: "increased timeout",
      fixCommit: "abc123",
      outcome: "success",
    });
    advanceTicket(state, "BRE-1300", "done");

    saveSession(tmpDir, state);
    const loaded = loadSession(tmpDir, state.sessionId)!;

    expect(loaded.tickets[0].phase).toBe("done");
    expect(loaded.tickets[0].attempts).toHaveLength(1);
    expect(loaded.tickets[0].attempts[0].fixCommit).toBe("abc123");
  });
});
