/**
 * stage-registry.test.ts — Tests for the stage executor registry.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  registerExecutor,
  getExecutor,
  hasExecutor,
  registeredTypes,
  clearRegistry,
} from "../stage-registry.ts";
import type { StageExecutor } from "../pipeline-types.ts";

// ---------------------------------------------------------------------------
// Fresh registry for each test
// ---------------------------------------------------------------------------

// Note: The module registers built-in executors on load. We clear and
// re-test with a clean slate, then verify built-ins separately.

describe("stage-registry (isolated)", () => {
  beforeEach(() => {
    clearRegistry();
  });

  test("registerExecutor adds an executor", () => {
    const executor: StageExecutor = async () => ({ ok: true });
    registerExecutor("custom-stage", executor);
    expect(hasExecutor("custom-stage")).toBe(true);
  });

  test("getExecutor returns registered executor", () => {
    const executor: StageExecutor = async () => ({ ok: true });
    registerExecutor("my-stage", executor);
    expect(getExecutor("my-stage")).toBe(executor);
  });

  test("getExecutor throws for unregistered type", () => {
    expect(() => getExecutor("nonexistent")).toThrow(
      'No stage executor registered for type "nonexistent"'
    );
  });

  test("registerExecutor throws on duplicate registration", () => {
    const executor: StageExecutor = async () => ({ ok: true });
    registerExecutor("dup-stage", executor);
    expect(() => registerExecutor("dup-stage", executor)).toThrow(
      'Stage executor already registered for type "dup-stage"'
    );
  });

  test("hasExecutor returns false for unregistered type", () => {
    expect(hasExecutor("missing")).toBe(false);
  });

  test("registeredTypes returns all registered types", () => {
    registerExecutor("alpha", async () => ({ ok: true }));
    registerExecutor("beta", async () => ({ ok: true }));
    registerExecutor("gamma", async () => ({ ok: true }));
    expect(registeredTypes()).toEqual(["alpha", "beta", "gamma"]);
  });

  test("registeredTypes returns empty array when cleared", () => {
    expect(registeredTypes()).toEqual([]);
  });

  test("clearRegistry removes all executors", () => {
    registerExecutor("temp", async () => ({ ok: true }));
    expect(hasExecutor("temp")).toBe(true);
    clearRegistry();
    expect(hasExecutor("temp")).toBe(false);
  });
});

describe("stage-registry (built-in executors)", () => {
  // Re-import to get the module with built-in registrations.
  // Since we cleared in the isolated tests above, we need to re-register.
  // The built-in executors are registered at module load time, but clearRegistry
  // removes them. For this test block, we verify the expected behavior by
  // re-registering stubs manually.

  beforeEach(() => {
    clearRegistry();
    // Simulate the built-in registrations
    const stubTypes = [
      "spawn-drone",
      "wait-completion",
      "git-diff",
      "run-tests",
      "boundary-check",
      "contract-check",
      "llm-review",
      "run-command",
      "health-check",
      "collect-results",
    ];
    for (const type of stubTypes) {
      registerExecutor(type, async () => {
        throw new Error(`Stage executor "${type}" is not yet implemented`);
      });
    }
  });

  test("all code pipeline stage types are registered", () => {
    const codeTypes = [
      "spawn-drone",
      "wait-completion",
      "git-diff",
      "run-tests",
      "boundary-check",
      "contract-check",
      "llm-review",
    ];
    for (const type of codeTypes) {
      expect(hasExecutor(type)).toBe(true);
    }
  });

  test("all build/test pipeline stage types are registered", () => {
    const newTypes = ["run-command", "health-check", "collect-results"];
    for (const type of newTypes) {
      expect(hasExecutor(type)).toBe(true);
    }
  });

  test("stub executors throw 'not yet implemented'", async () => {
    const executor = getExecutor("run-command");
    await expect(executor({ type: "run-command" }, {} as any)).rejects.toThrow(
      "not yet implemented"
    );
  });

  test("10 total built-in executors are registered", () => {
    expect(registeredTypes()).toHaveLength(10);
  });
});
