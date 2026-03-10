/**
 * naming.test.ts -- Tests for the naming and validation layer (Stage 4).
 *
 * Tests the offline/deterministic path only. LLM calls are not tested
 * in unit tests -- they require integration tests with a live model.
 */
import { describe, expect, it } from "bun:test";
import { nameAndValidate } from "../naming";
import type { ProposedMindMap } from "../types";
import type { ClusterAssignment } from "../../analysis/leiden";
import type { DependencyGraph } from "../../lib/types";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

/** Build a minimal PipelineResult-like object for naming tests. */
function makePipelineResult(opts: {
  foundationFiles?: string[];
  clusters: {
    files: string[];
    internalEdges?: number;
    externalEdges?: number;
    cohesion?: number;
  }[];
  edges?: { from: string; to: string; weight: number }[];
}) {
  const allFiles = [
    ...(opts.foundationFiles ?? []),
    ...opts.clusters.flatMap((c) => c.files),
  ];

  const graph: DependencyGraph = {
    nodes: allFiles,
    edges: opts.edges ?? [],
  };

  const clusters: ClusterAssignment[] = opts.clusters.map((c, i) => ({
    clusterId: i,
    files: c.files,
    internalEdges: c.internalEdges ?? 10,
    externalEdges: c.externalEdges ?? 2,
    cohesion: c.cohesion ?? 0.8,
  }));

  return {
    foundation: {
      files: opts.foundationFiles ?? [],
      metrics: (opts.foundationFiles ?? []).map((f) => ({
        file: f,
        fanIn: 50,
        fanOut: 5,
      })),
    },
    remaining: graph,
    clusters,
    modularity: 0.45,
    graph,
  };
}

/* ------------------------------------------------------------------ */
/*  Offline naming: directory-based fallback                           */
/* ------------------------------------------------------------------ */

describe("offline naming (deterministic fallback)", () => {
  it("names clusters based on most common directory prefix", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/auth/login.ts",
              "src/auth/logout.ts",
              "src/auth/session.ts",
            ],
          },
          {
            files: [
              "src/billing/invoice.ts",
              "src/billing/payment.ts",
              "src/billing/stripe.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    expect(result.minds).toHaveLength(2);

    const names = result.minds.map((m) => m.name).sort();
    expect(names).toEqual(["auth", "billing"]);
  });

  it("uses deepest shared directory segment for naming", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/features/dashboard/chart.ts",
              "src/features/dashboard/widgets.ts",
              "src/features/dashboard/layout.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    expect(result.minds[0].name).toBe("dashboard");
  });

  it("falls back to parent directory when files span multiple subdirectories", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/api/routes.ts",
              "src/api/middleware.ts",
              "src/api/handlers/user.ts",
              "src/api/handlers/product.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    expect(result.minds[0].name).toBe("api");
  });

  it("handles root-level files by using filename stems", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: ["server.ts", "app.ts", "index.ts"],
          },
        ],
      }),
      { offline: true },
    );

    // When files have no common directory, name is derived from
    // the cluster ID as a fallback.
    expect(result.minds[0].name).toBeTruthy();
    expect(result.minds[0].name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("produces valid Mind names (lowercase, hyphenated, 2-20 chars)", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/UserAuthentication/Login.ts",
              "src/UserAuthentication/Register.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    const name = result.minds[0].name;
    expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(name.length).toBeGreaterThanOrEqual(2);
    expect(name.length).toBeLessThanOrEqual(20);
  });

  it("deduplicates names when two clusters share the same directory", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: ["src/utils/string.ts", "src/utils/array.ts"],
          },
          {
            files: ["src/utils/date.ts", "src/utils/math.ts"],
          },
        ],
      }),
      { offline: true },
    );

    const names = result.minds.map((m) => m.name);
    // Names must be unique.
    expect(new Set(names).size).toBe(names.length);
  });
});

/* ------------------------------------------------------------------ */
/*  Foundation Mind                                                     */
/* ------------------------------------------------------------------ */

describe("Foundation Mind", () => {
  it("always names Foundation as 'foundation'", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        foundationFiles: ["src/config.ts", "src/utils.ts", "src/types.ts"],
        clusters: [
          { files: ["src/auth/login.ts"] },
        ],
      }),
      { offline: true },
    );

    expect(result.foundation.name).toBe("foundation");
  });

  it("lists all hub files in Foundation", async () => {
    const hubFiles = ["src/config.ts", "src/utils.ts", "src/types.ts"];
    const result = await nameAndValidate(
      makePipelineResult({
        foundationFiles: hubFiles,
        clusters: [
          { files: ["src/auth/login.ts"] },
        ],
      }),
      { offline: true },
    );

    expect(result.foundation.files).toEqual(hubFiles);
  });

  it("generates a domain description for Foundation", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        foundationFiles: ["src/config.ts"],
        clusters: [
          { files: ["src/auth/login.ts"] },
        ],
      }),
      { offline: true },
    );

    expect(result.foundation.domain).toBeTruthy();
    expect(typeof result.foundation.domain).toBe("string");
  });

  it("populates exposes for Foundation based on hub files", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        foundationFiles: ["src/config.ts", "src/utils.ts"],
        clusters: [
          { files: ["src/auth/login.ts"] },
        ],
      }),
      { offline: true },
    );

    expect(result.foundation.exposes.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Coupling matrix                                                    */
/* ------------------------------------------------------------------ */

describe("coupling matrix", () => {
  it("replaces cluster IDs with Mind names", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          { files: ["src/auth/login.ts", "src/auth/session.ts"] },
          { files: ["src/billing/invoice.ts", "src/billing/payment.ts"] },
        ],
        edges: [
          { from: "src/auth/login.ts", to: "src/billing/invoice.ts", weight: 3 },
        ],
      }),
      { offline: true },
    );

    expect(result.couplingMatrix.length).toBeGreaterThan(0);

    for (const entry of result.couplingMatrix) {
      // Must be Mind names, not "cluster-0" style labels.
      expect(entry.from).not.toMatch(/^cluster-/);
      expect(entry.to).not.toMatch(/^cluster-/);
      expect(entry.from).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.to).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("has correct edge counts between named Minds", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          { files: ["src/auth/login.ts", "src/auth/session.ts"] },
          { files: ["src/billing/invoice.ts"] },
        ],
        edges: [
          { from: "src/auth/login.ts", to: "src/billing/invoice.ts", weight: 2 },
          { from: "src/auth/session.ts", to: "src/billing/invoice.ts", weight: 1 },
        ],
      }),
      { offline: true },
    );

    const coupling = result.couplingMatrix.find(
      (c) =>
        (c.from === "auth" && c.to === "billing") ||
        (c.from === "billing" && c.to === "auth"),
    );
    expect(coupling).toBeTruthy();
    expect(coupling!.edges).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/*  owns_files glob patterns                                           */
/* ------------------------------------------------------------------ */

describe("owns_files patterns", () => {
  it("generates glob patterns from file lists", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/auth/login.ts",
              "src/auth/logout.ts",
              "src/auth/session.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    const mind = result.minds[0];
    expect(mind.owns_files.length).toBeGreaterThan(0);
    // Should generate a pattern like "src/auth/**"
    expect(mind.owns_files.some((p) => p.includes("auth"))).toBe(true);
  });

  it("generates multiple patterns when files span directories", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/auth/login.ts",
              "src/auth/session.ts",
              "lib/crypto/hash.ts",
              "lib/crypto/token.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    const mind = result.minds[0];
    // Should have patterns for both src/auth and lib/crypto.
    expect(mind.owns_files.length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Recommendations                                                    */
/* ------------------------------------------------------------------ */

describe("recommendations", () => {
  it("recommends split for clusters with >500 files", async () => {
    const bigCluster = Array.from({ length: 600 }, (_, i) => `src/big/file${i}.ts`);
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [{ files: bigCluster }],
      }),
      { offline: true },
    );

    const splitRec = result.recommendations.find((r) => r.type === "split");
    expect(splitRec).toBeTruthy();
    expect(splitRec!.reason).toContain("600");
  });

  it("recommends merge for clusters with <5 files", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          { files: ["src/tiny/a.ts", "src/tiny/b.ts"] },
          { files: ["src/other/x.ts", "src/other/y.ts", "src/other/z.ts", "src/other/w.ts", "src/other/v.ts", "src/other/u.ts"] },
        ],
      }),
      { offline: true },
    );

    const mergeRec = result.recommendations.find((r) => r.type === "merge");
    expect(mergeRec).toBeTruthy();
    expect(mergeRec!.target).toBeTruthy();
  });

  it("does not recommend split for clusters with <=500 files", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: Array.from({ length: 100 }, (_, i) => `src/mod/f${i}.ts`),
          },
        ],
      }),
      { offline: true },
    );

    const splitRec = result.recommendations.find((r) => r.type === "split");
    expect(splitRec).toBeUndefined();
  });

  it("does not recommend merge for clusters with >=5 files", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/mod/a.ts",
              "src/mod/b.ts",
              "src/mod/c.ts",
              "src/mod/d.ts",
              "src/mod/e.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    const mergeRec = result.recommendations.find((r) => r.type === "merge");
    expect(mergeRec).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  ProposedMind shape                                                 */
/* ------------------------------------------------------------------ */

describe("ProposedMind shape", () => {
  it("includes all required fields", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: ["src/auth/login.ts", "src/auth/session.ts"],
            cohesion: 0.85,
          },
        ],
      }),
      { offline: true },
    );

    const mind = result.minds[0];
    expect(mind.name).toBeTruthy();
    expect(mind.domain).toBeTruthy();
    expect(Array.isArray(mind.keywords)).toBe(true);
    expect(mind.keywords.length).toBeGreaterThan(0);
    expect(Array.isArray(mind.files)).toBe(true);
    expect(mind.files).toEqual(["src/auth/login.ts", "src/auth/session.ts"]);
    expect(Array.isArray(mind.owns_files)).toBe(true);
    expect(Array.isArray(mind.exposes)).toBe(true);
    expect(Array.isArray(mind.consumes)).toBe(true);
    expect(mind.fileCount).toBe(2);
    expect(mind.cohesion).toBe(0.85);
  });

  it("generates keywords from directory names", async () => {
    const result = await nameAndValidate(
      makePipelineResult({
        clusters: [
          {
            files: [
              "src/auth/login.ts",
              "src/auth/session.ts",
              "src/auth/middleware.ts",
            ],
          },
        ],
      }),
      { offline: true },
    );

    const mind = result.minds[0];
    expect(mind.keywords).toContain("auth");
  });
});
