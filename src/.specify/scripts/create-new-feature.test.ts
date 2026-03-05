import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { join, basename, resolve } from "path";
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import {
  extractTicketId,
  cleanBranchName,
  generateBranchName,
  getHighestFromSpecs,
} from "./create-new-feature";

const SCRIPT_PATH = join(import.meta.dir, "create-new-feature.ts");

// ─── Unit Tests: extractTicketId ─────────────────────────────────────────────

describe("extractTicketId", () => {
  // Standard formats
  test('"BRE-123: Add feature" -> "BRE-123"', () => {
    expect(extractTicketId("BRE-123: Add feature")).toBe("BRE-123");
  });

  test('"PROJ-456 Fix bug" -> "PROJ-456"', () => {
    expect(extractTicketId("PROJ-456 Fix bug")).toBe("PROJ-456");
  });

  test('"FEAT-789 Update docs" -> "FEAT-789"', () => {
    expect(extractTicketId("FEAT-789 Update docs")).toBe("FEAT-789");
  });

  // Custom ticket systems
  test('"CUSTOM-999: New ticket system" -> "CUSTOM-999"', () => {
    expect(extractTicketId("CUSTOM-999: New ticket system")).toBe("CUSTOM-999");
  });

  test('"ABC-1 Short prefix" -> "ABC-1"', () => {
    expect(extractTicketId("ABC-1 Short prefix")).toBe("ABC-1");
  });

  test('"JIRA-12345 Long number" -> "JIRA-12345"', () => {
    expect(extractTicketId("JIRA-12345 Long number")).toBe("JIRA-12345");
  });

  // No ticket ID (should return empty)
  test('"No ticket here" -> ""', () => {
    expect(extractTicketId("No ticket here")).toBe("");
  });

  test('"Add authentication" -> ""', () => {
    expect(extractTicketId("Add authentication")).toBe("");
  });

  test('"Fix the bug in the system" -> ""', () => {
    expect(extractTicketId("Fix the bug in the system")).toBe("");
  });

  // Edge cases
  test('"BRE-123 and PROJ-456 both present" -> "BRE-123" (first match)', () => {
    expect(extractTicketId("BRE-123 and PROJ-456 both present")).toBe(
      "BRE-123"
    );
  });

  test('"lowercase-123 should not match" -> ""', () => {
    expect(extractTicketId("lowercase-123 should not match")).toBe("");
  });
});

// ─── Unit Tests: cleanBranchName ─────────────────────────────────────────────

describe("cleanBranchName", () => {
  test('"Hello World!" -> "hello-world"', () => {
    expect(cleanBranchName("Hello World!")).toBe("hello-world");
  });

  test('"--leading--trailing--" -> "leading-trailing"', () => {
    expect(cleanBranchName("--leading--trailing--")).toBe("leading-trailing");
  });

  test("lowercases and replaces non-alphanumeric chars", () => {
    expect(cleanBranchName("Foo Bar_Baz")).toBe("foo-bar-baz");
  });

  test("collapses multiple dashes", () => {
    expect(cleanBranchName("a---b---c")).toBe("a-b-c");
  });
});

// ─── Unit Tests: generateBranchName ──────────────────────────────────────────

describe("generateBranchName", () => {
  test('"Add user authentication system" -> contains meaningful words, not "add"', () => {
    const result = generateBranchName("Add user authentication system");
    expect(result).not.toContain("add");
    expect(result).toContain("user");
    expect(result).toContain("authentication");
    expect(result).toContain("system");
  });

  test('"Implement OAuth2 integration" -> includes "oauth2"', () => {
    const result = generateBranchName("Implement OAuth2 integration");
    expect(result).toContain("oauth2");
    expect(result).toContain("integration");
  });

  test("filters stop words", () => {
    const result = generateBranchName("I want to add the feature for my thing");
    // all stop words removed; "feature" and "thing" should remain
    expect(result).toContain("feature");
    expect(result).toContain("thing");
  });

  test("takes first 3 words by default, 4 when exactly 4 meaningful words", () => {
    // 5 meaningful words -> first 3
    const r = generateBranchName("alpha beta gamma delta epsilon");
    const parts = r.split("-");
    expect(parts.length).toBe(3);
  });
});

// ─── Unit Tests: getHighestFromSpecs ─────────────────────────────────────────

describe("getHighestFromSpecs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `specs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns 0 for empty directory", () => {
    expect(getHighestFromSpecs(tmpDir)).toBe(0);
  });

  test("returns 0 for non-existent directory", () => {
    expect(getHighestFromSpecs("/tmp/does-not-exist-" + Date.now())).toBe(0);
  });

  test("finds highest numeric prefix", () => {
    mkdirSync(join(tmpDir, "001-first"), { recursive: true });
    mkdirSync(join(tmpDir, "005-fifth"), { recursive: true });
    mkdirSync(join(tmpDir, "003-third"), { recursive: true });
    expect(getHighestFromSpecs(tmpDir)).toBe(5);
  });

  test("ignores non-numeric prefixes", () => {
    mkdirSync(join(tmpDir, "foo-bar"), { recursive: true });
    mkdirSync(join(tmpDir, "002-second"), { recursive: true });
    expect(getHighestFromSpecs(tmpDir)).toBe(2);
  });
});

// ─── E2E Tests ───────────────────────────────────────────────────────────────

describe("create-new-feature E2E", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cnf-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("--help exits 0 and prints Usage:", async () => {
    const proc = Bun.spawn(["bun", SCRIPT_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: tmpDir,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  test("no args exits 1 and prints Usage: to stderr", async () => {
    const proc = Bun.spawn(["bun", SCRIPT_PATH], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: tmpDir,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("--json --worktree --number 5 --short-name user-auth in temp git repo", async () => {
    // Initialize a git repo
    Bun.spawnSync(["git", "init"], { cwd: tmpDir });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
    });

    const worktreePath = join(tmpDir, "worktrees");
    const proc = Bun.spawn(
      [
        "bun",
        SCRIPT_PATH,
        "--json",
        "--worktree",
        "--worktree-path",
        worktreePath,
        "--number",
        "5",
        "--short-name",
        "user-auth",
        "Add user authentication",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmpDir,
      }
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout.trim());
    expect(json.BRANCH_NAME).toBe("005-user-auth");
    expect(json.FEATURE_NUM).toBe("005");
    expect(json.SPEC_FILE).toBeTruthy();
    expect(json.WORKTREE_DIR).toBeTruthy();

    // Verify files were created
    expect(existsSync(json.WORKTREE_DIR)).toBe(true);
    expect(existsSync(json.SPEC_FILE)).toBe(true);
  });
});

// ─── Integration Tests: branch-exists handling ────────────────────────────────

describe("create-new-feature handles existing branches", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cnf-branch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    Bun.spawnSync(["git", "init"], { cwd: tmpDir });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("succeeds when branch already exists from a previous run", async () => {
    // Create the branch first (simulates a previous run)
    Bun.spawnSync(["git", "branch", "001-existing-feat"], { cwd: tmpDir });

    const worktreePath = join(tmpDir, "worktrees");
    const proc = Bun.spawn(
      [
        "bun", SCRIPT_PATH,
        "--json", "--worktree",
        "--worktree-path", worktreePath,
        "--number", "1",
        "--short-name", "existing-feat",
        "Test existing branch",
      ],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir }
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout.trim());
    expect(json.BRANCH_NAME).toBe("001-existing-feat");
    expect(json.WORKTREE_DIR).toBeTruthy();
    expect(existsSync(json.WORKTREE_DIR)).toBe(true);
  });

  test("reuses existing worktree when both branch and worktree exist", async () => {
    // Create branch and worktree (simulates complete previous run)
    const worktreePath = join(tmpDir, "worktrees");
    mkdirSync(worktreePath, { recursive: true });
    Bun.spawnSync(["git", "worktree", "add", join(worktreePath, "001-reuse-test"), "-b", "001-reuse-test"], { cwd: tmpDir });

    const proc = Bun.spawn(
      [
        "bun", SCRIPT_PATH,
        "--json", "--worktree",
        "--worktree-path", worktreePath,
        "--number", "1",
        "--short-name", "reuse-test",
        "Test reuse worktree",
      ],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir }
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Worktree already exists");
  });
});

// ─── Integration Tests: --source-repo writes repo_id to metadata.json ────────

describe("--source-repo writes repo_id to metadata.json", () => {
  let controlDir: string; // simulates the collab control plane repo
  let sourceDir: string;  // simulates the external source repo

  beforeEach(() => {
    controlDir = join(tmpdir(), `cnf-control-${process.pid}-${Date.now()}`);
    sourceDir = join(tmpdir(), `cnf-source-${process.pid}-${Date.now()}`);
    mkdirSync(controlDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    // Init control repo (where create-new-feature.ts runs from)
    Bun.spawnSync(["git", "init"], { cwd: controlDir });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], { cwd: controlDir });

    // Init source repo (passed via --source-repo)
    Bun.spawnSync(["git", "init"], { cwd: sourceDir });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], { cwd: sourceDir });
  });

  afterEach(() => {
    try { rmSync(controlDir, { recursive: true }); } catch { /* ignore */ }
    try { rmSync(sourceDir, { recursive: true }); } catch { /* ignore */ }
  });

  test("--source-repo writes repo_id = basename of resolved source path", async () => {
    const worktreePath = join(controlDir, "worktrees");
    const proc = Bun.spawn(
      [
        "bun", SCRIPT_PATH,
        "--json",
        "--worktree",
        "--worktree-path", worktreePath,
        "--number", "1",
        "--short-name", "cross-repo",
        "--source-repo", sourceDir,
        "BRE-340: Cross-repo feature",
      ],
      { stdout: "pipe", stderr: "pipe", cwd: controlDir }
    );
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout.trim());
    const branchName = json.BRANCH_NAME;

    // metadata.json is written to specs/<branch>/ in the control repo
    const metadataPath = join(controlDir, "specs", branchName, "metadata.json");
    expect(existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    expect(metadata.repo_id).toBe(basename(resolve(sourceDir)));
  });

  test("repo_id equals basename of resolved source path (trailing slash stripped)", async () => {
    const worktreePath = join(controlDir, "worktrees");
    const sourceWithSlash = sourceDir + "/";
    const proc = Bun.spawn(
      [
        "bun", SCRIPT_PATH,
        "--json",
        "--worktree",
        "--worktree-path", worktreePath,
        "--number", "2",
        "--short-name", "trailing-slash",
        "--source-repo", sourceWithSlash,
        "BRE-340: Trailing slash test",
      ],
      { stdout: "pipe", stderr: "pipe", cwd: controlDir }
    );
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout.trim());
    const branchName = json.BRANCH_NAME;
    const metadataPath = join(controlDir, "specs", branchName, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

    // resolve() strips trailing slash before basename() runs
    expect(metadata.repo_id).toBe(basename(resolve(sourceDir)));
    expect(metadata.repo_id).not.toContain("/");
  });

  test("WITHOUT --source-repo, repo_id is absent from metadata.json (backward compat)", async () => {
    const worktreePath = join(controlDir, "worktrees");
    const proc = Bun.spawn(
      [
        "bun", SCRIPT_PATH,
        "--json",
        "--worktree",
        "--worktree-path", worktreePath,
        "--number", "3",
        "--short-name", "no-source",
        "BRE-340: No source repo",
      ],
      { stdout: "pipe", stderr: "pipe", cwd: controlDir }
    );
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout.trim());
    const branchName = json.BRANCH_NAME;
    const metadataPath = join(controlDir, "specs", branchName, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

    expect(metadata).not.toHaveProperty("repo_id");
  });
});
