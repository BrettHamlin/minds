/**
 * Unit tests for src/cli/commands/pipeline/init.ts
 * Covers: scanCommandFiles, generateManifest, init flow
 */

import { describe, test, expect } from "bun:test";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanCommandFiles,
  generateManifest,
  init,
} from "../../src/cli/commands/pipeline/init.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(label: string): string {
  const dir = join(
    tmpdir(),
    `pipeline-init-${Date.now()}-${label}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── scanCommandFiles ─────────────────────────────────────────────────────────

describe("scanCommandFiles", () => {
  test("scans commands/ dir and returns .md filenames", () => {
    const dir = makeTempDir("scan3");
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "commands", "collab.one.md"), "# One");
    writeFileSync(join(dir, "commands", "collab.two.md"), "# Two");
    writeFileSync(join(dir, "commands", "collab.three.md"), "# Three");

    const files = scanCommandFiles(dir);
    expect(files).toHaveLength(3);
    expect(files).toContain("collab.one.md");
    expect(files).toContain("collab.two.md");
    expect(files).toContain("collab.three.md");

    rmSync(dir, { recursive: true, force: true });
  });

  test("returns empty array when commands/ dir has no .md files", () => {
    const dir = makeTempDir("empty");
    mkdirSync(join(dir, "commands"), { recursive: true });

    const files = scanCommandFiles(dir);
    expect(files).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  test("falls back to collab.*.md in top-level dir when no commands/ subdir", () => {
    const dir = makeTempDir("fallback");
    writeFileSync(join(dir, "collab.myfeature.md"), "# Feature");

    const files = scanCommandFiles(dir);
    expect(files).toContain("collab.myfeature.md");

    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── generateManifest ────────────────────────────────────────────────────────

describe("generateManifest", () => {
  test("pipeline type includes commands and optional clis", () => {
    const manifest = generateManifest({
      name: "my-pipeline",
      version: "0.1.0",
      type: "pipeline",
      description: "Does something useful",
      commands: ["collab.my-pipeline.md"],
      clis: { jq: ">=1.7" },
      pipelines: {},
    });

    expect(manifest.name).toBe("my-pipeline");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.type).toBe("pipeline");
    expect(manifest.description).toBe("Does something useful");
    expect(manifest.commands).toEqual(["collab.my-pipeline.md"]);
    expect((manifest.clis as Record<string, string>).jq).toBe(">=1.7");
  });

  test("pack type excludes commands[], includes pipelines", () => {
    const manifest = generateManifest({
      name: "my-pack",
      version: "1.0.0",
      type: "pack",
      description: "A bundle",
      commands: [],
      clis: {},
      pipelines: { specify: "^1.0.0" },
    });

    expect(manifest.type).toBe("pack");
    expect(manifest.commands).toBeUndefined();
    expect((manifest.pipelines as Record<string, string>).specify).toBe("^1.0.0");
    expect(manifest.clis).toBeUndefined();
  });
});

// ─── init ────────────────────────────────────────────────────────────────────

describe("init", () => {
  test("scans commands dir — 3 .md files → commands[] has 3 entries", async () => {
    const dir = makeTempDir("init-scan");
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "commands", "collab.a.md"), "# A");
    writeFileSync(join(dir, "commands", "collab.b.md"), "# B");
    writeFileSync(join(dir, "commands", "collab.c.md"), "# C");

    const result = await init({
      path: dir,
      name: "test",
      description: "Test",
      type: "pipeline",
      force: true,
    });

    expect(result.written).toBe(true);
    expect((result.manifest.commands as string[]).length).toBe(3);

    rmSync(dir, { recursive: true, force: true });
  });

  test("scans empty dir — no .md files → commands[] empty + warning", async () => {
    const dir = makeTempDir("init-empty");
    mkdirSync(join(dir, "commands"), { recursive: true });

    const result = await init({
      path: dir,
      name: "empty-pipeline",
      description: "Empty",
      type: "pipeline",
      force: true,
    });

    expect(result.written).toBe(true);
    expect((result.manifest.commands as string[]).length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  test("name from directory — dir named my-pipeline → manifest name is my-pipeline", async () => {
    const parent = join(tmpdir(), `init-parent-${Date.now()}`);
    const dir = join(parent, "my-pipeline");
    mkdirSync(join(dir, "commands"), { recursive: true });

    const result = await init({
      path: dir,
      description: "Test pipeline",
      type: "pipeline",
      force: true,
    });

    expect(result.manifest.name).toBe("my-pipeline");

    rmSync(parent, { recursive: true, force: true });
  });

  test("respects --path flag — writes pipeline.json to specified dir", async () => {
    const dir = makeTempDir("path-flag");
    mkdirSync(join(dir, "commands"), { recursive: true });

    const result = await init({
      path: dir,
      name: "custom-name",
      description: "Path test",
      type: "pipeline",
      force: true,
    });

    expect(result.written).toBe(true);
    expect(existsSync(join(dir, "pipeline.json"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("existing file — returns diff without writing when force is false", async () => {
    const dir = makeTempDir("diff-test");
    mkdirSync(join(dir, "commands"), { recursive: true });

    // Write initial pipeline.json
    writeFileSync(
      join(dir, "pipeline.json"),
      JSON.stringify(
        {
          name: "old-name",
          version: "0.0.1",
          type: "pipeline",
          description: "Old description",
          commands: [],
        },
        null,
        2
      ) + "\n"
    );

    const result = await init({
      path: dir,
      name: "new-name",
      description: "New description",
      type: "pipeline",
      force: false,
    });

    expect(result.written).toBe(false);
    expect(result.diff).not.toBeNull();
    // Diff should contain removed lines (old values)
    expect(result.diff).toContain("-");

    rmSync(dir, { recursive: true, force: true });
  });

  test("generated JSON is valid — parseable, has all required fields", async () => {
    const dir = makeTempDir("json-valid");
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "commands", "collab.test.md"), "# Test");

    const result = await init({
      path: dir,
      name: "test-pipeline",
      description: "A test pipeline",
      type: "pipeline",
      force: true,
    });

    expect(result.written).toBe(true);
    const content = readFileSync(join(dir, "pipeline.json"), "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    expect(typeof parsed.name).toBe("string");
    expect(typeof parsed.version).toBe("string");
    expect(parsed.type).toBe("pipeline");
    expect(typeof parsed.description).toBe("string");
    expect(Array.isArray(parsed.commands)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("pack mode — manifest has no commands[] field", async () => {
    const dir = makeTempDir("pack-mode");
    mkdirSync(dir, { recursive: true });

    const result = await init({
      path: dir,
      name: "my-pack",
      description: "A pack",
      type: "pack",
      pipelines: { specify: "^1.0.0" },
      force: true,
    });

    expect(result.written).toBe(true);
    expect(result.manifest.commands).toBeUndefined();
    expect(result.manifest.pipelines).toBeDefined();

    rmSync(dir, { recursive: true, force: true });
  });
});
