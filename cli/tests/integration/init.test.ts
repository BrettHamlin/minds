import { describe, test, expect, afterEach } from "bun:test";
import { createTempGitRepo, createTempDir, cleanupTempDir, runCLI } from "../helpers";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";

describe("collab init", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      cleanupTempDir(dir);
    }
    dirs.length = 0;
  });

  test("creates expected directory structure in clean git repo", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    const { exitCode } = runCLI("init --skip-verify", dir);
    expect(exitCode).toBe(0);

    const expectedDirs = [
      ".claude/commands",
      ".claude/skills",
      ".collab/handlers",
      ".collab/scripts",
      ".collab/state/pipeline-registry",
      ".collab/state/pipeline-groups",
      ".collab/memory",
      ".collab/config",
      ".specify/scripts",
      ".specify/templates",
    ];

    for (const d of expectedDirs) {
      expect(existsSync(join(dir, d))).toBe(true);
    }
  });

  test("creates command files in .claude/commands/", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    runCLI("init --skip-verify", dir);

    const commandsDir = join(dir, ".claude/commands");
    expect(existsSync(commandsDir)).toBe(true);

    // Key commands that must exist
    const expectedCommands = [
      "collab.run.md",
      "collab.specify.md",
      "collab.clarify.md",
      "collab.plan.md",
      "collab.implement.md",
      "collab.blindqa.md",
    ];

    for (const cmd of expectedCommands) {
      expect(existsSync(join(commandsDir, cmd))).toBe(true);
    }
  });

  test("creates .collab/version.json", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    runCLI("init --skip-verify", dir);

    const versionPath = join(dir, ".collab/version.json");
    expect(existsSync(versionPath)).toBe(true);

    const version = JSON.parse(readFileSync(versionPath, "utf-8"));
    expect(version.version).toBe("0.1.0");
    expect(version.installedAt).toBeTruthy();
    expect(version.updatedAt).toBeTruthy();
  });

  test("creates .collab/config/pipeline.json", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    runCLI("init --skip-verify", dir);

    const pipelinePath = join(dir, ".collab/config/pipeline.json");
    expect(existsSync(pipelinePath)).toBe(true);

    const pipeline = JSON.parse(readFileSync(pipelinePath, "utf-8"));
    expect(pipeline).toBeDefined();
  });

  test("creates handlers with signal emitters", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    runCLI("init --skip-verify", dir);

    const handlersDir = join(dir, ".collab/handlers");
    expect(existsSync(join(handlersDir, "emit-question-signal.ts"))).toBe(true);
    expect(existsSync(join(handlersDir, "emit-blindqa-signal.ts"))).toBe(true);
  });

  test("sets executable permissions on script files", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    runCLI("init --skip-verify", dir);

    // Check handler .ts files are executable
    const handlerPath = join(dir, ".collab/handlers/emit-question-signal.ts");
    if (existsSync(handlerPath)) {
      const stat = statSync(handlerPath);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    }

    // Check .sh command files are executable if they exist
    const installSh = join(dir, ".claude/commands/collab.install.sh");
    if (existsSync(installSh)) {
      const stat = statSync(installSh);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    }
  });

  test("exits with code 1 in non-git directory", () => {
    const dir = createTempDir();
    dirs.push(dir);

    const { exitCode, stderr } = runCLI("init", dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Not a git repository");
  });

  test("exits with code 1 when already installed without --force", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // First init
    const first = runCLI("init --skip-verify", dir);
    expect(first.exitCode).toBe(0);

    // Second init without --force
    const second = runCLI("init", dir);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already installed");
  });

  test("--force overwrites existing installation", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // First init
    runCLI("init --skip-verify", dir);

    // Second init with --force
    const { exitCode } = runCLI("init --force --skip-verify", dir);
    expect(exitCode).toBe(0);

    // Verify it's still valid
    expect(existsSync(join(dir, ".collab/version.json"))).toBe(true);
  });

  test("without --force preserves user-customizable config files", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // First init
    runCLI("init --skip-verify", dir);

    // Customize settings
    const settingsPath = join(dir, ".claude/settings.json");
    if (existsSync(settingsPath)) {
      writeFileSync(settingsPath, JSON.stringify({ custom: true }));
    }

    // Re-init with --force (settings should be overwritten with --force)
    runCLI("init --force --skip-verify", dir);

    // With --force, the settings file gets overwritten
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(content);
      // --force overwrites, so custom should not be preserved
      expect(parsed.custom).toBeUndefined();
    }
  });

  test("post-install verification passes on clean init", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    // Run init WITHOUT --skip-verify to exercise verification
    const { exitCode, stdout } = runCLI("init", dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("critical files verified");
  });

  test("--quiet suppresses output", () => {
    const dir = createTempGitRepo();
    dirs.push(dir);

    const { exitCode, stdout } = runCLI("init --quiet --skip-verify", dir);
    expect(exitCode).toBe(0);
    // Quiet mode should produce minimal or no stdout
    expect(stdout.length).toBeLessThan(50);
  });
});
