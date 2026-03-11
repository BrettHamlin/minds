/**
 * resolve-owns.test.ts — Unit tests for owns: precedence and requireBoundary
 * flag resolution in the implement dispatcher (T016).
 *
 * Tests the extracted resolveOwnsAndBoundary() function which implements:
 *   T011: owns: precedence — task annotation > registry > undefined
 *   T012: requireBoundary — true for unregistered minds
 */

import { describe, expect, it } from "bun:test";
import { resolveOwnsAndBoundary, type RegistryEntry } from "./resolve-owns.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REGISTRY: RegistryEntry[] = [
  { name: "api_mind", owns_files: ["src/api/"] },
  { name: "core_mind", owns_files: ["src/core/**"] },
  { name: "bare_mind" }, // registered but no owns_files
];

// ─── T011: owns: precedence ─────────────────────────────────────────────────

describe("resolveOwnsAndBoundary — owns: precedence (T011)", () => {
  it("uses task owns: annotation when mind is NOT in registry", () => {
    // Scenario 1: new_mind has owns: in tasks but is not in registry
    const result = resolveOwnsAndBoundary(
      ["src/new/**"],
      REGISTRY,
      "new_mind",
    );

    expect(result.ownsFiles).toEqual(["src/new/**"]);
  });

  it("task owns: annotation wins over registry owns_files", () => {
    // Scenario 2: api_mind has owns: in tasks AND owns_files in registry
    // Task annotation should take precedence
    const result = resolveOwnsAndBoundary(
      ["src/new/**"],
      REGISTRY,
      "api_mind",
    );

    expect(result.ownsFiles).toEqual(["src/new/**"]);
  });

  it("falls back to registry owns_files when no task owns: annotation", () => {
    // Scenario 3: core_mind has no owns: in tasks but has owns_files in registry
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "core_mind",
    );

    expect(result.ownsFiles).toEqual(["src/core/**"]);
  });

  it("returns undefined when neither task annotation nor registry has owns_files", () => {
    // Mind is in registry but has no owns_files, and no task annotation
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "bare_mind",
    );

    expect(result.ownsFiles).toBeUndefined();
  });

  it("returns undefined for unregistered mind with no task annotation", () => {
    // Mind not in registry and no task annotation — completely unknown
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "unknown_mind",
    );

    expect(result.ownsFiles).toBeUndefined();
  });

  it("preserves multiple globs from task annotation", () => {
    const result = resolveOwnsAndBoundary(
      ["src/api/**", "src/models/**", "src/routes/**"],
      REGISTRY,
      "new_mind",
    );

    expect(result.ownsFiles).toEqual(["src/api/**", "src/models/**", "src/routes/**"]);
  });
});

// ─── T012: requireBoundary flag ─────────────────────────────────────────────

describe("resolveOwnsAndBoundary — requireBoundary (T012)", () => {
  it("sets requireBoundary true for unregistered mind", () => {
    const result = resolveOwnsAndBoundary(
      ["src/new/**"],
      REGISTRY,
      "new_mind",
    );

    expect(result.requireBoundary).toBe(true);
  });

  it("sets requireBoundary false for registered mind", () => {
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "api_mind",
    );

    expect(result.requireBoundary).toBe(false);
  });

  it("sets requireBoundary false for registered mind even with task annotation", () => {
    // api_mind is in registry, so requireBoundary is false regardless of
    // whether it has a task annotation override
    const result = resolveOwnsAndBoundary(
      ["src/override/**"],
      REGISTRY,
      "api_mind",
    );

    expect(result.requireBoundary).toBe(false);
  });

  it("sets requireBoundary true for unregistered mind without owns annotation", () => {
    // Edge case: unregistered and no owns — requireBoundary still true
    // (boundary check will hard-fail because ownsFiles is undefined)
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "unknown_mind",
    );

    expect(result.requireBoundary).toBe(true);
    expect(result.ownsFiles).toBeUndefined();
  });

  it("sets requireBoundary false for registered mind with no owns_files in registry", () => {
    // bare_mind is registered but has no owns_files — still not required
    // because it's a known/registered mind (backward compat)
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "bare_mind",
    );

    expect(result.requireBoundary).toBe(false);
    expect(result.ownsFiles).toBeUndefined();
  });
});

// ─── Combined scenarios matching T011 AC ────────────────────────────────────

describe("resolveOwnsAndBoundary — combined AC scenarios (T011 + T012)", () => {
  it("AC1: unregistered mind with owns: annotation gets ownsFiles and requireBoundary", () => {
    const result = resolveOwnsAndBoundary(
      ["src/new/**"],
      REGISTRY,
      "brand_new_mind",
    );

    expect(result.ownsFiles).toEqual(["src/new/**"]);
    expect(result.requireBoundary).toBe(true);
  });

  it("AC2: registered mind with owns: override gets task annotation, no requireBoundary", () => {
    const result = resolveOwnsAndBoundary(
      ["src/new/**"],
      REGISTRY,
      "api_mind",
    );

    expect(result.ownsFiles).toEqual(["src/new/**"]);
    expect(result.requireBoundary).toBe(false);
  });

  it("AC3: registered mind without owns: annotation gets registry owns_files, no requireBoundary", () => {
    const result = resolveOwnsAndBoundary(
      undefined,
      REGISTRY,
      "api_mind",
    );

    expect(result.ownsFiles).toEqual(["src/api/"]);
    expect(result.requireBoundary).toBe(false);
  });
});

// ─── Edge cases: empty registry ─────────────────────────────────────────────

describe("resolveOwnsAndBoundary — empty registry", () => {
  it("all minds are unregistered with empty registry", () => {
    const result = resolveOwnsAndBoundary(
      ["src/api/**"],
      [],
      "any_mind",
    );

    expect(result.ownsFiles).toEqual(["src/api/**"]);
    expect(result.requireBoundary).toBe(true);
  });

  it("returns undefined ownsFiles with empty registry and no annotation", () => {
    const result = resolveOwnsAndBoundary(
      undefined,
      [],
      "any_mind",
    );

    expect(result.ownsFiles).toBeUndefined();
    expect(result.requireBoundary).toBe(true);
  });
});
