import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  scaffoldE2eTests,
  buildE2eClaudeMdContent,
  ensurePlaywrightDep,
  checkBaselineTag,
} from "../core.js";

// Use OS tmpdir so git does not walk up to the enclosing project repo
const TMP = join(tmpdir(), "__minds_e2e_scaffold_test__");

function makeRepo(): string {
  const repoRoot = join(TMP, `repo-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoRoot, { recursive: true });
  return repoRoot;
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CLAUDE_COMMANDS entries (T001, T002)
// ---------------------------------------------------------------------------

describe("CLAUDE_COMMANDS — test and compare-design entries", () => {
  it("installs minds.test.md command when source exists", async () => {
    const repoRoot = makeRepo();
    const srcDir = join(TMP, "minds-src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
    const commandsSrc = join(srcDir, "commands");
    mkdirSync(commandsSrc, { recursive: true });
    writeFileSync(join(commandsSrc, "test.md"), "# test command");

    const { installCoreMinds } = await import("../core.js");
    await installCoreMinds(srcDir, repoRoot, { quiet: true });

    expect(existsSync(join(repoRoot, ".claude", "commands", "minds.test.md"))).toBe(true);
    expect(readFileSync(join(repoRoot, ".claude", "commands", "minds.test.md"), "utf-8")).toBe(
      "# test command"
    );
  });

  it("installs minds.compare-design.md command when source exists", async () => {
    const repoRoot = makeRepo();
    const srcDir = join(TMP, "minds-src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
    const commandsSrc = join(srcDir, "commands");
    mkdirSync(commandsSrc, { recursive: true });
    writeFileSync(join(commandsSrc, "compare-design.md"), "# compare-design command");

    const { installCoreMinds } = await import("../core.js");
    await installCoreMinds(srcDir, repoRoot, { quiet: true });

    expect(
      existsSync(join(repoRoot, ".claude", "commands", "minds.compare-design.md"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildE2eClaudeMdContent (T004)
// ---------------------------------------------------------------------------

describe("buildE2eClaudeMdContent", () => {
  it("contains scenario-based test template", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain('test("scenario:');
    expect(content).toContain("@playwright/test");
  });

  it("contains server startup section with blank placeholder", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain("PORT=3099");
    expect(content).toContain("<your-server-entrypoint>");
  });

  it("contains mind label table header", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain("| Mind | Label | Test File |");
  });

  it("populates mind label table from registry using label field when present", () => {
    const content = buildE2eClaudeMdContent([
      { name: "blueprint-api", label: "@blueprint-api" },
      { name: "router", label: "@router" },
    ]);
    expect(content).toContain("| blueprint-api | @blueprint-api |");
    expect(content).toContain("| router | @router |");
  });

  it("derives label as @name when label field is absent", () => {
    const content = buildE2eClaudeMdContent([{ name: "memory" }]);
    expect(content).toContain("| memory | @memory |");
  });

  it("shows placeholder row when no minds are provided", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain("(none yet)");
  });

  it("contains registry.json snippet showing the test registration format", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain("registry.json");
    expect(content).toContain('"mind"');
    expect(content).toContain('"file"');
  });

  it("contains visual comparison instructions referencing /minds.compare-design", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain("/minds.compare-design");
  });

  it("contains baseline tag instructions", () => {
    const content = buildE2eClaudeMdContent([]);
    expect(content).toContain("v1.0.0");
    expect(content).toContain("git tag v1.0.0");
  });
});

// ---------------------------------------------------------------------------
// ensurePlaywrightDep (T005)
// ---------------------------------------------------------------------------

describe("ensurePlaywrightDep", () => {
  it("returns error when package.json does not exist", () => {
    const repoRoot = makeRepo();
    const result = ensurePlaywrightDep(repoRoot);
    expect(result.added).toBe(false);
    expect(result.alreadyPresent).toBe(false);
    expect(result.error).toContain("package.json not found");
  });

  it("returns alreadyPresent true when @playwright/test is in devDependencies", () => {
    const repoRoot = makeRepo();
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }, null, 2)
    );
    const result = ensurePlaywrightDep(repoRoot);
    expect(result.alreadyPresent).toBe(true);
    expect(result.added).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns alreadyPresent true when @playwright/test is in dependencies", () => {
    const repoRoot = makeRepo();
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({ dependencies: { "@playwright/test": "^1.0.0" } }, null, 2)
    );
    const result = ensurePlaywrightDep(repoRoot);
    expect(result.alreadyPresent).toBe(true);
  });

  it("returns error when package.json is malformed JSON", () => {
    const repoRoot = makeRepo();
    writeFileSync(join(repoRoot, "package.json"), "NOT JSON {{{{");
    const result = ensurePlaywrightDep(repoRoot);
    expect(result.added).toBe(false);
    expect(result.alreadyPresent).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkBaselineTag (T006)
// ---------------------------------------------------------------------------

describe("checkBaselineTag", () => {
  function initGitRepo(dir: string): void {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test");
    execSync("git add README.md", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
  }

  it("returns hasTag true when v1.0.0 tag exists", () => {
    const repoRoot = makeRepo();
    initGitRepo(repoRoot);
    execSync("git tag v1.0.0", { cwd: repoRoot, stdio: "ignore" });
    const result = checkBaselineTag(repoRoot);
    expect(result.hasTag).toBe(true);
    expect(result.suggestion).toBeUndefined();
  });

  it("returns hasTag false and suggestion when v1.0.0 tag is missing", () => {
    const repoRoot = makeRepo();
    initGitRepo(repoRoot);
    const result = checkBaselineTag(repoRoot);
    expect(result.hasTag).toBe(false);
    expect(result.suggestion).toContain("v1.0.0");
  });

  it("returns hasTag false when directory is not a git repo", () => {
    const repoRoot = makeRepo();
    const result = checkBaselineTag(repoRoot);
    expect(result.hasTag).toBe(false);
    expect(result.suggestion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// scaffoldE2eTests (T003, T007)
// ---------------------------------------------------------------------------

describe("scaffoldE2eTests", () => {
  it("creates tests/e2e/ directory", async () => {
    const repoRoot = makeRepo();
    await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(existsSync(join(repoRoot, "tests", "e2e"))).toBe(true);
  });

  it("creates registry.json with empty tests array (T007)", async () => {
    const repoRoot = makeRepo();
    await scaffoldE2eTests(repoRoot, { quiet: true });
    const registryPath = join(repoRoot, "tests", "e2e", "registry.json");
    expect(existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    expect(registry).toEqual({ tests: [] });
    expect(Array.isArray(registry.tests)).toBe(true);
  });

  it("registry.json path is recorded in created list", async () => {
    const repoRoot = makeRepo();
    const result = await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(result.created).toContain("tests/e2e/registry.json");
  });

  it("creates CLAUDE.md with template content", async () => {
    const repoRoot = makeRepo();
    await scaffoldE2eTests(repoRoot, { quiet: true });
    const claudeMdPath = join(repoRoot, "tests", "e2e", "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);
    const content = readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("scenario:");
    expect(content).toContain("/minds.test");
  });

  it("CLAUDE.md path is recorded in created list", async () => {
    const repoRoot = makeRepo();
    const result = await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(result.created).toContain("tests/e2e/CLAUDE.md");
  });

  it("populates CLAUDE.md mind label table from .minds/minds.json if present", async () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, ".minds"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".minds", "minds.json"),
      JSON.stringify([{ name: "blueprint-api", label: "@blueprint-api" }], null, 2)
    );
    await scaffoldE2eTests(repoRoot, { quiet: true });
    const content = readFileSync(join(repoRoot, "tests", "e2e", "CLAUDE.md"), "utf-8");
    expect(content).toContain("@blueprint-api");
  });

  it("skips existing files when force is false", async () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, "tests", "e2e"), { recursive: true });
    writeFileSync(join(repoRoot, "tests", "e2e", "registry.json"), '{"tests":[{"mind":"@x","file":"x.ts"}]}');
    writeFileSync(join(repoRoot, "tests", "e2e", "CLAUDE.md"), "# existing");

    const result = await scaffoldE2eTests(repoRoot, { quiet: true, force: false });

    expect(result.skipped).toContain("tests/e2e/registry.json");
    expect(result.skipped).toContain("tests/e2e/CLAUDE.md");
    // Files should not be overwritten
    expect(readFileSync(join(repoRoot, "tests", "e2e", "registry.json"), "utf-8")).toContain("@x");
    expect(readFileSync(join(repoRoot, "tests", "e2e", "CLAUDE.md"), "utf-8")).toBe("# existing");
  });

  it("overwrites existing files when force is true", async () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, "tests", "e2e"), { recursive: true });
    writeFileSync(join(repoRoot, "tests", "e2e", "registry.json"), "OLD");
    writeFileSync(join(repoRoot, "tests", "e2e", "CLAUDE.md"), "OLD");

    const result = await scaffoldE2eTests(repoRoot, { quiet: true, force: true });

    expect(result.created).toContain("tests/e2e/registry.json");
    expect(result.created).toContain("tests/e2e/CLAUDE.md");
    const registry = JSON.parse(readFileSync(join(repoRoot, "tests", "e2e", "registry.json"), "utf-8"));
    expect(registry).toEqual({ tests: [] });
  });

  it("handles missing .minds/minds.json gracefully — no error", async () => {
    const repoRoot = makeRepo();
    const result = await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(result.errors.filter((e) => !e.includes("playwright"))).toHaveLength(0);
  });

  it("records baselineTagFound false when repo has no git", async () => {
    const repoRoot = makeRepo();
    const result = await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(result.baselineTagFound).toBe(false);
  });

  it("records baselineTagFound true when v1.0.0 tag exists", async () => {
    const repoRoot = makeRepo();
    execSync("git init", { cwd: repoRoot, stdio: "ignore" });
    execSync("git config user.email t@t.com", { cwd: repoRoot, stdio: "ignore" });
    execSync("git config user.name T", { cwd: repoRoot, stdio: "ignore" });
    writeFileSync(join(repoRoot, "README.md"), "x");
    execSync("git add README.md", { cwd: repoRoot, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
    execSync("git tag v1.0.0", { cwd: repoRoot, stdio: "ignore" });

    const result = await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(result.baselineTagFound).toBe(true);
  });

  it("returns correct result shape with all required fields", async () => {
    const repoRoot = makeRepo();
    const result = await scaffoldE2eTests(repoRoot, { quiet: true });
    expect(Array.isArray(result.created)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.playwrightAdded).toBe("boolean");
    expect(typeof result.baselineTagFound).toBe("boolean");
  });
});
