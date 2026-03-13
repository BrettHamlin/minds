/**
 * scaffold-non-code.test.ts — Tests for non-code mind scaffolding (build + verify).
 *
 * BRE-623: Fission Non-Code Mind Scaffolding
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scaffoldAllMinds, type ScaffoldAllResult } from "../scaffold-minds.js";
import type { ProposedMindMap } from "../../naming/types.js";
import type { ProjectType } from "../project-type.js";

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
      domain: "Shared foundation layer.",
      files: ["src/config.ts"],
      exposes: ["config"],
    },
    minds: [
      {
        name: "auth",
        domain: "Manages authentication.",
        keywords: ["auth"],
        files: ["src/auth/login.ts"],
        owns_files: ["src/auth/**"],
        exposes: ["authenticate"],
        consumes: ["config"],
        fileCount: 1,
        cohesion: 0.9,
      },
    ],
    recommendations: [],
    couplingMatrix: [],
    ...overrides,
  };
}

function readMindsJson(): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(mindsJsonPath, "utf8"));
}

function findEntry(name: string): Record<string, unknown> | undefined {
  return readMindsJson().find((e) => e.name === name);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "fission-noncode-"));
  mindsSrcDir = join(tempDir, "minds");
  mindsJsonPath = join(tempDir, "minds.json");
  mkdirSync(mindsSrcDir, { recursive: true });
  writeFileSync(mindsJsonPath, "[]", "utf8");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/*  Build mind scaffolding                                             */
/* ------------------------------------------------------------------ */

describe("scaffoldAllMinds — build mind", () => {
  test("scaffolds build mind for known project types", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    expect(result.created).toContain("build");
    expect(existsSync(join(mindsSrcDir, "build"))).toBe(true);
  });

  test("build mind gets pipeline_template: 'build'", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "backend-api",
    });

    const entry = findEntry("build");
    expect(entry).toBeDefined();
    expect(entry!.pipeline_template).toBe("build");
  });

  test("build mind has owns_files: ['**']", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "backend-api",
    });

    const entry = findEntry("build");
    expect(entry).toBeDefined();
    expect(entry!.owns_files).toEqual(["**"]);
  });

  test("build mind has source: 'fission'", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "cli",
    });

    const entry = findEntry("build");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("fission");
  });

  test("no build mind for 'unknown' project type", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "unknown",
    });

    expect(result.created).not.toContain("build");
    expect(existsSync(join(mindsSrcDir, "build"))).toBe(false);
  });

  test("no build mind when projectType is omitted", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
    });

    expect(result.created).not.toContain("build");
    expect(existsSync(join(mindsSrcDir, "build"))).toBe(false);
  });

  test("build mind is created AFTER domain minds", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const buildIdx = result.created.indexOf("build");
    const authIdx = result.created.indexOf("auth");
    expect(buildIdx).toBeGreaterThan(authIdx);
  });

  test("build mind scaffolded for all non-unknown types", async () => {
    const types: ProjectType[] = [
      "frontend-web",
      "backend-api",
      "ios-mobile",
      "android-mobile",
      "library",
      "cli",
    ];

    for (const pt of types) {
      // Fresh temp dir for each
      const td = mkdtempSync(join(tmpdir(), "fission-pt-"));
      const src = join(td, "minds");
      const jp = join(td, "minds.json");
      mkdirSync(src, { recursive: true });
      writeFileSync(jp, "[]", "utf8");

      const result = await scaffoldAllMinds(makeMap(), {
        mindsSrcDir: src,
        mindsJsonOverride: jp,
        projectType: pt,
      });

      expect(result.created).toContain("build");
      rmSync(td, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Verify mind scaffolding                                            */
/* ------------------------------------------------------------------ */

describe("scaffoldAllMinds — verify mind", () => {
  test("scaffolds verify mind for frontend-web", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    expect(result.created).toContain("verify");
    expect(existsSync(join(mindsSrcDir, "verify"))).toBe(true);
  });

  test("scaffolds verify mind for backend-api", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "backend-api",
    });

    expect(result.created).toContain("verify");
  });

  test("verify mind gets pipeline_template: 'test'", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const entry = findEntry("verify");
    expect(entry).toBeDefined();
    expect(entry!.pipeline_template).toBe("test");
  });

  test("verify mind has owns_files: ['**']", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const entry = findEntry("verify");
    expect(entry).toBeDefined();
    expect(entry!.owns_files).toEqual(["**"]);
  });

  test("verify mind has source: 'fission'", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const entry = findEntry("verify");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("fission");
  });

  test("NO verify mind for ios-mobile", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "ios-mobile",
    });

    expect(result.created).not.toContain("verify");
  });

  test("NO verify mind for android-mobile", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "android-mobile",
    });

    expect(result.created).not.toContain("verify");
  });

  test("NO verify mind for library", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "library",
    });

    expect(result.created).not.toContain("verify");
  });

  test("NO verify mind for cli", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "cli",
    });

    expect(result.created).not.toContain("verify");
  });

  test("verify mind created AFTER build mind", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const buildIdx = result.created.indexOf("build");
    const verifyIdx = result.created.indexOf("verify");
    expect(verifyIdx).toBeGreaterThan(buildIdx);
  });
});

/* ------------------------------------------------------------------ */
/*  Domain mind scaffolding unchanged                                  */
/* ------------------------------------------------------------------ */

describe("scaffoldAllMinds — domain minds still work", () => {
  test("domain minds scaffolded normally with projectType", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    expect(result.created).toContain("foundation");
    expect(result.created).toContain("auth");
    expect(existsSync(join(mindsSrcDir, "foundation"))).toBe(true);
    expect(existsSync(join(mindsSrcDir, "auth"))).toBe(true);
  });

  test("domain minds scaffolded normally without projectType", async () => {
    const map = makeMap();
    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
    });

    expect(result.created).toContain("foundation");
    expect(result.created).toContain("auth");
    expect(result.created).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Error isolation                                                    */
/* ------------------------------------------------------------------ */

describe("scaffoldAllMinds — error isolation for non-code minds", () => {
  test("build failure does not block domain minds", async () => {
    const map = makeMap();

    // Pre-create build directory so it fails
    mkdirSync(join(mindsSrcDir, "build", "lib"), { recursive: true });

    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    expect(result.created).toContain("foundation");
    expect(result.created).toContain("auth");
    expect(result.failed).toContain("build");
  });

  test("verify failure does not block domain or build minds", async () => {
    const map = makeMap();

    // Pre-create verify directory so it fails
    mkdirSync(join(mindsSrcDir, "verify", "lib"), { recursive: true });

    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    expect(result.created).toContain("foundation");
    expect(result.created).toContain("auth");
    expect(result.created).toContain("build");
    expect(result.failed).toContain("verify");
  });

  test("domain mind failure does not block build/verify", async () => {
    const map = makeMap();

    // Pre-create auth directory so it fails
    mkdirSync(join(mindsSrcDir, "auth", "lib"), { recursive: true });

    const result = await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    expect(result.created).toContain("foundation");
    expect(result.failed).toContain("auth");
    expect(result.created).toContain("build");
    expect(result.created).toContain("verify");
  });
});

/* ------------------------------------------------------------------ */
/*  MIND.md content varies by project type                             */
/* ------------------------------------------------------------------ */

describe("scaffoldAllMinds — MIND.md content", () => {
  test("build MIND.md contains project-type-specific instructions for frontend-web", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const mindMd = readFileSync(join(mindsSrcDir, "build", "MIND.md"), "utf8");
    expect(mindMd).toContain("npm run build");
    expect(mindMd).toContain("build");
  });

  test("build MIND.md contains project-type-specific instructions for backend-api", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "backend-api",
    });

    const mindMd = readFileSync(join(mindsSrcDir, "build", "MIND.md"), "utf8");
    // Should contain some backend-specific build instructions
    expect(mindMd).toContain("build");
  });

  test("verify MIND.md contains testing instructions for frontend-web", async () => {
    const map = makeMap();
    await scaffoldAllMinds(map, {
      mindsSrcDir,
      mindsJsonOverride: mindsJsonPath,
      projectType: "frontend-web",
    });

    const mindMd = readFileSync(join(mindsSrcDir, "verify", "MIND.md"), "utf8");
    expect(mindMd).toContain("test");
  });

  test("build MIND.md differs between project types", async () => {
    // Frontend
    const td1 = mkdtempSync(join(tmpdir(), "fission-md1-"));
    const src1 = join(td1, "minds");
    const jp1 = join(td1, "minds.json");
    mkdirSync(src1, { recursive: true });
    writeFileSync(jp1, "[]", "utf8");
    await scaffoldAllMinds(makeMap(), {
      mindsSrcDir: src1,
      mindsJsonOverride: jp1,
      projectType: "frontend-web",
    });
    const frontendMd = readFileSync(join(src1, "build", "MIND.md"), "utf8");

    // Backend
    const td2 = mkdtempSync(join(tmpdir(), "fission-md2-"));
    const src2 = join(td2, "minds");
    const jp2 = join(td2, "minds.json");
    mkdirSync(src2, { recursive: true });
    writeFileSync(jp2, "[]", "utf8");
    await scaffoldAllMinds(makeMap(), {
      mindsSrcDir: src2,
      mindsJsonOverride: jp2,
      projectType: "backend-api",
    });
    const backendMd = readFileSync(join(src2, "build", "MIND.md"), "utf8");

    expect(frontendMd).not.toBe(backendMd);

    rmSync(td1, { recursive: true, force: true });
    rmSync(td2, { recursive: true, force: true });
  });
});
