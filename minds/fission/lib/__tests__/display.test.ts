/**
 * display.test.ts — Tests for Fission terminal display utilities.
 */

import { describe, expect, test } from "bun:test";
import { displayProposedMap, displaySummary } from "../display.js";
import type { ProposedMindMap } from "../../naming/types.js";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeMap(overrides?: Partial<ProposedMindMap>): ProposedMindMap {
  return {
    foundation: {
      name: "foundation",
      domain: "Shared foundation layer providing config, utils to all Minds.",
      files: ["src/config.ts", "src/utils.ts", "src/types.ts"],
      exposes: ["config", "utils", "types"],
    },
    minds: [
      {
        name: "auth",
        domain: "Manages the auth domain with 12 files across 3 directories.",
        keywords: ["auth", "login", "session"],
        files: Array.from({ length: 12 }, (_, i) => `src/auth/file${i}.ts`),
        owns_files: ["src/auth/**"],
        exposes: ["authenticate", "session"],
        consumes: ["config"],
        fileCount: 12,
        cohesion: 0.85,
      },
      {
        name: "data-access",
        domain: "Manages the data-access domain with 8 files across 2 directories.",
        keywords: ["data", "database", "query"],
        files: Array.from({ length: 8 }, (_, i) => `src/data/file${i}.ts`),
        owns_files: ["src/data/**"],
        exposes: ["query", "connection"],
        consumes: ["config", "utils"],
        fileCount: 8,
        cohesion: 0.72,
      },
    ],
    recommendations: [
      {
        type: "merge",
        target: "data-access",
        reason: 'Cluster "data-access" has only 8 files.',
        suggestion: 'Consider merging "data-access" into a related Mind.',
      },
    ],
    couplingMatrix: [
      { from: "auth", to: "data-access", edges: 5 },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  displayProposedMap                                                  */
/* ------------------------------------------------------------------ */

describe("displayProposedMap", () => {
  test("includes header with summary stats", () => {
    const map = makeMap();
    const output = displayProposedMap(map);
    expect(output).toContain("Fission Analysis Complete");
    // Should mention file count and mind count
    expect(output).toContain("2 domain");
    expect(output).toContain("1 foundation");
  });

  test("includes Foundation Mind section", () => {
    const map = makeMap();
    const output = displayProposedMap(map);
    expect(output).toContain("Foundation Mind");
    expect(output).toContain("3 files");
    expect(output).toContain("config");
    expect(output).toContain("utils");
    expect(output).toContain("types");
  });

  test("includes all domain Mind names", () => {
    const map = makeMap();
    const output = displayProposedMap(map);
    expect(output).toContain("auth");
    expect(output).toContain("data-access");
  });

  test("includes domain Mind details", () => {
    const map = makeMap();
    const output = displayProposedMap(map);
    // Should show file counts
    expect(output).toContain("12");
    expect(output).toContain("8");
    // Should show cohesion values
    expect(output).toContain("0.85");
    expect(output).toContain("0.72");
  });

  test("includes coupling matrix entries", () => {
    const map = makeMap();
    const output = displayProposedMap(map);
    expect(output).toContain("Coupling");
    expect(output).toContain("auth");
    expect(output).toContain("data-access");
    expect(output).toContain("5");
  });

  test("includes recommendations", () => {
    const map = makeMap();
    const output = displayProposedMap(map);
    expect(output).toContain("Recommendation");
    expect(output).toContain("merge");
    expect(output).toContain("data-access");
  });

  test("handles empty recommendations", () => {
    const map = makeMap({ recommendations: [] });
    const output = displayProposedMap(map);
    expect(output).toContain("Fission Analysis Complete");
    // Should still render without error, just no recommendations section
  });

  test("handles empty coupling matrix", () => {
    const map = makeMap({ couplingMatrix: [] });
    const output = displayProposedMap(map);
    expect(output).toContain("Fission Analysis Complete");
  });

  test("handles empty minds list", () => {
    const map = makeMap({ minds: [] });
    const output = displayProposedMap(map);
    expect(output).toContain("0 domain");
  });

  test("truncates long domain descriptions to 60 chars", () => {
    const longDomain = "A".repeat(80);
    const map = makeMap({
      minds: [
        {
          name: "long-domain",
          domain: longDomain,
          keywords: ["test"],
          files: ["src/a.ts"],
          owns_files: ["src/a.ts"],
          exposes: [],
          consumes: [],
          fileCount: 1,
          cohesion: 0.5,
        },
      ],
    });
    const output = displayProposedMap(map);
    // Should not contain the full 80-char string in the table
    expect(output).not.toContain(longDomain);
    // But should contain a truncated version
    expect(output).toContain("A".repeat(57) + "...");
  });

  test("shows top 5 hub files by fan-in when foundation has metrics", () => {
    const map = makeMap();
    // Foundation has 3 files by default, all should be shown
    const output = displayProposedMap(map);
    expect(output).toContain("src/config.ts");
    expect(output).toContain("src/utils.ts");
    expect(output).toContain("src/types.ts");
  });
});

/* ------------------------------------------------------------------ */
/*  displaySummary                                                     */
/* ------------------------------------------------------------------ */

describe("displaySummary", () => {
  test("returns one-line summary with correct counts", () => {
    const map = makeMap();
    const summary = displaySummary(map);
    expect(summary).toContain("2 domain Mind");
    expect(summary).toContain("1 Foundation Mind");
    // Total files: 3 foundation + 12 auth + 8 data-access = 23
    expect(summary).toContain("23 files");
  });

  test("handles singular Mind count", () => {
    const map = makeMap({
      minds: [
        {
          name: "single",
          domain: "Only one.",
          keywords: ["one"],
          files: ["src/one.ts"],
          owns_files: ["src/one.ts"],
          exposes: [],
          consumes: [],
          fileCount: 1,
          cohesion: 1.0,
        },
      ],
    });
    const summary = displaySummary(map);
    expect(summary).toContain("1 domain Mind");
  });

  test("handles zero domain Minds", () => {
    const map = makeMap({ minds: [] });
    const summary = displaySummary(map);
    expect(summary).toContain("0 domain Mind");
  });
});
