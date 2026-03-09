// evaluate-gate.ts — Gate prompt resolution and verdict validation
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import {
  parseFrontMatter,
  resolveTokenExpressions,
  resolveGatePrompt,
  getGateConfig,
  getValidKeywords,
} from "./evaluate-gate";
import { spawnCli } from "./test-helpers";

const CLI_PATH = join(import.meta.dir, "evaluate-gate.ts");

// ============================================================================
// Unit tests: parseFrontMatter
// ============================================================================

describe("parseFrontMatter", () => {
  test("parses context block with file paths", () => {
    const content = `---
context:
  SPEC_MD: "specs/\${TICKET_ID}/spec.md"
  PLAN_MD: "specs/\${TICKET_ID}/plan.md"
---
# Gate Prompt

\${SPEC_MD}
`;
    const result = parseFrontMatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontMatter.context.SPEC_MD).toBe("specs/${TICKET_ID}/spec.md");
    expect(result!.frontMatter.context.PLAN_MD).toBe("specs/${TICKET_ID}/plan.md");
    expect(result!.body).toContain("# Gate Prompt");
  });

  test("returns null for content without front matter", () => {
    const result = parseFrontMatter("# Just a markdown file\n\nNo front matter here.");
    expect(result).toBeNull();
  });

  test("returns empty context when front matter has no context block", () => {
    const content = `---
title: My Gate
---
Body here.
`;
    const result = parseFrontMatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontMatter.context).toEqual({});
    expect(result!.body).toBe("Body here.\n");
  });
});

// ============================================================================
// Unit tests: resolveTokenExpressions
// ============================================================================

describe("resolveTokenExpressions", () => {
  test("substitutes known tokens", () => {
    const result = resolveTokenExpressions("Ticket: ${TICKET_ID}", { TICKET_ID: "BRE-123" });
    expect(result).toBe("Ticket: BRE-123");
  });

  test("substitutes file content tokens", () => {
    const result = resolveTokenExpressions("Spec:\n${SPEC_MD}", { SPEC_MD: "# Spec content" });
    expect(result).toBe("Spec:\n# Spec content");
  });

  test("substitutes empty string for unknown ALL_CAPS tokens", () => {
    const result = resolveTokenExpressions("${UNKNOWN_TOKEN}", {});
    expect(result).toBe("");
  });

  test("leaves lowercase/mixed tokens unresolved", () => {
    const result = resolveTokenExpressions("${someVar}", {});
    expect(result).toBe("${someVar}");
  });

  test("handles multiple tokens in one string", () => {
    const result = resolveTokenExpressions(
      "Gate for ${TICKET_ID} — ${PHASE}",
      { TICKET_ID: "BRE-1", PHASE: "plan" }
    );
    expect(result).toBe("Gate for BRE-1 — plan");
  });
});

// ============================================================================
// Unit tests: getGateConfig / getValidKeywords
// ============================================================================

describe("getGateConfig", () => {
  const pipeline = {
    gates: {
      plan_review: {
        prompt: ".minds/config/gates/plan.md",
        on: {
          APPROVED: { to: "tasks" },
          REVISION_NEEDED: { to: "plan", feedback: "enrich" },
        },
      },
    },
  };

  test("returns gate config when found", () => {
    const gate = getGateConfig(pipeline, "plan_review");
    expect(gate).not.toBeNull();
    expect(gate!.prompt).toBe(".minds/config/gates/plan.md");
  });

  test("returns null for missing gate", () => {
    expect(getGateConfig(pipeline, "nonexistent_gate")).toBeNull();
  });

  test("returns null for pipeline with no gates", () => {
    expect(getGateConfig({}, "plan_review")).toBeNull();
  });
});

describe("getValidKeywords", () => {
  test("returns on-keywords as array", () => {
    const gate = {
      on: { APPROVED: { to: "tasks" }, REVISION_NEEDED: { to: "plan" } },
    };
    const keywords = getValidKeywords(gate);
    expect(keywords).toContain("APPROVED");
    expect(keywords).toContain("REVISION_NEEDED");
    expect(keywords).toHaveLength(2);
  });

  test("returns empty array when on is missing", () => {
    expect(getValidKeywords({})).toEqual([]);
  });
});

// ============================================================================
// Unit tests: resolveGatePrompt
// ============================================================================

describe("resolveGatePrompt", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `evaluate-gate-unit-${process.pid}`);
    mkdirSync(join(tmpDir, "specs/BRE-UNIT/"), { recursive: true });
    mkdirSync(join(tmpDir, "gates"), { recursive: true });

    writeFileSync(join(tmpDir, "specs/BRE-UNIT/spec.md"), "# Spec for BRE-UNIT\nContent here.");
    writeFileSync(join(tmpDir, "specs/BRE-UNIT/plan.md"), "# Plan\nStep 1. Step 2.");

    writeFileSync(join(tmpDir, "gates/plan.md"), `---
context:
  SPEC_MD: "specs/\${TICKET_ID}/spec.md"
  PLAN_MD: "specs/\${TICKET_ID}/plan.md"
---
# Review Gate

Ticket: \${TICKET_ID}

## Spec
\${SPEC_MD}

## Plan
\${PLAN_MD}
`);

    writeFileSync(join(tmpDir, "gates/no-frontmatter.md"),
      "# Simple Gate\n\nFor ticket \${TICKET_ID}.\n"
    );
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  test("resolves TICKET_ID and file content tokens", () => {
    const result = resolveGatePrompt(
      join(tmpDir, "gates/plan.md"),
      "BRE-UNIT",
      tmpDir
    );
    expect(result).toContain("Ticket: BRE-UNIT");
    expect(result).toContain("# Spec for BRE-UNIT");
    expect(result).toContain("# Plan");
  });

  test("resolves TICKET_ID in files without front matter", () => {
    const result = resolveGatePrompt(
      join(tmpDir, "gates/no-frontmatter.md"),
      "BRE-UNIT",
      tmpDir
    );
    expect(result).toContain("For ticket BRE-UNIT.");
  });

  test("substitutes placeholder for missing context files", () => {
    writeFileSync(join(tmpDir, "gates/missing-file.md"), `---
context:
  MISSING: "specs/\${TICKET_ID}/nonexistent.md"
---
Content: \${MISSING}
`);
    const result = resolveGatePrompt(
      join(tmpDir, "gates/missing-file.md"),
      "BRE-UNIT",
      tmpDir
    );
    expect(result).toContain("[File not found:");
  });
});

// ============================================================================
// CLI integration tests
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `evaluate-gate-cli-${process.pid}`);
  mkdirSync(join(tmpDir, ".minds/config/gates"), { recursive: true });
  mkdirSync(join(tmpDir, ".minds/state/pipeline-registry"), { recursive: true });
  mkdirSync(join(tmpDir, "specs/BRE-CLI"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  // Spec files for token resolution
  writeFileSync(join(tmpDir, "specs/BRE-CLI/spec.md"), "# Spec content for CLI test");
  writeFileSync(join(tmpDir, "specs/BRE-CLI/plan.md"), "# Plan content for CLI test");

  // Gate prompt file with front matter
  writeFileSync(join(tmpDir, ".minds/config/gates/plan.md"), `---
context:
  SPEC_MD: "specs/\${TICKET_ID}/spec.md"
  PLAN_MD: "specs/\${TICKET_ID}/plan.md"
---
# Plan Review Gate

Ticket: \${TICKET_ID}

## Spec
\${SPEC_MD}

## Plan
\${PLAN_MD}

Respond: APPROVED or REVISION_NEEDED
`);

  // Pipeline config with plan_review gate (phases required by loadPipelineForTicket)
  writeFileSync(
    join(tmpDir, ".minds/config/pipeline.json"),
    JSON.stringify({
      version: "3.1",
      phases: {
        plan: { command: "/collab.plan", signals: [], transitions: {} },
        tasks: { command: "/collab.tasks", signals: [], transitions: {} },
        done: { terminal: true },
      },
      gates: {
        plan_review: {
          prompt: ".minds/config/gates/plan.md",
          on: {
            APPROVED: { to: "tasks" },
            REVISION_NEEDED: { to: "plan", feedback: "enrich", maxRetries: 3 },
          },
        },
        no_prompt_gate: {
          on: {
            PASS: { to: "done" },
            FAIL: { to: "plan" },
          },
        },
      },
    })
  );

  // Registry entry so loadPipelineForTicket works
  writeFileSync(
    join(tmpDir, ".minds/state/pipeline-registry/BRE-CLI.json"),
    JSON.stringify({ ticket_id: "BRE-CLI", current_step: "plan" })
  );
});

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

function runCli(args: string[], cwd = tmpDir) {
  return spawnCli(CLI_PATH, args, cwd);
}

// ── Mode 1: Prompt resolution ──────────────────────────────────────────────

describe("evaluate-gate CLI — prompt resolve mode", () => {
  test("exits 1 when no args provided", async () => {
    const { exitCode } = await runCli([]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when only ticket ID provided", async () => {
    const { exitCode } = await runCli(["BRE-CLI"]);
    expect(exitCode).toBe(1);
  });

  test("exits 0 with prompt and validKeywords for known gate", async () => {
    const { stdout, exitCode } = await runCli(["BRE-CLI", "plan_review"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.prompt).toContain("Ticket: BRE-CLI");
    expect(result.prompt).toContain("# Spec content for CLI test");
    expect(result.prompt).toContain("# Plan content for CLI test");
    expect(result.validKeywords).toContain("APPROVED");
    expect(result.validKeywords).toContain("REVISION_NEEDED");
  });

  test("exits 0 for gate without a prompt file", async () => {
    const { stdout, exitCode } = await runCli(["BRE-CLI", "no_prompt_gate"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.prompt).toBe("");
    expect(result.validKeywords).toContain("PASS");
    expect(result.validKeywords).toContain("FAIL");
  });

  test("exits 3 for unknown gate name", async () => {
    const { stderr, exitCode } = await runCli(["BRE-CLI", "nonexistent_gate"]);
    expect(exitCode).toBe(3);

    const errResult = JSON.parse(stderr);
    expect(errResult.error).toContain("nonexistent_gate");
  });

  test("exits 1 when ticket ID starts with --", async () => {
    const { exitCode } = await runCli(["--bad-arg", "plan_review"]);
    expect(exitCode).toBe(1);
  });
});

// ── Mode 2: Verdict validation ─────────────────────────────────────────────

describe("evaluate-gate CLI — verdict mode", () => {
  test("exits 0 for valid keyword and returns response", async () => {
    const { stdout, exitCode } = await runCli([
      "BRE-CLI", "plan_review", "--verdict", "APPROVED"
    ]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.keyword).toBe("APPROVED");
    expect(result.response).toEqual({ to: "tasks" });
  });

  test("exits 0 for REVISION_NEEDED keyword with full response", async () => {
    const { stdout, exitCode } = await runCli([
      "BRE-CLI", "plan_review", "--verdict", "REVISION_NEEDED"
    ]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.keyword).toBe("REVISION_NEEDED");
    expect(result.response.to).toBe("plan");
    expect(result.response.feedback).toBe("enrich");
  });

  test("exits 2 for invalid verdict keyword", async () => {
    const { stderr, exitCode } = await runCli([
      "BRE-CLI", "plan_review", "--verdict", "BOGUS_KEYWORD"
    ]);
    expect(exitCode).toBe(2);

    const errResult = JSON.parse(stderr);
    expect(errResult.error).toContain("BOGUS_KEYWORD");
    expect(errResult.validKeywords).toContain("APPROVED");
    expect(errResult.validKeywords).toContain("REVISION_NEEDED");
  });

  test("exits 1 when --verdict flag has no argument", async () => {
    const { exitCode } = await runCli(["BRE-CLI", "plan_review", "--verdict"]);
    expect(exitCode).toBe(1);
  });

  test("exits 3 for unknown gate in verdict mode", async () => {
    const { exitCode } = await runCli([
      "BRE-CLI", "nonexistent_gate", "--verdict", "APPROVED"
    ]);
    expect(exitCode).toBe(3);
  });
});
