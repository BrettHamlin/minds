/**
 * tests/e2e/core-minds.test.ts
 *
 * E2E validation: fresh repo → installCoreMinds → scaffoldMind → discover.
 *
 * Flow:
 *   1. Create isolated temp directory with git init
 *   2. installCoreMinds() → .minds/ with all core Minds
 *   3. Verify .minds/ structure and minds.json registry
 *   4. scaffoldMind("test-mind") → .minds/test-mind/
 *   5. Verify scaffold files and minds.json updated
 *   6. findChildServerFiles() → discovers test-mind from .minds/
 *   7. Cleanup
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

import { installCoreMinds, getMindsSourceDir } from "../../minds/installer/core";
import { scaffoldMind } from "../../minds/instantiate/lib/scaffold";
import type { ScaffoldOptions } from "../../minds/instantiate/lib/scaffold";
import { findChildServerFiles } from "../../minds/discovery";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const CORE_MINDS = [
  "router",
  "memory",
  "transport",
  "signals",
  "dashboard",
  "integrations",
  "observability",
  "fission",
] as const;

let tmpDir: string;
let mindsDir: string;
let mindsJsonPath: string;

beforeAll(() => {
  // Create isolated temp dir
  tmpDir = mkdtempSync("/tmp/core-minds-e2e-");
  mindsDir = join(tmpDir, ".minds");
  mindsJsonPath = join(mindsDir, "minds.json");

  // Initialize a bare git repo so collab tooling resolves git root correctly
  execSync("git init", { cwd: tmpDir, stdio: "ignore" });

  // Install core Minds using the dev source directory
  const mindsSourceDir = getMindsSourceDir();
  installCoreMinds(mindsSourceDir, tmpDir, { quiet: true });
});

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 1. .minds/ directory structure after install
// ---------------------------------------------------------------------------

describe("e2e/core-minds: installCoreMinds", () => {
  test("1. .minds/ directory exists after install", () => {
    expect(existsSync(mindsDir)).toBe(true);
  });

  test.each(CORE_MINDS)(
    "2. .minds/%s directory exists",
    (mindName) => {
      expect(existsSync(join(mindsDir, mindName))).toBe(true);
    }
  );

  test("3. .minds/minds.json registry placeholder exists", () => {
    expect(existsSync(mindsJsonPath)).toBe(true);
  });

  test("4. .minds/minds.json is valid JSON array", () => {
    const raw = readFileSync(mindsJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. scaffoldMind creates a custom Mind in .minds/
// ---------------------------------------------------------------------------

describe("e2e/core-minds: scaffoldMind", () => {
  let scaffoldResult: Awaited<ReturnType<typeof scaffoldMind>>;

  beforeAll(async () => {
    const opts: ScaffoldOptions = {
      mindsSrcDir: mindsDir,
      mindsJsonOverride: mindsJsonPath,
    };
    scaffoldResult = await scaffoldMind("test-mind", "Testing", opts);
  });

  test("5. scaffoldMind returns registered: true", () => {
    expect(scaffoldResult.registered).toBe(true);
  });

  test("6. .minds/test-mind/ directory created", () => {
    expect(existsSync(join(mindsDir, "test-mind"))).toBe(true);
  });

  test("7. .minds/test-mind/MIND.md created", () => {
    expect(existsSync(join(mindsDir, "test-mind", "MIND.md"))).toBe(true);
  });

  test("8. .minds/test-mind/server.ts created", () => {
    expect(existsSync(join(mindsDir, "test-mind", "server.ts"))).toBe(true);
  });

  test("9. .minds/test-mind/lib/ directory created", () => {
    expect(existsSync(join(mindsDir, "test-mind", "lib"))).toBe(true);
  });

  test("10. minds.json updated with test-mind entry", () => {
    const raw = readFileSync(mindsJsonPath, "utf-8");
    const entries = JSON.parse(raw) as Array<{ name: string; domain: string }>;
    const entry = entries.find((e) => e.name === "test-mind");
    expect(entry).toBeDefined();
    expect(entry?.domain).toBe("Testing");
  });

  test("11. MIND.md contains correct name and domain", () => {
    const md = readFileSync(join(mindsDir, "test-mind", "MIND.md"), "utf-8");
    expect(md).toContain("@test-mind");
    expect(md).toContain("Testing");
  });

  test("12. server.ts references correct Mind name and domain", () => {
    const ts = readFileSync(join(mindsDir, "test-mind", "server.ts"), "utf-8");
    expect(ts).toContain('"test-mind"');
    expect(ts).toContain('"Testing"');
  });
});

// ---------------------------------------------------------------------------
// 3. findChildServerFiles discovers minds from .minds/
// ---------------------------------------------------------------------------

describe("e2e/core-minds: findChildServerFiles", () => {
  test("13. findChildServerFiles returns server.ts paths from .minds/", () => {
    const files = findChildServerFiles(tmpDir, mindsDir);
    expect(files.length).toBeGreaterThan(0);
  });

  test("14. test-mind/server.ts is discovered", () => {
    const files = findChildServerFiles(tmpDir, mindsDir);
    const testMindServer = join(mindsDir, "test-mind", "server.ts");
    expect(files).toContain(testMindServer);
  });

  test("15. all discovered paths are absolute and end with server.ts", () => {
    const files = findChildServerFiles(tmpDir, mindsDir);
    for (const f of files) {
      expect(f).toMatch(/\/server\.ts$/);
      expect(f.startsWith("/")).toBe(true);
    }
  });
});
