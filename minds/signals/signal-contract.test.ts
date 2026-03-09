import { describe, test, expect } from "bun:test";
import {
  isSuccessSignal,
  CLARIFY_COMPLETE,
  CLARIFY_QUESTION,
  CLARIFY_ERROR,
  CLARIFY_QUESTIONS,
} from "./pipeline-signal";

describe("clarify signal constants", () => {
  test("CLARIFY_COMPLETE is the string 'CLARIFY_COMPLETE'", () => {
    expect(CLARIFY_COMPLETE).toBe("CLARIFY_COMPLETE");
  });

  test("CLARIFY_QUESTION is the string 'CLARIFY_QUESTION'", () => {
    expect(CLARIFY_QUESTION).toBe("CLARIFY_QUESTION");
  });

  test("CLARIFY_ERROR is the string 'CLARIFY_ERROR'", () => {
    expect(CLARIFY_ERROR).toBe("CLARIFY_ERROR");
  });

  test("CLARIFY_QUESTIONS is the string 'CLARIFY_QUESTIONS'", () => {
    expect(CLARIFY_QUESTIONS).toBe("CLARIFY_QUESTIONS");
  });

  test("CLARIFY_COMPLETE is a success signal", () => {
    expect(isSuccessSignal(CLARIFY_COMPLETE)).toBe(true);
  });

  test("CLARIFY_QUESTION is not a success signal (it is informational)", () => {
    expect(isSuccessSignal(CLARIFY_QUESTION)).toBe(false);
  });

  test("CLARIFY_ERROR is not a success signal", () => {
    expect(isSuccessSignal(CLARIFY_ERROR)).toBe(false);
  });

  test("CLARIFY_QUESTIONS is not a success signal (it is informational)", () => {
    expect(isSuccessSignal(CLARIFY_QUESTIONS)).toBe(false);
  });
});
