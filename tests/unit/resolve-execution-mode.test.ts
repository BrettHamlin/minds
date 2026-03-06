/**
 * tests/unit/resolve-execution-mode.test.ts
 *
 * Tests for the resolve-execution-mode.ts CLI (BRE-429 Violation #5).
 * Tests focus on the resolveMode() defaultMode extension and the CLI's
 * logic for autonomous vs interactive determination.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import * as os from "os";
import { resolveMode } from "../../src/lib/pipeline/questions";

// ── resolveMode: defaultMode extension (BRE-429) ───────────────────────────

describe("resolveMode: defaultMode parameter", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(os.tmpdir(), `bre429-mode-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "pipeline.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns defaultMode='non-interactive' when interactive field is absent", () => {
    writeFileSync(configPath, JSON.stringify({ codeReview: { enabled: true } }));
    expect(
      resolveMode({ pipelineConfigPath: configPath, defaultMode: "non-interactive" })
    ).toBe("non-interactive");
  });

  test("backward compat: returns 'interactive' when defaultMode not provided and field absent", () => {
    writeFileSync(configPath, JSON.stringify({ codeReview: { enabled: true } }));
    expect(resolveMode({ pipelineConfigPath: configPath })).toBe("interactive");
  });

  test("explicit interactive.enabled=true overrides defaultMode='non-interactive'", () => {
    writeFileSync(configPath, JSON.stringify({ interactive: { enabled: true } }));
    expect(
      resolveMode({ pipelineConfigPath: configPath, defaultMode: "non-interactive" })
    ).toBe("interactive");
  });

  test("explicit interactive.enabled=false with defaultMode='interactive' still returns non-interactive", () => {
    writeFileSync(configPath, JSON.stringify({ interactive: { enabled: false } }));
    expect(
      resolveMode({ pipelineConfigPath: configPath, defaultMode: "interactive" })
    ).toBe("non-interactive");
  });

  test("per-phase override interactive=true overrides defaultMode='non-interactive'", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        phases: { clarify: { interactive: { enabled: true } } },
      })
    );
    expect(
      resolveMode({
        pipelineConfigPath: configPath,
        phase: "clarify",
        defaultMode: "non-interactive",
      })
    ).toBe("interactive");
  });

  test("per-phase override absent falls back to global, then defaultMode", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        phases: { clarify: {} },
        // no global interactive field
      })
    );
    expect(
      resolveMode({
        pipelineConfigPath: configPath,
        phase: "clarify",
        defaultMode: "non-interactive",
      })
    ).toBe("non-interactive");
  });

  test("missing config file returns defaultMode when provided", () => {
    expect(
      resolveMode({ pipelineConfigPath: "/nonexistent/pipeline.json", defaultMode: "non-interactive" })
    ).toBe("non-interactive");
  });

  test("forceMode still takes priority over defaultMode", () => {
    expect(
      resolveMode({ forceMode: "interactive", defaultMode: "non-interactive" })
    ).toBe("interactive");
  });
});

// ── resolve-execution-mode CLI: argument validation ─────────────────────────

describe("resolve-execution-mode CLI: argument validation", () => {
  test("exits with error when first arg is a flag (not ticket ID)", () => {
    const { spawnSync } = require("child_process");
    const result = spawnSync("bun", [
      "src/scripts/resolve-execution-mode.ts",
      "--phase",
      "clarify",
    ], { encoding: "utf-8", cwd: join(import.meta.dir, "../..") });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("First argument must be a ticket ID");
  });

  test("exits with error when no arguments provided", () => {
    const { spawnSync } = require("child_process");
    const result = spawnSync("bun", [
      "src/scripts/resolve-execution-mode.ts",
    ], { encoding: "utf-8", cwd: join(import.meta.dir, "../..") });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });
});
