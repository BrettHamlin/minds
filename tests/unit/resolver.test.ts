/**
 * Unit tests for src/cli/lib/resolver.ts
 * Covers: single pipeline, deps, transitive chain, circular detection, packs, installed skip.
 */

import { describe, test, expect } from "bun:test";
import { resolve, filterInstalled, collectCliDeps } from "../../src/cli/lib/resolver.js";
import type { PipelineManifest } from "../../src/cli/types/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(
  name: string,
  deps: Array<{ name: string; version: string }> = [],
  cliDeps: PipelineManifest["cliDependencies"] = []
): PipelineManifest {
  return {
    name,
    type: "pipeline",
    version: "1.0.0",
    description: `${name} pipeline`,
    dependencies: deps,
    cliDependencies: cliDeps,
    commands: [],
  };
}

function makeManifestMap(manifests: PipelineManifest[]): Map<string, PipelineManifest> {
  return new Map(manifests.map((m) => [m.name, m]));
}

// ─── resolve ─────────────────────────────────────────────────────────────────

describe("resolve", () => {
  test("single pipeline with no deps", () => {
    const manifests = makeManifestMap([makeManifest("specify")]);
    const result = resolve(["specify"], manifests);

    expect(result.order).toEqual(["specify"]);
    expect(result.resolved.has("specify")).toBe(true);
  });

  test("pipeline with one direct dependency", () => {
    const manifests = makeManifestMap([
      makeManifest("specify"),
      makeManifest("plan", [{ name: "specify", version: ">=1.0.0" }]),
    ]);
    const result = resolve(["plan"], manifests);

    expect(result.order).toContain("specify");
    expect(result.order).toContain("plan");
    // specify must come before plan
    expect(result.order.indexOf("specify")).toBeLessThan(result.order.indexOf("plan"));
  });

  test("transitive chain A → B → C", () => {
    const manifests = makeManifestMap([
      makeManifest("A"),
      makeManifest("B", [{ name: "A", version: ">=1.0.0" }]),
      makeManifest("C", [{ name: "B", version: ">=1.0.0" }]),
    ]);
    const result = resolve(["C"], manifests);

    expect(result.order).toContain("A");
    expect(result.order).toContain("B");
    expect(result.order).toContain("C");
    expect(result.order.indexOf("A")).toBeLessThan(result.order.indexOf("B"));
    expect(result.order.indexOf("B")).toBeLessThan(result.order.indexOf("C"));
  });

  test("circular dependency detection A → B → A throws", () => {
    const manifests = makeManifestMap([
      makeManifest("A", [{ name: "B", version: ">=1.0.0" }]),
      makeManifest("B", [{ name: "A", version: ">=1.0.0" }]),
    ]);

    expect(() => resolve(["A"], manifests)).toThrow();

    // Should throw CIRCULAR_DEPENDENCY
    try {
      resolve(["A"], manifests);
    } catch (err) {
      expect((err as { code: string }).code).toBe("CIRCULAR_DEPENDENCY");
    }
  });

  test("pack resolution resolves all components", () => {
    const specifyManifest = makeManifest("specify");
    const planManifest = makeManifest("plan", [{ name: "specify", version: ">=1.0.0" }]);
    const packManifest: PipelineManifest = {
      name: "specfactory",
      type: "pack",
      version: "2.0.0",
      description: "full pack",
      dependencies: [
        { name: "specify", version: ">=1.0.0" },
        { name: "plan", version: ">=1.0.0" },
      ],
      cliDependencies: [],
      commands: [],
    };

    const manifests = makeManifestMap([specifyManifest, planManifest, packManifest]);
    const result = resolve(["specfactory"], manifests);

    expect(result.resolved.has("specfactory")).toBe(true);
    expect(result.resolved.has("specify")).toBe(true);
    expect(result.resolved.has("plan")).toBe(true);
  });

  test("already-installed dep is still resolved but flagged by filterInstalled", () => {
    const manifests = makeManifestMap([
      makeManifest("specify"),
      makeManifest("plan", [{ name: "specify", version: ">=1.0.0" }]),
    ]);
    const installed = new Set(["specify"]);
    const result = resolve(["plan"], manifests, installed);

    // resolved still contains specify (it's part of the graph)
    expect(result.resolved.has("specify")).toBe(true);

    // filterInstalled removes it
    const toInstall = filterInstalled(result.order, installed);
    expect(toInstall).not.toContain("specify");
    expect(toInstall).toContain("plan");
  });

  test("missing dependency throws MISSING_DEPENDENCY", () => {
    const manifests = makeManifestMap([
      makeManifest("plan", [{ name: "specify", version: ">=1.0.0" }]),
    ]);

    expect(() => resolve(["plan"], manifests)).toThrow();

    try {
      resolve(["plan"], manifests);
    } catch (err) {
      expect((err as { code: string }).code).toBe("MISSING_DEPENDENCY");
    }
  });

  test("multiple roots with shared dep only resolves dep once", () => {
    const manifests = makeManifestMap([
      makeManifest("A"),
      makeManifest("B", [{ name: "A", version: ">=1.0.0" }]),
      makeManifest("C", [{ name: "A", version: ">=1.0.0" }]),
    ]);
    const result = resolve(["B", "C"], manifests);

    const aCount = result.order.filter((n) => n === "A").length;
    expect(aCount).toBe(1);
  });
});

// ─── collectCliDeps ──────────────────────────────────────────────────────────

describe("collectCliDeps", () => {
  test("collects CLI deps from all manifests", () => {
    const manifests = new Map<string, PipelineManifest>([
      [
        "specify",
        makeManifest("specify", [], [
          { name: "bun", version: ">=1.0.0", required: true },
        ]),
      ],
      [
        "plan",
        makeManifest("plan", [], [
          { name: "jq", version: ">=1.6.0", required: true },
        ]),
      ],
    ]);

    const cliDeps = collectCliDeps(manifests);
    const names = cliDeps.map((d) => d.name);
    expect(names).toContain("bun");
    expect(names).toContain("jq");
  });

  test("deduplicates same CLI across multiple pipelines", () => {
    const manifests = new Map<string, PipelineManifest>([
      [
        "A",
        makeManifest("A", [], [{ name: "bun", version: ">=1.0.0", required: false }]),
      ],
      [
        "B",
        makeManifest("B", [], [{ name: "bun", version: ">=1.0.0", required: true }]),
      ],
    ]);

    const cliDeps = collectCliDeps(manifests);
    const bunDeps = cliDeps.filter((d) => d.name === "bun");
    expect(bunDeps).toHaveLength(1);
    // The required flag should be true (any required → required)
    expect(bunDeps[0].required).toBe(true);
  });
});
