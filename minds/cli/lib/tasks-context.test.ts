import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  detectTestFramework,
  detectMockupPath,
  detectE2eInfra,
  buildE2eTaskDescription,
  buildE2eBoundaryExtension,
} from "./tasks-context.ts";
import type { TasksContext } from "./tasks-context.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  const dir = join("/tmp", `tasks-context-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// detectTestFramework
// ---------------------------------------------------------------------------

describe("detectTestFramework", () => {
  test("detects bun:test from package.json (no test deps)", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ dependencies: {} }));
    expect(detectTestFramework(tmpDir)).toBe("bun:test");
  });

  test("detects playwright from package.json devDependencies", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "^1.40.0" } }),
    );
    expect(detectTestFramework(tmpDir)).toBe("playwright");
  });

  test("detects vitest from package.json dependencies", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { vitest: "^1.0.0" } }),
    );
    expect(detectTestFramework(tmpDir)).toBe("vitest");
  });

  test("falls back to scanning test files for bun:test", () => {
    mkdirSync(join(tmpDir, "tests"), { recursive: true });
    writeFileSync(
      join(tmpDir, "tests", "example.test.ts"),
      'import { describe, test, expect } from "bun:test";\n',
    );
    expect(detectTestFramework(tmpDir)).toBe("bun:test");
  });

  test("defaults to bun:test when nothing found", () => {
    expect(detectTestFramework(tmpDir)).toBe("bun:test");
  });
});

// ---------------------------------------------------------------------------
// detectMockupPath
// ---------------------------------------------------------------------------

describe("detectMockupPath", () => {
  test("extracts ~/path.html from ticket description", () => {
    const desc = "Design mockup: ~/Documents/blueprint/configv1.html";
    expect(detectMockupPath(desc)).toBe("~/Documents/blueprint/configv1.html");
  });

  test("extracts ~/path.png", () => {
    const desc = "See mockup at ~/Desktop/design.png for reference";
    expect(detectMockupPath(desc)).toBe("~/Desktop/design.png");
  });

  test("extracts ~/path.fig", () => {
    const desc = "Figma export: ~/designs/app.fig";
    expect(detectMockupPath(desc)).toBe("~/designs/app.fig");
  });

  test("returns null when no mockup path", () => {
    expect(detectMockupPath("Add a button to the settings page")).toBeNull();
  });

  test("returns null for non-home paths", () => {
    expect(detectMockupPath("See /etc/config.html for details")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectE2eInfra
// ---------------------------------------------------------------------------

describe("detectE2eInfra", () => {
  test("returns hasRegistry=false when no registry.json", () => {
    const result = detectE2eInfra(tmpDir);
    expect(result.hasRegistry).toBe(false);
    expect(result.schema).toBeNull();
  });

  test("returns hasRegistry=true with empty tests array", () => {
    mkdirSync(join(tmpDir, "tests", "e2e"), { recursive: true });
    writeFileSync(join(tmpDir, "tests", "e2e", "registry.json"), JSON.stringify({ tests: [] }));
    const result = detectE2eInfra(tmpDir);
    expect(result.hasRegistry).toBe(true);
    expect(result.schema).toBeNull();
  });

  test("infers schema from existing entry", () => {
    mkdirSync(join(tmpDir, "tests", "e2e"), { recursive: true });
    writeFileSync(
      join(tmpDir, "tests", "e2e", "registry.json"),
      JSON.stringify({ tests: [{ mind: "@blueprint-api", file: "tests/e2e/api.test.ts" }] }),
    );
    const result = detectE2eInfra(tmpDir);
    expect(result.hasRegistry).toBe(true);
    expect(result.schema).not.toBeNull();
    expect(result.schema!.mindKey).toBe("mind");
    expect(result.schema!.fileKey).toBe("file");
  });
});

// ---------------------------------------------------------------------------
// buildE2eTaskDescription
// ---------------------------------------------------------------------------

describe("buildE2eTaskDescription", () => {
  const baseCtx: TasksContext = {
    repoRoot: "/tmp/test",
    mindsDir: "/tmp/test/.minds",
    registry: [],
    featureDir: "/tmp/test/specs/BRE-700",
    ticketId: "BRE-700",
    testFramework: "bun:test",
    hasE2eInfra: true,
    e2eRegistrySchema: null,
    mockupPath: null,
  };

  test("includes correct test file path", () => {
    const desc = buildE2eTaskDescription(baseCtx, "config-module");
    expect(desc).toContain("tests/e2e/config-module.test.ts");
  });

  test("includes bun:test with in-process server", () => {
    const desc = buildE2eTaskDescription(baseCtx, "config-module");
    expect(desc).toContain("bun:test");
    expect(desc).toContain("in-process server on port 0");
  });

  test("includes mockup comparison when mockup present", () => {
    const ctx = { ...baseCtx, mockupPath: "~/Documents/blueprint/configv1.html" };
    const desc = buildE2eTaskDescription(ctx, "config-module");
    expect(desc).toContain("~/Documents/blueprint/configv1.html");
    expect(desc).toContain("visual structure comparison");
  });

  test("includes registry.json entry with correct schema", () => {
    const desc = buildE2eTaskDescription(baseCtx, "config-module");
    expect(desc).toContain('"mind": "@config-module"');
    expect(desc).toContain('"file": "tests/e2e/config-module.test.ts"');
  });

  test("uses playwright when that's the framework", () => {
    const ctx = { ...baseCtx, testFramework: "playwright" as const };
    const desc = buildE2eTaskDescription(ctx, "config-module");
    expect(desc).toContain("@playwright/test");
  });
});

// ---------------------------------------------------------------------------
// buildE2eBoundaryExtension
// ---------------------------------------------------------------------------

describe("buildE2eBoundaryExtension", () => {
  test("returns correct glob pattern", () => {
    expect(buildE2eBoundaryExtension("config-module")).toBe("tests/e2e/config-module*");
  });

  test("works for different mind names", () => {
    expect(buildE2eBoundaryExtension("blueprint-api")).toBe("tests/e2e/blueprint-api*");
  });
});
