// useMindsState.test.ts — Unit tests for useMindsState hook (BRE-456 T002)

import { describe, test, expect, mock } from "bun:test";

// Capture initial values passed to useState before importing the hook
const capturedInits: unknown[] = [];

mock.module("react", () => ({
  useState: (init: unknown) => {
    capturedInits.push(typeof init === "function" ? (init as () => unknown)() : init);
    return [init, () => {}];
  },
  useEffect: (_fn: () => unknown) => {
    // Do not run effects in unit tests
  },
}));

const { useMindsState } = await import("./useMindsState.js");

describe("useMindsState — initial state", () => {
  test("initial states is an empty array", () => {
    capturedInits.length = 0;
    useMindsState();
    // First useState call is for `states`
    expect(capturedInits[0]).toEqual([]);
  });

  test("initial activeTicket is null (no mock data)", () => {
    capturedInits.length = 0;
    useMindsState();
    // Second useState call is for `activeTicket`
    expect(capturedInits[1]).toBeNull();
  });

  test("initial connected is false", () => {
    capturedInits.length = 0;
    useMindsState();
    // Third useState call is for `connected`
    expect(capturedInits[2]).toBe(false);
  });

  test("returns expected shape with null activeTicket when no SSE data arrives", () => {
    const result = useMindsState();
    expect(result).toMatchObject({
      states: [],
      activeTicket: null,
      connected: false,
    });
    expect(typeof result.setActiveTicket).toBe("function");
  });
});
