// BRE-406: Tests for write-resolutions.ts CLI
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import * as os from "os";
import { execSync } from "child_process";

import { parseResolutionsInput } from "./write-resolutions";

const SCRIPT = join(import.meta.dir, "write-resolutions.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `write-resolutions-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runScript(
  args: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`bun ${SCRIPT} ${args}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

// ── parseResolutionsInput() unit tests ────────────────────────────────────────

describe("parseResolutionsInput: valid ResolutionBatch", () => {
  test("parses a full ResolutionBatch object", () => {
    const input = JSON.stringify({
      phase: "clarify",
      round: 1,
      resolutions: [
        { findingId: "f1", answer: "Use JWT", reasoning: "Stateless requirement", sources: ["spec.md"] },
      ],
    });
    const result = parseResolutionsInput(input, "clarify", 1);
    expect(result.phase).toBe("clarify");
    expect(result.round).toBe(1);
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].findingId).toBe("f1");
  });

  test("uses passed phase/round when batch lacks them", () => {
    const input = JSON.stringify({
      resolutions: [
        { findingId: "f1", answer: "A", reasoning: "R", sources: [] },
      ],
    });
    const result = parseResolutionsInput(input, "analyze", 2);
    expect(result.phase).toBe("analyze");
    expect(result.round).toBe(2);
  });
});

describe("parseResolutionsInput: valid Resolution array", () => {
  test("parses an array of resolutions", () => {
    const input = JSON.stringify([
      { findingId: "f1", answer: "Use JWT", reasoning: "Stateless", sources: ["spec.md"] },
      { findingId: "f2", answer: "PostgreSQL", reasoning: "Existing DB", sources: [] },
    ]);
    const result = parseResolutionsInput(input, "clarify", 1);
    expect(result.resolutions).toHaveLength(2);
    expect(result.resolutions[1].findingId).toBe("f2");
  });
});

describe("parseResolutionsInput: invalid input", () => {
  test("throws on invalid JSON", () => {
    expect(() => parseResolutionsInput("not json", "clarify", 1)).toThrow("Invalid JSON");
  });

  test("throws when resolution missing findingId", () => {
    const input = JSON.stringify([
      { answer: "A", reasoning: "R", sources: [] }, // missing findingId
    ]);
    expect(() => parseResolutionsInput(input, "clarify", 1)).toThrow();
  });

  test("throws when resolution missing answer", () => {
    const input = JSON.stringify([
      { findingId: "f1", reasoning: "R", sources: [] }, // missing answer
    ]);
    expect(() => parseResolutionsInput(input, "clarify", 1)).toThrow();
  });

  test("throws on non-object, non-array input", () => {
    expect(() => parseResolutionsInput('"just a string"', "clarify", 1)).toThrow();
  });

  test("throws when resolutions field is not an array", () => {
    const input = JSON.stringify({ resolutions: "not an array" });
    expect(() => parseResolutionsInput(input, "clarify", 1)).toThrow();
  });
});

// ── CLI integration tests ─────────────────────────────────────────────────────

describe("write-resolutions: usage errors", () => {
  test("exits 1 with no arguments", () => {
    const { exitCode } = runScript("");
    expect(exitCode).toBe(1);
  });

  test("exits 1 with missing round (only 2 args)", () => {
    const { exitCode } = runScript("clarify /tmp/input.json");
    expect(exitCode).toBe(1);
  });

  test("exits 1 with non-integer round", () => {
    const { exitCode } = runScript("clarify notanumber /dev/null");
    expect(exitCode).toBe(1);
  });
});

describe("write-resolutions: from file", () => {
  test("writes resolutions to correct path", () => {
    // Create a minimal feature dir structure
    const featureDir = join(tmpDir, "specs", "bre-406-test");
    mkdirSync(featureDir, { recursive: true });

    const inputData = JSON.stringify([
      { findingId: "f1", answer: "Use JWT", reasoning: "Stateless", sources: ["spec.md"] },
    ]);
    const inputFile = join(tmpDir, "resolutions-input.json");
    writeFileSync(inputFile, inputData);

    const { exitCode, stdout } = runScript(
      `clarify 1 ${inputFile} --feature-dir ${featureDir}`,
    );
    expect(exitCode).toBe(0);

    const outPath = join(featureDir, "resolutions", "clarify-round-1.json");
    expect(existsSync(outPath)).toBe(true);
    expect(stdout).toContain("1 resolution");

    const written = JSON.parse(require("fs").readFileSync(outPath, "utf-8"));
    expect(written.resolutions[0].findingId).toBe("f1");
    expect(written.phase).toBe("clarify");
    expect(written.round).toBe(1);
  });

  test("exits 2 when input file not found", () => {
    const { exitCode } = runScript(
      `clarify 1 /nonexistent/file.json --feature-dir ${tmpDir}`,
    );
    expect(exitCode).toBe(2);
  });

  test("exits 2 on malformed JSON input", () => {
    const badFile = join(tmpDir, "bad.json");
    writeFileSync(badFile, "{ invalid }");
    const { exitCode } = runScript(
      `clarify 1 ${badFile} --feature-dir ${tmpDir}`,
    );
    expect(exitCode).toBe(2);
  });
});

describe("write-resolutions: ResolutionBatch input", () => {
  test("accepts full ResolutionBatch object", () => {
    const featureDir = join(tmpDir, "specs", "bre-406-batch");
    mkdirSync(featureDir, { recursive: true });

    const inputData = JSON.stringify({
      phase: "analyze",
      round: 2,
      resolutions: [
        { findingId: "f1", answer: "A", reasoning: "R", sources: [] },
        { findingId: "f2", answer: "B", reasoning: "S", sources: ["x.ts"] },
      ],
    });
    const inputFile = join(tmpDir, "batch-input.json");
    writeFileSync(inputFile, inputData);

    const { exitCode } = runScript(
      `analyze 2 ${inputFile} --feature-dir ${featureDir}`,
    );
    expect(exitCode).toBe(0);

    const outPath = join(featureDir, "resolutions", "analyze-round-2.json");
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(require("fs").readFileSync(outPath, "utf-8"));
    expect(written.resolutions).toHaveLength(2);
  });
});
