/**
 * tests/unit/installer.test.ts
 *
 * Tests for src/commands/collab.install.ts
 *
 * Each test spawns the installer as a real bun subprocess against a temp git
 * repository. COLLAB_SRC overrides the GitHub clone step — the installer uses
 * the local project as its source. COLLAB_SKIP_BUILD installs a bun-run wrapper
 * instead of a compiled binary so tests run fast without a full bun compile.
 *
 * Tests:
 *  1. Fresh install creates correct directory structure
 *  2. Fresh install copies only 5 core command files
 *  3. No pipeline commands are installed (specify, plan, implement, etc.)
 *  4. CLI binary is executable and --help exits 0
 *  5. State file is initialized as {}
 *  6. Re-install preserves settings.json
 *  7. Re-install preserves constitution
 *  8. Re-install preserves installed-pipelines.json
 *  9. Non-git-repo exits 1
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Absolute path to the installer script
const INSTALLER = join(import.meta.dir, "../../src/commands/collab.install.ts");

// The local collab project — passed as COLLAB_SRC to bypass GitHub clone
const PROJECT_ROOT = join(import.meta.dir, "../../");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(label: string): string {
  const dir = join(tmpdir(), `collab-inst-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function initGitRepo(dir: string): void {
  execSync("git init -q", { cwd: dir, stdio: "pipe" });
}

/** Spawn the installer in targetDir with COLLAB_SRC → local project */
async function runInstaller(
  targetDir: string,
  extraEnv: Partial<NodeJS.ProcessEnv> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", INSTALLER], {
    cwd: targetDir,
    env: {
      ...process.env,
      COLLAB_SRC: PROJECT_ROOT,
      COLLAB_SKIP_BUILD: "1",   // use bun-run wrapper, skip full compile
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode: exitCode ?? 1 };
}

// ─── Shared fresh install (tests 1-5) ─────────────────────────────────────────

let sharedDir = "";

beforeAll(async () => {
  sharedDir = makeTmpDir("fresh");
  initGitRepo(sharedDir);
  const result = await runInstaller(sharedDir);
  if (result.exitCode !== 0) {
    throw new Error(
      `Installer failed in beforeAll:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
}, 60_000); // allow up to 60s for the install

afterAll(() => {
  try {
    rmSync(sharedDir, { recursive: true, force: true });
  } catch {}
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("collab.install.ts", () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  test("1. fresh install creates correct directory structure", () => {
    const expectedDirs = [
      ".claude/commands",
      ".claude/skills",
      ".collab/bin",
      ".collab/handlers",
      ".collab/memory",
      ".collab/scripts/orchestrator",
      ".collab/state/pipeline-registry",
      ".collab/state/pipeline-groups",
    ];

    for (const rel of expectedDirs) {
      const full = join(sharedDir, rel);
      expect(existsSync(full)).toBe(true);
      expect(statSync(full).isDirectory()).toBe(true);
    }
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  test("2. fresh install copies only 5 core command files", () => {
    const commandsDir = join(sharedDir, ".claude/commands");
    const files = readdirSync(commandsDir).sort();

    const expectedFiles = [
      "collab.cleanup.md",
      "collab.install.md",
      "collab.install.ts",
      "collab.run.md",
      "pipelines.md",
    ];

    expect(files).toEqual(expectedFiles);
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  test("3. no pipeline-specific commands are installed", () => {
    const commandsDir = join(sharedDir, ".claude/commands");

    // These are the pipeline commands that should NOT be installed
    const forbidden = [
      "collab.specify.md",
      "collab.plan.md",
      "collab.tasks.md",
      "collab.analyze.md",
      "collab.implement.md",
      "collab.blindqa.md",
      "collab.spec-critique.md",
      "collab.clarify.md",
      "collab.checklist.md",
      "collab.codeReview.md",
      "collab.taskstoissues.md",
      "collab.iosbuild.md",
      "collab.iosverify.md",
      "collab.dependencies.md",
      // Registry-installable phase commands
      "collab.run-tests.md",
      "collab.visual-verify.md",
      "collab.verify-execute.md",
      "collab.pre-deploy-confirm.md",
      "collab.deploy-verify.md",
    ];

    for (const f of forbidden) {
      expect(existsSync(join(commandsDir, f))).toBe(false);
    }
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  test("4. CLI binary is executable and --help exits 0", async () => {
    const binaryPath = join(sharedDir, ".collab/bin/collab");

    // File must exist
    expect(existsSync(binaryPath)).toBe(true);

    // Must have at least one execute bit set
    const mode = statSync(binaryPath).mode;
    expect(mode & 0o111).toBeGreaterThan(0);

    // --help must exit 0
    const proc = Bun.spawn([binaryPath, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  test("5. installed-pipelines.json is initialized as {}", () => {
    const statePath = join(sharedDir, ".collab/state/installed-pipelines.json");
    expect(existsSync(statePath)).toBe(true);

    const content = readFileSync(statePath, "utf8").trim();
    expect(content).toBe("{}");
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  test("6. re-install preserves settings.json", async () => {
    const dir = makeTmpDir("reinst-settings");
    try {
      initGitRepo(dir);

      // First install
      const first = await runInstaller(dir);
      expect(first.exitCode).toBe(0);

      // Write custom settings (simulates user-configured file)
      const settingsPath = join(dir, ".claude/settings.json");
      writeFileSync(settingsPath, JSON.stringify({ myCustomKey: "preserved" }, null, 2));

      // Re-install
      const second = await runInstaller(dir);
      expect(second.exitCode).toBe(0);

      // Settings must be unchanged
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.myCustomKey).toBe("preserved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  test("7. re-install preserves constitution", async () => {
    const dir = makeTmpDir("reinst-constitution");
    try {
      initGitRepo(dir);

      // First install
      const first = await runInstaller(dir);
      expect(first.exitCode).toBe(0);

      // Write custom constitution
      const constitutionPath = join(dir, ".collab/memory/constitution.md");
      writeFileSync(constitutionPath, "# My Custom Constitution\n\nDo not overwrite me.\n");

      // Re-install
      const second = await runInstaller(dir);
      expect(second.exitCode).toBe(0);

      // Constitution must be unchanged
      const content = readFileSync(constitutionPath, "utf8");
      expect(content).toContain("My Custom Constitution");
      expect(content).toContain("Do not overwrite me.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  test("8. re-install preserves installed-pipelines.json", async () => {
    const dir = makeTmpDir("reinst-state");
    try {
      initGitRepo(dir);

      // First install (creates {})
      const first = await runInstaller(dir);
      expect(first.exitCode).toBe(0);

      // Simulate a pipeline having been installed after the first install
      const statePath = join(dir, ".collab/state/installed-pipelines.json");
      const mockState = {
        version: "1",
        installedAt: "2026-03-03T00:00:00.000Z",
        pipelines: { specify: { name: "specify", version: "1.2.0" } },
        clis: {},
      };
      writeFileSync(statePath, JSON.stringify(mockState, null, 2));

      // Re-install
      const second = await runInstaller(dir);
      expect(second.exitCode).toBe(0);

      // State file must be unchanged
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      expect(state.version).toBe("1");
      expect(state.pipelines.specify).toBeDefined();
      expect(state.pipelines.specify.version).toBe("1.2.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Test 9 ────────────────────────────────────────────────────────────────
  test("9. installer exits 1 when run outside a git repository", async () => {
    const dir = makeTmpDir("no-git");
    try {
      // Deliberately do NOT run git init
      const { stderr, exitCode } = await runInstaller(dir);

      expect(exitCode).toBe(1);
      expect(stderr + "").toContain("ERROR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
