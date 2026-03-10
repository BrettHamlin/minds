/**
 * scaffold-minds.test.ts — Tests for the batch scaffolding integration.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scaffoldAllMinds } from "../scaffold-minds.js";
import type { ProposedMindMap } from "../../naming/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let tempDir: string;
let mindsSrcDir: string;
let mindsJsonPath: string;

function makeMap(overrides?: Partial<ProposedMindMap>): ProposedMindMap {
  return {
    foundation: {
      name: "foundation",
      domain: "Shared foundation layer providing config, utils.",
      files: ["src/config.ts", "src/utils.ts"],
      exposes: ["config", "utils"],
    },
    minds: [
      {
        name: "auth",
        domain: "Manages authentication and sessions.",
        keywords: ["auth", "login"],
        files: ["src/auth/login.ts", "src/auth/session.ts"],
        owns_files: ["src/auth/**"],
        exposes: ["authenticate"],
        consumes: ["config"],
        fileCount: 2,
        cohesion: 0.9,
      },
      {
        name: "data",
        domain: "Manages data access layer.",
        keywords: ["data", "query"],
        files: ["src/data/query.ts"],
        owns_files: ["src/data/**"],
        exposes: ["query"],
        consumes: ["config"],
        fileCount: 1,
        cohesion: 0.8,
      },
    ],
    recommendations: [],
    couplingMatrix: [],
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "fission-scaffold-"));
  mindsSrcDir = join(tempDir, "minds");
  mindsJsonPath = join(tempDir, "minds.json");
  mkdirSync(mindsSrcDir, { recursive: true });
  // Create an initial minds.json
  writeFileSync(mindsJsonPath, "[]", "utf8");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("scaffoldAllMinds", () => {
  test("scaffolds foundation + all domain minds", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
    });

    expect(result.created).toContain("foundation");
    expect(result.created).toContain("auth");
    expect(result.created).toContain("data");
    expect(result.failed).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    // Verify directories were created
    expect(existsSync(join(mindsSrcDir, "foundation"))).toBe(true);
    expect(existsSync(join(mindsSrcDir, "auth"))).toBe(true);
    expect(existsSync(join(mindsSrcDir, "data"))).toBe(true);

    // Verify server.ts files exist
    expect(existsSync(join(mindsSrcDir, "foundation", "server.ts"))).toBe(true);
    expect(existsSync(join(mindsSrcDir, "auth", "server.ts"))).toBe(true);
  });

  test("collects failures without throwing", async () => {
    const map = makeMap();

    // Pre-create "auth" directory so scaffolding fails for it
    mkdirSync(join(mindsSrcDir, "auth", "lib"), { recursive: true });

    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
    });

    // auth should have failed, others succeed
    expect(result.created).toContain("foundation");
    expect(result.created).toContain("data");
    expect(result.failed).toContain("auth");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].mind).toBe("auth");
    expect(result.errors[0].error).toBeTruthy();
  });

  test("handles empty minds list", async () => {
    const map = makeMap({ minds: [] });
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
    });

    expect(result.created).toContain("foundation");
    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  test("registers all minds in minds.json", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
    });

    const json = JSON.parse(readFileSync(mindsJsonPath, "utf8"));
    const names = json.map((e: { name: string }) => e.name);
    expect(names).toContain("foundation");
    expect(names).toContain("auth");
    expect(names).toContain("data");
  });
});
