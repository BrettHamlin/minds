// BRE-406: Tests for resolve-questions.ts CLI
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import * as os from "os";
import { execSync } from "child_process";

const SCRIPT = join(import.meta.dir, "resolve-questions.ts");

function runScript(args: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`bun ${SCRIPT} ${args}`, {
      encoding: "utf-8",
      cwd: cwd ?? process.cwd(),
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

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `resolve-questions-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeFindingsFile(overrides: object = {}): string {
  const findings = {
    phase: "clarify",
    round: 1,
    ticketId: "BRE-406",
    findings: [
      {
        id: "f1",
        question: "What auth strategy should this API use?",
        context: {
          why: "Implementation cannot start without knowing",
          specReferences: ["spec.md:AC3"],
          codePatterns: ["src/auth.ts uses JWT"],
          constraints: ["Must be stateless"],
          implications: ["T-3 depends on this"],
        },
      },
    ],
    specExcerpt: "The API should support authentication.",
    ...overrides,
  };
  const findingsPath = join(tmpDir, "clarify-round-1.json");
  writeFileSync(findingsPath, JSON.stringify(findings, null, 2));
  return findingsPath;
}

describe("resolve-questions: usage errors", () => {
  test("exits 1 with no arguments", () => {
    const { exitCode } = runScript("");
    expect(exitCode).toBe(1);
  });

  test("exits 2 when findings file not found", () => {
    const { exitCode } = runScript("/nonexistent/findings.json");
    expect(exitCode).toBe(2);
  });

  test("exits 2 when findings file is malformed JSON", () => {
    const badFile = join(tmpDir, "bad.json");
    writeFileSync(badFile, "not json {{{");
    const { exitCode } = runScript(badFile);
    expect(exitCode).toBe(2);
  });
});

describe("resolve-questions: successful run", () => {
  test("exits 0 and writes context-bundle.json by default", () => {
    const findingsPath = makeFindingsFile();
    const { exitCode, stdout } = runScript(findingsPath);
    expect(exitCode).toBe(0);
    const bundlePath = join(tmpDir, "context-bundle.json");
    expect(existsSync(bundlePath)).toBe(true);
    expect(stdout).toContain("context-bundle.json");
  });

  test("context-bundle.json contains findings", () => {
    const findingsPath = makeFindingsFile();
    runScript(findingsPath);
    const bundlePath = join(tmpDir, "context-bundle.json");
    const bundle = JSON.parse(require("fs").readFileSync(bundlePath, "utf-8"));
    expect(bundle.findings).toBeDefined();
    expect(bundle.findings.phase).toBe("clarify");
    expect(bundle.findings.findings).toHaveLength(1);
  });

  test("context-bundle.json contains context object", () => {
    const findingsPath = makeFindingsFile();
    runScript(findingsPath);
    const bundlePath = join(tmpDir, "context-bundle.json");
    const bundle = JSON.parse(require("fs").readFileSync(bundlePath, "utf-8"));
    expect(bundle.context).toBeDefined();
    expect(typeof bundle.context.spec).toBe("string");
    expect(typeof bundle.context.constitution).toBe("string");
    expect(Array.isArray(bundle.context.priorResolutions)).toBe(true);
    expect(Array.isArray(bundle.context.codePatterns)).toBe(true);
  });

  test("context-bundle.json contains priorityHint array", () => {
    const findingsPath = makeFindingsFile();
    runScript(findingsPath);
    const bundlePath = join(tmpDir, "context-bundle.json");
    const bundle = JSON.parse(require("fs").readFileSync(bundlePath, "utf-8"));
    expect(Array.isArray(bundle.priorityHint)).toBe(true);
    expect(bundle.priorityHint.length).toBeGreaterThanOrEqual(6);
  });

  test("codePatterns deduplicates across findings", () => {
    const findingsPath = makeFindingsFile({
      findings: [
        {
          id: "f1",
          question: "Q1?",
          context: {
            why: "w",
            specReferences: [],
            codePatterns: ["pattern-A", "pattern-B"],
            constraints: [],
            implications: [],
          },
        },
        {
          id: "f2",
          question: "Q2?",
          context: {
            why: "w",
            specReferences: [],
            codePatterns: ["pattern-A", "pattern-C"],
            constraints: [],
            implications: [],
          },
        },
      ],
    });
    runScript(findingsPath);
    const bundlePath = join(tmpDir, "context-bundle.json");
    const bundle = JSON.parse(require("fs").readFileSync(bundlePath, "utf-8"));
    // pattern-A should appear only once (deduplicated)
    expect(bundle.context.codePatterns.filter((p: string) => p === "pattern-A")).toHaveLength(1);
    expect(bundle.context.codePatterns).toContain("pattern-B");
    expect(bundle.context.codePatterns).toContain("pattern-C");
  });

  test("--output flag writes to custom path", () => {
    const findingsPath = makeFindingsFile();
    const customOutput = join(tmpDir, "custom-bundle.json");
    const { exitCode } = runScript(`${findingsPath} --output ${customOutput}`);
    expect(exitCode).toBe(0);
    expect(existsSync(customOutput)).toBe(true);
  });
});
