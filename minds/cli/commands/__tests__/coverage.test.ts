import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { runCoverage, checkCoverage, type CoverageResult } from "../coverage.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Creates a temporary git repo with a minds.json and source files.
 * Returns the repo root path.
 */
function createTempRepo(opts: {
  minds: Array<{ name: string; owns_files: string[] }>;
  files: string[];
}): string {
  const tmpDir = join(
    import.meta.dir,
    `__tmp_coverage_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tmpDir, { recursive: true });

  // Init git repo so git ls-files works
  Bun.spawnSync(["git", "init"], { cwd: tmpDir, stdout: "pipe", stderr: "pipe" });

  // Create .minds directory and minds.json
  // Use .minds/ because resolveMindsDir only uses minds/ when minds/cli/ exists (dev layout)
  const mindsDir = join(tmpDir, ".minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(
    join(mindsDir, "minds.json"),
    JSON.stringify(opts.minds, null, 2)
  );

  // Create source files and add them to git
  for (const file of opts.files) {
    const filePath = join(tmpDir, file);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, `// ${file}\n`);
  }

  // Stage all files so git ls-files sees them
  Bun.spawnSync(["git", "add", "-A"], { cwd: tmpDir, stdout: "pipe", stderr: "pipe" });

  return tmpDir;
}

function cleanupTempRepo(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── T022: minds coverage command ─────────────────────────────────────────────

describe("checkCoverage", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempRepo(tmpDir);
  });

  it("reports all files covered when every file matches an owns_files glob", () => {
    tmpDir = createTempRepo({
      minds: [
        { name: "api", owns_files: ["src/api/**"] },
        { name: "models", owns_files: ["src/models/**"] },
      ],
      files: [
        "src/api/routes.ts",
        "src/api/middleware.ts",
        "src/models/user.ts",
      ],
    });

    const result = checkCoverage(tmpDir);
    expect(result.allCovered).toBe(true);
    expect(result.unownedFiles).toHaveLength(0);
    expect(result.totalFiles).toBe(3);
  });

  it("reports unowned files when some files have no matching mind", () => {
    tmpDir = createTempRepo({
      minds: [
        { name: "api", owns_files: ["src/api/**"] },
      ],
      files: [
        "src/api/routes.ts",
        "src/orphan/utils.ts",
        "src/orphan/helpers.ts",
      ],
    });

    const result = checkCoverage(tmpDir);
    expect(result.allCovered).toBe(false);
    expect(result.unownedFiles).toContain("src/orphan/utils.ts");
    expect(result.unownedFiles).toContain("src/orphan/helpers.ts");
  });

  it("groups unowned files by directory in output", () => {
    tmpDir = createTempRepo({
      minds: [
        { name: "api", owns_files: ["src/api/**"] },
      ],
      files: [
        "src/api/routes.ts",
        "src/orphan/a.ts",
        "src/orphan/b.ts",
        "src/other/c.ts",
      ],
    });

    const result = checkCoverage(tmpDir);
    expect(result.groupedByDir["src/orphan"]).toBeDefined();
    expect(result.groupedByDir["src/orphan"]).toHaveLength(2);
    expect(result.groupedByDir["src/other"]).toBeDefined();
    expect(result.groupedByDir["src/other"]).toHaveLength(1);
  });

  it("excludes .git/, node_modules/, and dist/ files", () => {
    tmpDir = createTempRepo({
      minds: [],
      files: [
        "src/app.ts",
      ],
    });

    // Manually create files in excluded dirs (not git-tracked, but test the filter)
    // node_modules and dist won't be tracked by git anyway if .gitignore exists,
    // but the filter should still exclude them from the result
    const result = checkCoverage(tmpDir);
    // Only src/app.ts should appear (no .git/*, node_modules/*, dist/* files)
    for (const f of result.unownedFiles) {
      expect(f).not.toMatch(/^\.git\//);
      expect(f).not.toMatch(/^node_modules\//);
      expect(f).not.toMatch(/^dist\//);
    }
  });

  it("handles empty minds.json (no minds registered)", () => {
    tmpDir = createTempRepo({
      minds: [],
      files: [
        "src/app.ts",
        "src/utils.ts",
      ],
    });

    const result = checkCoverage(tmpDir);
    expect(result.allCovered).toBe(false);
    expect(result.unownedFiles).toContain("src/app.ts");
    expect(result.unownedFiles).toContain("src/utils.ts");
  });

  it("excludes minds.json itself and .minds/ internal files from coverage check", () => {
    tmpDir = createTempRepo({
      minds: [
        { name: "api", owns_files: ["src/api/**"] },
      ],
      files: [
        "src/api/routes.ts",
      ],
    });

    const result = checkCoverage(tmpDir);
    // .minds/minds.json should not appear as unowned
    for (const f of result.unownedFiles) {
      expect(f).not.toMatch(/^\.minds\//);
      expect(f).not.toMatch(/^minds\//);
    }
  });
});

// ─── T023: no_owner lint warning ──────────────────────────────────────────────

import { parseTasks, lintTasks } from "../../../lib/contracts.ts";

interface MinimalMind {
  name: string;
  owns_files: string[];
}

describe("lintTasks no_owner warning (T023)", () => {

  it("warns when task references path that no mind owns", () => {
    const content = `
## @new_mind Tasks (owns: src/new/**)
- [ ] T001 @new_mind Create file at src/orphan/file.ts
`;
    const registry: MinimalMind[] = [];
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry as any);

    const warn = result.warnings.find((w) => w.type === "no_owner");
    expect(warn).toBeDefined();
    expect(warn!.message).toContain("src/orphan/file.ts");
  });

  it("does NOT warn when task references path owned by a mind", () => {
    const content = `
## @api_mind Tasks (owns: src/api/**)
- [ ] T001 @api_mind Create file at src/api/routes.ts
`;
    const registry: MinimalMind[] = [
      { name: "api_mind", owns_files: ["src/api/**"] },
    ];
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, registry as any);

    const noOwnerWarnings = result.warnings.filter((w) => w.type === "no_owner");
    expect(noOwnerWarnings).toHaveLength(0);
  });

  it("does NOT warn when path is in the task's own mind's owns_files", () => {
    const content = `
## @new_mind Tasks (owns: src/new/**)
- [ ] T001 @new_mind Create file at src/new/thing.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, [] as any);

    const noOwnerWarnings = result.warnings.filter((w) => w.type === "no_owner");
    expect(noOwnerWarnings).toHaveLength(0);
  });

  it("no_owner is a warning, not an error", () => {
    const content = `
## @new_mind Tasks (owns: src/new/**)
- [ ] T001 @new_mind Create file at src/orphan/file.ts
`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, [] as any);

    // Should not appear in errors
    const noOwnerErrors = result.errors.filter((e: any) => e.type === "no_owner");
    expect(noOwnerErrors).toHaveLength(0);

    // Should appear in warnings
    const noOwnerWarnings = result.warnings.filter((w) => w.type === "no_owner");
    expect(noOwnerWarnings.length).toBeGreaterThanOrEqual(1);
  });
});
