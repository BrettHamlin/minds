/**
 * eval-score-e2e.test.ts — End-to-end test for the eval-score pipeline stage.
 *
 * Exercises the REAL eval-factory integration: no mocks, no stubs.
 * Creates actual TypeScript files on disk, constructs a real diff,
 * runs the eval-score stage, and verifies:
 *   1. eval-factory dynamic import works
 *   2. Files are scored with real signals
 *   3. ctx.store.evalScore is populated
 *   4. History is appended to JSONL
 *   5. Findings are returned with scores
 *   6. LLM review prompt injection picks up the eval score section
 *
 * Requires eval-factory at ../eval-factory (file: dependency).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { executeEvalScore } from "../stages/eval-score.ts";
import { buildReviewPrompt } from "../supervisor-review.ts";
import type { PipelineStage, StageContext } from "../pipeline-types.ts";
import type { SupervisorConfig, SupervisorDeps, CheckResults } from "../supervisor-types.ts";
import type { DroneHandle } from "../../drone-backend.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let worktreeDir: string;

const GOOD_TS_CODE = `/**
 * user-service.ts -- User management service.
 */

import type { User } from "./types.js";
import { validateEmail } from "./utils.js";

// ----------------------------------------------------------------
// Public API

export interface CreateUserInput {
  name: string;
  email: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  if (!validateEmail(input.email)) {
    throw new Error(\`Invalid email: \${input.email}\`);
  }
  return {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    createdAt: new Date().toISOString(),
  };
}

export function getUserById(users: User[], id: string): User | undefined {
  return users.find((u) => u.id === id);
}
`;

const BAD_TS_CODE = `var x = 1
var y = 2
function foo(a) { return a }
module.exports = { x, y, foo }
`;

const SAMPLE_DIFF = `diff --git a/src/user-service.ts b/src/user-service.ts
index abc1234..def5678 100644
--- a/src/user-service.ts
+++ b/src/user-service.ts
@@ -1,5 +1,35 @@
+/**
+ * user-service.ts -- User management service.
+ */
+import type { User } from "./types.js";
+export async function createUser(input) {
+  return { id: "1", name: input.name };
+}
diff --git a/src/bad-code.ts b/src/bad-code.ts
index 1111111..2222222 100644
--- a/src/bad-code.ts
+++ b/src/bad-code.ts
@@ -1,3 +1,4 @@
+var x = 1
+var y = 2
+function foo(a) { return a }
diff --git a/src/user-service.test.ts b/src/user-service.test.ts
index 3333333..4444444 100644
--- a/src/user-service.test.ts
+++ b/src/user-service.test.ts
@@ -1 +1,5 @@
+import { test } from "bun:test";
+test("placeholder", () => {});
`;

function makeStageContext(overrides?: Partial<StageContext>): StageContext {
  const config: SupervisorConfig = {
    mindName: "e2e-eval-test",
    ticketId: "BRE-617",
    waveId: "wave-1",
    tasks: [{ id: "T001", mind: "e2e-eval-test", description: "Test eval scoring", parallel: false }],
    repoRoot: tmpDir,
    busUrl: "http://localhost:7777",
    busPort: 7777,
    channel: "test",
    worktreePath: worktreeDir,
    baseBranch: "main",
    callerPane: "%0",
    mindsSourceDir: join(tmpDir, "minds"),
    featureDir: join(tmpDir, "specs"),
    dependencies: [],
    maxIterations: 1,
    droneTimeoutMs: 60000,
  };

  return {
    supervisorConfig: config,
    deps: {} as SupervisorDeps,
    standards: "# Test Standards",
    iteration: 1,
    worktree: worktreeDir,
    branch: "test-branch",
    checkResults: {
      diff: SAMPLE_DIFF,
      testOutput: "3 pass, 0 fail",
      testsPass: true,
      findings: [],
    },
    store: {},
    allDroneHandles: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  tmpDir = join(tmpdir(), `eval-score-e2e-${Date.now()}`);
  worktreeDir = join(tmpDir, "worktree");
  mkdirSync(join(worktreeDir, "src"), { recursive: true });
  mkdirSync(join(tmpDir, "minds"), { recursive: true });

  // Write real TypeScript files that the stage will read and score
  writeFileSync(join(worktreeDir, "src", "user-service.ts"), GOOD_TS_CODE);
  writeFileSync(join(worktreeDir, "src", "bad-code.ts"), BAD_TS_CODE);
  writeFileSync(join(worktreeDir, "src", "user-service.test.ts"), `import { test } from "bun:test";\ntest("placeholder", () => {});`);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe("eval-score E2E (real eval-factory)", () => {
  const stage: PipelineStage = { type: "eval-score", label: "Code Quality" };

  test("stage executes successfully with real files", async () => {
    const ctx = makeStageContext();
    const result = await executeEvalScore(stage, ctx);

    expect(result.ok).toBe(true); // Phase 1: always passes
    expect(result.findings).toBeDefined();
    expect(result.findings!.length).toBeGreaterThan(0);
  });

  test("produces a numeric score in findings", async () => {
    const ctx = makeStageContext();
    const result = await executeEvalScore(stage, ctx);

    const scoreFinding = result.findings!.find(f => f.file === "(eval-factory)");
    expect(scoreFinding).toBeDefined();
    expect(scoreFinding!.message).toMatch(/Code quality score: \d+(\.\d+)?\/100/);
  });

  test("stores aggregate in ctx.store.evalScore", async () => {
    const ctx = makeStageContext();
    await executeEvalScore(stage, ctx);

    const evalScore = ctx.store.evalScore as {
      score: number;
      fileCount: number;
      aggregationMethod: string;
      files: Array<{ file: string; score: number }>;
    };

    expect(evalScore).toBeDefined();
    expect(typeof evalScore.score).toBe("number");
    expect(evalScore.score).toBeGreaterThanOrEqual(0);
    expect(evalScore.score).toBeLessThanOrEqual(100);
    expect(evalScore.fileCount).toBeGreaterThan(0);
    expect(evalScore.aggregationMethod).toBe("arithmetic-mean");
    expect(evalScore.files.length).toBeGreaterThan(0);
  });

  test("excludes test files from scoring", async () => {
    const ctx = makeStageContext();
    await executeEvalScore(stage, ctx);

    const evalScore = ctx.store.evalScore as {
      files: Array<{ file: string; score: number }>;
    };

    const scoredFiles = evalScore.files.map(f => f.file);
    expect(scoredFiles).not.toContain("src/user-service.test.ts");
  });

  test("scores source files individually", async () => {
    const ctx = makeStageContext();
    await executeEvalScore(stage, ctx);

    const evalScore = ctx.store.evalScore as {
      files: Array<{ file: string; score: number }>;
    };

    // Should have scored both source files (not the test file)
    const scoredFiles = evalScore.files.map(f => f.file);
    expect(scoredFiles).toContain("src/user-service.ts");
    expect(scoredFiles).toContain("src/bad-code.ts");

    // Good code should score higher than bad code
    const goodScore = evalScore.files.find(f => f.file === "src/user-service.ts")!.score;
    const badScore = evalScore.files.find(f => f.file === "src/bad-code.ts")!.score;
    expect(goodScore).toBeGreaterThan(badScore);
  });

  test("appends to JSONL history", async () => {
    const ctx = makeStageContext();
    await executeEvalScore(stage, ctx);

    const historyPath = join(tmpDir, ".minds", "e2e-eval-test", "eval-history.jsonl");
    expect(existsSync(historyPath)).toBe(true);

    const content = readFileSync(historyPath, "utf-8").trim();
    const lines = content.split("\n").filter(l => l.trim());
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.mindName).toBe("e2e-eval-test");
    expect(typeof entry.score).toBe("number");
    expect(entry.aggregationMethod).toBe("arithmetic-mean");
    expect(entry.files.length).toBeGreaterThan(0);
  });

  test("eval score section flows into LLM review prompt", async () => {
    const ctx = makeStageContext();
    await executeEvalScore(stage, ctx);

    // Build the eval score section the same way llm-review.ts does
    const evalScore = ctx.store.evalScore as {
      score: number;
      fileCount: number;
      aggregationMethod: string;
      files: Array<{ file: string; score: number }>;
    };

    const minFileScore = Math.min(...evalScore.files.map(f => f.score));
    const perFile = evalScore.files.map(f => `- ${f.file}: ${f.score}/100`).join("\n");
    const evalScoreSection = `Overall: ${evalScore.score}/100 (${evalScore.fileCount} files, ${evalScore.aggregationMethod})\nMin file score: ${minFileScore}/100\n\nPer-file breakdown:\n${perFile}`;

    // Build the review prompt with the eval section injected
    const prompt = buildReviewPrompt({
      diff: ctx.checkResults!.diff,
      testOutput: ctx.checkResults!.testOutput,
      standards: ctx.standards,
      tasks: ctx.supervisorConfig.tasks,
      iteration: ctx.iteration,
      evalScoreSection,
    });

    // Verify the eval section appears in the prompt
    expect(prompt).toContain("## Code Quality Analysis (eval-factory)");
    expect(prompt).toContain(`Overall: ${evalScore.score}/100`);
    expect(prompt).toContain("Per-file breakdown:");
    expect(prompt).toContain("src/user-service.ts:");
    expect(prompt).toContain("src/bad-code.ts:");

    // Verify it appears between test results and engineering standards
    const evalIndex = prompt.indexOf("Code Quality Analysis");
    const testIndex = prompt.indexOf("## Test Results");
    const standardsIndex = prompt.indexOf("## Engineering Standards");
    expect(evalIndex).toBeGreaterThan(testIndex);
    expect(evalIndex).toBeLessThan(standardsIndex);
  });

  test("handles empty diff gracefully", async () => {
    const ctx = makeStageContext({
      checkResults: { diff: "", testOutput: "", testsPass: true, findings: [] },
    });
    const result = await executeEvalScore(stage, ctx);

    expect(result.ok).toBe(true);
    expect(ctx.store.evalScore).toBeUndefined();
  });

  test("handles diff with only deleted files gracefully", async () => {
    const deletedOnlyDiff = `diff --git a/src/removed.ts b/src/removed.ts
deleted file mode 100644
index abc..000 100644
--- a/src/removed.ts
+++ /dev/null
@@ -1 +0,0 @@
-old code
`;
    const ctx = makeStageContext({
      checkResults: { diff: deletedOnlyDiff, testOutput: "", testsPass: true, findings: [] },
    });
    const result = await executeEvalScore(stage, ctx);

    expect(result.ok).toBe(true);
  });

  test("handles missing files on disk gracefully", async () => {
    const diffWithMissingFile = `diff --git a/src/user-service.ts b/src/user-service.ts
index abc..def 100644
--- a/src/user-service.ts
+++ b/src/user-service.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/nonexistent.ts b/src/nonexistent.ts
index 111..222 100644
--- a/src/nonexistent.ts
+++ b/src/nonexistent.ts
@@ -1 +1 @@
-old
+new
`;
    const ctx = makeStageContext({
      checkResults: { diff: diffWithMissingFile, testOutput: "", testsPass: true, findings: [] },
    });
    const result = await executeEvalScore(stage, ctx);

    // Should still succeed — missing files are skipped
    expect(result.ok).toBe(true);
    const evalScore = ctx.store.evalScore as { files: Array<{ file: string }> } | undefined;
    if (evalScore) {
      const scoredFiles = evalScore.files.map(f => f.file);
      expect(scoredFiles).not.toContain("src/nonexistent.ts");
    }
  });
});
