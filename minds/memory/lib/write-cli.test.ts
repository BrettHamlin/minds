/**
 * Unit tests for write-cli.ts — --content-file flag behaviour.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { dailyLogPath } from "./paths";

const CLI = join(import.meta.dir, "write-cli.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const TEST_DATE = "2099-06-15";
const TEST_MIND = "memory";

let tempDir: string;

function setup(): void {
  tempDir = mkdtempSync(join(tmpdir(), "write-cli-test-"));
}

function cleanup(): void {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  const logPath = dailyLogPath(TEST_MIND, TEST_DATE);
  if (existsSync(logPath)) {
    rmSync(logPath);
  }
}

afterEach(cleanup);

function runCLI(args: string[]): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(["bun", CLI, ...args], { cwd: REPO_ROOT });
  return {
    exitCode: result.exitCode ?? 1,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
}

describe("write-cli --content-file", () => {
  test("reads content from file and appends to daily log", () => {
    setup();
    const contentPath = join(tempDir, "input.txt");
    writeFileSync(contentPath, "Content from file", "utf-8");

    const { exitCode, stdout } = runCLI([
      "--mind", TEST_MIND,
      "--content-file", contentPath,
      "--date", TEST_DATE,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Appended");

    const logPath = dailyLogPath(TEST_MIND, TEST_DATE);
    expect(existsSync(logPath)).toBe(true);
    const logContent = readFileSync(logPath, "utf-8");
    expect(logContent).toContain("Content from file");
  });

  test("error when both --content and --content-file are given", () => {
    setup();
    const contentPath = join(tempDir, "input.txt");
    writeFileSync(contentPath, "Some content", "utf-8");

    const { exitCode, stderr } = runCLI([
      "--mind", TEST_MIND,
      "--content", "inline text",
      "--content-file", contentPath,
      "--date", TEST_DATE,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("mutually exclusive");
  });

  test("error when --content-file points to a missing file", () => {
    setup();
    const missing = join(tempDir, "does-not-exist.txt");

    const { exitCode, stderr } = runCLI([
      "--mind", TEST_MIND,
      "--content-file", missing,
      "--date", TEST_DATE,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("file not found");
    expect(stderr).toContain(missing);
  });

  test("multi-line content preserves formatting", () => {
    setup();
    const multiLine = "Line one\nLine two\n  indented line\nLine four";
    const contentPath = join(tempDir, "multiline.txt");
    writeFileSync(contentPath, multiLine, "utf-8");

    const { exitCode } = runCLI([
      "--mind", TEST_MIND,
      "--content-file", contentPath,
      "--date", TEST_DATE,
    ]);

    expect(exitCode).toBe(0);

    const logPath = dailyLogPath(TEST_MIND, TEST_DATE);
    const logContent = readFileSync(logPath, "utf-8");
    expect(logContent).toContain("Line one");
    expect(logContent).toContain("Line two");
    expect(logContent).toContain("  indented line");
    expect(logContent).toContain("Line four");
  });
});
