/**
 * Unit tests for src/cli/commands/pipeline/validate.ts
 * Covers all 12 validation checks.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateManifest } from "../../minds/cli/commands/pipeline/validate.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePipelineDir(files: Record<string, string>): string {
  const dir = join(
    tmpdir(),
    `validate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const parentDir = rel.includes("/")
      ? join(dir, rel.split("/").slice(0, -1).join("/"))
      : dir;
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

function failMessages(result: ReturnType<typeof validateManifest>): string[] {
  return result.checks
    .filter((c) => c.status === "fail")
    .map((c) => c.message);
}

function warnMessages(result: ReturnType<typeof validateManifest>): string[] {
  return result.checks
    .filter((c) => c.status === "warn")
    .map((c) => c.message);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateManifest", () => {
  test("valid pipeline — passes all checks", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "1.0.0",
        type: "pipeline",
        description: "A valid pipeline",
        commands: ["collab.my-pipeline.md"],
      }),
      "commands/collab.my-pipeline.md": "# My Pipeline",
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  test("missing required field — error contains field name", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "1.0.0",
        type: "pipeline",
        // description intentionally omitted
        commands: ["collab.my-pipeline.md"],
      }),
      "commands/collab.my-pipeline.md": "# My Pipeline",
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeGreaterThan(0);
    expect(failMessages(result).some((m) => m.includes("description"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("invalid type — error mentions pipeline or pack", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "1.0.0",
        type: "foo",
        description: "A pipeline",
        commands: [],
      }),
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(
      failMessages(result).some((m) => m.includes("pipeline or pack"))
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("invalid semver version — error mentions version or semver", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "not.a.version",
        type: "pipeline",
        description: "A pipeline",
        commands: ["collab.my-pipeline.md"],
      }),
      "commands/collab.my-pipeline.md": "# My Pipeline",
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(
      failMessages(result).some(
        (m) => m.includes("semver") || m.includes("version")
      )
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("command file missing — error mentions missing filename", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "1.0.0",
        type: "pipeline",
        description: "A pipeline",
        commands: ["collab.missing.md"],
      }),
      // commands/ dir not created — file definitely missing
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(
      failMessages(result).some((m) => m.includes("collab.missing.md"))
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("extra file in commands/ — warning only (exit 0)", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "1.0.0",
        type: "pipeline",
        description: "A pipeline",
        commands: ["collab.my-pipeline.md"],
      }),
      "commands/collab.my-pipeline.md": "# My Pipeline",
      "commands/collab.extra.md": "# Extra (not declared)",
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBeGreaterThan(0);
    expect(
      warnMessages(result).some((m) => m.includes("collab.extra.md"))
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("valid pack — passes all checks", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pack",
        version: "1.0.0",
        type: "pack",
        description: "A pack",
        pipelines: { specify: "^1.0.0", plan: ">=1.0.0" },
      }),
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  test("pack with non-empty commands[] — error", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pack",
        version: "1.0.0",
        type: "pack",
        description: "A pack",
        pipelines: { specify: "^1.0.0" },
        commands: ["collab.x.md"],
      }),
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(
      failMessages(result).some((m) => m.includes("commands"))
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("invalid CLI range — error mentions CLI name", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "my-pipeline",
        version: "1.0.0",
        type: "pipeline",
        description: "A pipeline",
        commands: ["collab.my-pipeline.md"],
        clis: { jq: "not valid" },
      }),
      "commands/collab.my-pipeline.md": "# My Pipeline",
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(
      failMessages(result).some((m) => m.includes("jq") || m.includes("range"))
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("non-kebab-case name — error mentions kebab-case", () => {
    const dir = makePipelineDir({
      "pipeline.json": JSON.stringify({
        name: "My Pipeline",
        version: "1.0.0",
        type: "pipeline",
        description: "A pipeline",
        commands: ["collab.my-pipeline.md"],
      }),
      "commands/collab.my-pipeline.md": "# My Pipeline",
    });

    const result = validateManifest(dir);
    expect(result.valid).toBe(false);
    expect(
      failMessages(result).some((m) => m.includes("kebab-case"))
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
