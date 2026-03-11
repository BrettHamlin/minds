import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { installCoreMinds } from "./core.js";

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
