import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { installCoreMinds, generateClaudeSettings, getInstalledHookFiles } from "./core.js";

/**
 * Tests for hooks installation step in installCoreMinds.
 *
 * Uses a temporary directory with a minimal minds source layout
 * (server-base.ts sentinel so getMindsSourceDir-style checks pass)
 * and verifies hooks are copied to .claude/hooks/ with executable perms.
 */

const TMP = join(import.meta.dir, "__test_tmp_hooks__");

function setupTmpDirs() {
  const srcDir = join(TMP, "minds-src");
  const repoRoot = join(TMP, "repo");
  // installCoreMinds needs server-base.ts in source dir to consider it valid
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
  mkdirSync(repoRoot, { recursive: true });
  return { srcDir, repoRoot };
}

describe("installCoreMinds — hooks installation", () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("copies hook files to .claude/hooks/ with executable permissions", () => {
    const { srcDir, repoRoot } = setupTmpDirs();
    // Create a hooks source directory with a sample hook
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, "pre-commit.sh"), "#!/bin/bash\necho hello");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    const destHook = join(repoRoot, ".claude", "hooks", "pre-commit.sh");
    expect(existsSync(destHook)).toBe(true);
    expect(readFileSync(destHook, "utf-8")).toBe("#!/bin/bash\necho hello");

    // Verify executable permission (owner execute bit)
    const mode = statSync(destHook).mode;
    expect(mode & 0o755).toBe(0o755);

    expect(result.copied).toContain(".claude/hooks/pre-commit.sh");
    expect(result.errors).toHaveLength(0);
  });

  it("skips .gitkeep files in hooks directory", () => {
    const { srcDir, repoRoot } = setupTmpDirs();
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, ".gitkeep"), "");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    const destGitkeep = join(repoRoot, ".claude", "hooks", ".gitkeep");
    expect(existsSync(destGitkeep)).toBe(false);
    // .claude/hooks/ dir should not even be created if only .gitkeep present
    expect(existsSync(join(repoRoot, ".claude", "hooks"))).toBe(false);
  });

  it("gracefully handles missing hooks directory", () => {
    const { srcDir, repoRoot } = setupTmpDirs();
    // No hooks/ directory in source at all

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    expect(existsSync(join(repoRoot, ".claude", "hooks"))).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it("skips existing hook files when force is false", () => {
    const { srcDir, repoRoot } = setupTmpDirs();
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, "post-push.sh"), "#!/bin/bash\nnew content");

    // Pre-create the destination hook with old content
    const destDir = join(repoRoot, ".claude", "hooks");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "post-push.sh"), "#!/bin/bash\nold content");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true, force: false });

    // Should NOT overwrite
    expect(readFileSync(join(destDir, "post-push.sh"), "utf-8")).toBe("#!/bin/bash\nold content");
    expect(result.skipped).toContain(".claude/hooks/post-push.sh");
  });

  it("overwrites existing hook files when force is true", () => {
    const { srcDir, repoRoot } = setupTmpDirs();
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, "post-push.sh"), "#!/bin/bash\nnew content");

    // Pre-create the destination hook with old content
    const destDir = join(repoRoot, ".claude", "hooks");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "post-push.sh"), "#!/bin/bash\nold content");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true, force: true });

    expect(readFileSync(join(destDir, "post-push.sh"), "utf-8")).toBe("#!/bin/bash\nnew content");
    expect(result.copied).toContain(".claude/hooks/post-push.sh");
  });
});

describe("installCoreMinds — test artifact filtering", () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("skips directories matching test artifact prefixes (_ta_, _tb_, _tc_, _test_)", () => {
    const { srcDir, repoRoot } = setupTmpDirs();

    // Create a core Mind directory with test artifact subdirectories
    const libSrc = join(srcDir, "lib");
    mkdirSync(libSrc, { recursive: true });
    writeFileSync(join(libSrc, "real-module.ts"), "export const x = 1;");

    // Create test artifact directories with files inside them
    const testArtifactDirs = [
      "_ta_some_test",
      "_tb_another_test",
      "_tc_yet_another",
      "_test_idem_foo",
      "_test_path_bar",
      "_test_provision_baz",
      "_test_real_qux",
      "_test_seed_abc",
    ];
    for (const dir of testArtifactDirs) {
      const artifactDir = join(libSrc, dir);
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, "artifact.json"), "{}");
    }

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    // Real module should be copied
    expect(existsSync(join(repoRoot, ".minds", "lib", "real-module.ts"))).toBe(true);

    // All test artifact directories should be skipped
    for (const dir of testArtifactDirs) {
      expect(existsSync(join(repoRoot, ".minds", "lib", dir))).toBe(false);
    }

    // None of the artifact files should appear in copied list
    const copiedStr = result.copied.join("\n");
    for (const dir of testArtifactDirs) {
      expect(copiedStr).not.toContain(dir);
    }
  });

  it("skips __tests__ directories", () => {
    const { srcDir, repoRoot } = setupTmpDirs();

    const libSrc = join(srcDir, "lib");
    mkdirSync(libSrc, { recursive: true });
    writeFileSync(join(libSrc, "utils.ts"), "export const y = 2;");

    const testsDir = join(libSrc, "__tests__");
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(testsDir, "utils.test.ts"), "// test file");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    expect(existsSync(join(repoRoot, ".minds", "lib", "utils.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, ".minds", "lib", "__tests__"))).toBe(false);
  });

  it("still copies directories that do not match skip patterns", () => {
    const { srcDir, repoRoot } = setupTmpDirs();

    const libSrc = join(srcDir, "lib");
    const subDir = join(libSrc, "helpers");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "index.ts"), "export default {};");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    expect(existsSync(join(repoRoot, ".minds", "lib", "helpers", "index.ts"))).toBe(true);
  });
});

describe("generateClaudeSettings", () => {
  const TMP_SETTINGS = join(import.meta.dir, "__test_tmp_settings__");

  beforeEach(() => {
    rmSync(TMP_SETTINGS, { recursive: true, force: true });
    mkdirSync(TMP_SETTINGS, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_SETTINGS, { recursive: true, force: true });
  });

  it("generates hooks section from hook filenames with known event types", () => {
    const result = generateClaudeSettings([
      "PreToolUse.validate.ts",
      "PostToolUse.capture.ts",
    ]);

    const hooks = result.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PostToolUse).toHaveLength(1);

    const preEntry = hooks.PreToolUse[0] as { hooks: Array<{ type: string; command: string }> };
    expect(preEntry.hooks[0].type).toBe("command");
    expect(preEntry.hooks[0].command).toBe(".claude/hooks/PreToolUse.validate.ts");
  });

  it("skips hook files that do not match a known event type", () => {
    const result = generateClaudeSettings([
      "random-script.sh",
      "PreToolUse.validate.ts",
    ]);

    const hooks = result.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
    // random-script.sh should not appear anywhere
    expect(Object.keys(hooks)).toEqual(["PreToolUse"]);
  });

  it("returns settings unchanged when no hook files match known events", () => {
    const result = generateClaudeSettings(["random.sh", "no-event.ts"]);
    expect(result.hooks).toBeUndefined();
  });

  it("merges with existing settings without overwriting other keys", () => {
    const settingsPath = join(TMP_SETTINGS, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      env: { FOO: "bar" },
      permissions: { allow: ["Bash"] },
    }, null, 2));

    const result = generateClaudeSettings(["SessionStart.init.ts"], settingsPath);

    expect((result as Record<string, unknown>).env).toEqual({ FOO: "bar" });
    expect((result as Record<string, unknown>).permissions).toEqual({ allow: ["Bash"] });
    const hooks = result.hooks as Record<string, unknown[]>;
    expect(hooks.SessionStart).toHaveLength(1);
  });

  it("merges hooks with existing hook entries and avoids duplicates", () => {
    const settingsPath = join(TMP_SETTINGS, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: ".claude/hooks/PreToolUse.validate.ts" }],
          },
        ],
      },
    }, null, 2));

    const result = generateClaudeSettings([
      "PreToolUse.validate.ts",  // duplicate — should be deduped
      "PreToolUse.security.ts",  // new — should be added
    ], settingsPath);

    const hooks = result.hooks as Record<string, unknown[]>;
    // Original entry + 1 new entry (duplicate skipped)
    expect(hooks.PreToolUse).toHaveLength(2);
  });

  it("handles corrupt existing settings gracefully", () => {
    const settingsPath = join(TMP_SETTINGS, "settings.json");
    writeFileSync(settingsPath, "NOT VALID JSON {{{");

    const result = generateClaudeSettings(["Stop.cleanup.ts"], settingsPath);
    const hooks = result.hooks as Record<string, unknown[]>;
    expect(hooks.Stop).toHaveLength(1);
  });

  it("groups multiple hooks under the same event type", () => {
    const result = generateClaudeSettings([
      "PreToolUse.validate.ts",
      "PreToolUse.security.ts",
      "PreToolUse.audit.ts",
    ]);

    const hooks = result.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(3);
  });
});

describe("getInstalledHookFiles", () => {
  const TMP_HOOKS = join(import.meta.dir, "__test_tmp_gethooks__");

  beforeEach(() => {
    rmSync(TMP_HOOKS, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TMP_HOOKS, { recursive: true, force: true });
  });

  it("returns empty array for non-existent directory", () => {
    expect(getInstalledHookFiles(join(TMP_HOOKS, "nope"))).toEqual([]);
  });

  it("filters out .gitkeep and dotfiles", () => {
    mkdirSync(TMP_HOOKS, { recursive: true });
    writeFileSync(join(TMP_HOOKS, ".gitkeep"), "");
    writeFileSync(join(TMP_HOOKS, ".hidden"), "");
    writeFileSync(join(TMP_HOOKS, "PreToolUse.validate.ts"), "");

    const result = getInstalledHookFiles(TMP_HOOKS);
    expect(result).toEqual(["PreToolUse.validate.ts"]);
  });
});

describe("installCoreMinds — commander dependency installation", () => {
  const TMP_CMD = join(import.meta.dir, "__test_tmp_commander__");

  beforeEach(() => {
    rmSync(TMP_CMD, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TMP_CMD, { recursive: true, force: true });
  });

  it("creates package.json in .minds/ and installs commander", () => {
    const srcDir = join(TMP_CMD, "minds-src");
    const repoRoot = join(TMP_CMD, "repo");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
    mkdirSync(repoRoot, { recursive: true });

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    const pkgJson = join(repoRoot, ".minds", "package.json");
    expect(existsSync(pkgJson)).toBe(true);

    const pkg = JSON.parse(readFileSync(pkgJson, "utf-8"));
    expect(pkg.name).toBe("minds-runtime");
    expect(pkg.private).toBe(true);

    // commander should be in dependencies after bun add
    // (check node_modules or package.json dependencies)
    if (result.bunVerified) {
      const updatedPkg = JSON.parse(readFileSync(pkgJson, "utf-8"));
      expect(updatedPkg.dependencies?.commander).toBeDefined();
    }
  });
});

describe("installCoreMinds — settings.json generation", () => {
  const TMP_SETTINGS_INT = join(import.meta.dir, "__test_tmp_settings_int__");

  beforeEach(() => {
    rmSync(TMP_SETTINGS_INT, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TMP_SETTINGS_INT, { recursive: true, force: true });
  });

  it("generates .claude/settings.json when hooks are installed", () => {
    const srcDir = join(TMP_SETTINGS_INT, "minds-src");
    const repoRoot = join(TMP_SETTINGS_INT, "repo");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
    mkdirSync(repoRoot, { recursive: true });

    // Create a hooks directory with a properly-named hook
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, "PreToolUse.validate.ts"), "#!/usr/bin/env bun\nconsole.log('ok')");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    const settingsPath = join(repoRoot, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    expect(result.copied).toContain(".claude/settings.json");

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
  });

  it("does not create settings.json when only .gitkeep is in hooks", () => {
    const srcDir = join(TMP_SETTINGS_INT, "minds-src");
    const repoRoot = join(TMP_SETTINGS_INT, "repo");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
    mkdirSync(repoRoot, { recursive: true });

    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, ".gitkeep"), "");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    const settingsPath = join(repoRoot, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(false);
    expect(result.copied).not.toContain(".claude/settings.json");
  });

  it("preserves existing settings.json content when merging hooks", () => {
    const srcDir = join(TMP_SETTINGS_INT, "minds-src");
    const repoRoot = join(TMP_SETTINGS_INT, "repo");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "server-base.ts"), "// sentinel");
    mkdirSync(repoRoot, { recursive: true });

    // Pre-create .claude/settings.json with user content
    const claudeDir = join(repoRoot, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({
      env: { MY_VAR: "keep-me" },
    }, null, 2));

    // Create hook source
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });
    writeFileSync(join(hooksSrc, "Stop.cleanup.ts"), "#!/usr/bin/env bun\n");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.env).toEqual({ MY_VAR: "keep-me" });
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});

describe("installCoreMinds — shouldSkipEntry applied to hooks", () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("skips hook files matching skip patterns (e.g. .test.ts) but copies legitimate hooks", () => {
    const { srcDir, repoRoot } = setupTmpDirs();
    const hooksSrc = join(srcDir, "hooks");
    mkdirSync(hooksSrc, { recursive: true });

    // Legitimate hook file — should be copied
    writeFileSync(join(hooksSrc, "PreToolUse.validate.ts"), "#!/usr/bin/env bun\nconsole.log('ok')");

    // Files matching skip patterns — should NOT be copied
    writeFileSync(join(hooksSrc, "something.test.ts"), "// test file that should be skipped");
    writeFileSync(join(hooksSrc, "another.test.js"), "// js test file that should be skipped");
    writeFileSync(join(hooksSrc, "smoke-result.json"), "{}");

    const result = installCoreMinds(srcDir, repoRoot, { quiet: true });

    // Legitimate hook should be present
    const destHooksDir = join(repoRoot, ".claude", "hooks");
    expect(existsSync(join(destHooksDir, "PreToolUse.validate.ts"))).toBe(true);
    expect(result.copied).toContain(".claude/hooks/PreToolUse.validate.ts");

    // Skip-pattern files should NOT be present
    expect(existsSync(join(destHooksDir, "something.test.ts"))).toBe(false);
    expect(existsSync(join(destHooksDir, "another.test.js"))).toBe(false);
    expect(existsSync(join(destHooksDir, "smoke-result.json"))).toBe(false);

    // None of the skipped files should appear in copied list
    const copiedStr = result.copied.join("\n");
    expect(copiedStr).not.toContain("something.test.ts");
    expect(copiedStr).not.toContain("another.test.js");
    expect(copiedStr).not.toContain("smoke-result.json");
  });
});
