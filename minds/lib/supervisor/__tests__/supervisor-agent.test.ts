/**
 * supervisor-agent.test.ts — Tests for Mind Agent file generation.
 *
 * Validates buildMindAgentContent, writeMindAgentFile, and cleanupMindAgentFile.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildMindAgentContent,
  writeMindAgentFile,
  cleanupMindAgentFile,
  type MindAgentParams,
} from "../supervisor-agent.ts";
import { REVIEW_CHECKLIST, REVIEW_RESPONSE_FORMAT } from "../supervisor-review.ts";
import { makeTestTmpDir } from "./test-helpers.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeParams(overrides?: Partial<MindAgentParams>): MindAgentParams {
  return {
    mindName: "transport",
    worktreePath: join(tmpDir, "worktree"),
    repoRoot: tmpDir,
    standards: "# Standards\n\nAll exports must have tests.",
    ownsFiles: ["minds/transport/", "src/transport/"],
    iteration: 1,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = makeTestTmpDir("supervisor-agent");
  // Create the minds directory structure (dev layout: minds/cli exists)
  mkdirSync(join(tmpDir, "minds", "cli"), { recursive: true });
  // Create worktree directory
  mkdirSync(join(tmpDir, "worktree"), { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// buildMindAgentContent
// ---------------------------------------------------------------------------

describe("buildMindAgentContent", () => {
  test("produces valid frontmatter with model: opus and correct permissions", () => {
    const content = buildMindAgentContent(makeParams());

    // Check frontmatter structure
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("name: Mind");
    expect(content).toContain("model: opus");
    expect(content).toContain("Bash(git:*)");
    expect(content).toContain("Read(*)");
    expect(content).toContain("Grep(*)");
    expect(content).toContain("Glob(*)");

    // Verify frontmatter closes
    const parts = content.split("---");
    // parts[0] = empty (before first ---), parts[1] = frontmatter, parts[2+] = body
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  test("includes MIND.md content when provided", () => {
    const content = buildMindAgentContent(makeParams({
      mindMdContent: "# Transport Mind\n\nHandles SSE and bus communication.\n",
    }));

    expect(content).toContain("Transport Mind");
    expect(content).toContain("Handles SSE and bus communication.");
  });

  test("handles missing MIND.md gracefully", () => {
    // No MIND.md created — should not throw
    const content = buildMindAgentContent(makeParams());

    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
    // Should still have frontmatter and structure
    expect(content).toContain("model: opus");
    expect(content).toContain("@transport");
  });

  test("includes owns_files boundary list", () => {
    const content = buildMindAgentContent(makeParams());

    expect(content).toContain("minds/transport/");
    expect(content).toContain("src/transport/");
    // Should be in a boundary section
    expect(content).toContain("owns_files");
  });

  test("includes previous feedback when provided", () => {
    const params = makeParams({
      previousFeedback: "## Round 1 Feedback\n\n- Missing error handling in handler.ts",
      iteration: 2,
    });

    const content = buildMindAgentContent(params);

    expect(content).toContain("Round 1 Feedback");
    expect(content).toContain("Missing error handling");
  });

  test("omits previous feedback section when not provided", () => {
    const content = buildMindAgentContent(makeParams());

    expect(content).not.toContain("Previous Feedback");
  });

  test("includes every item from REVIEW_CHECKLIST", () => {
    const content = buildMindAgentContent(makeParams());

    for (const item of REVIEW_CHECKLIST) {
      expect(content).toContain(item);
    }
  });

  test("includes REVIEW_RESPONSE_FORMAT constant", () => {
    const content = buildMindAgentContent(makeParams());

    expect(content).toContain(REVIEW_RESPONSE_FORMAT);
  });
});

// ---------------------------------------------------------------------------
// writeMindAgentFile
// ---------------------------------------------------------------------------

describe("writeMindAgentFile", () => {
  test("creates .claude/agents/Mind.md in worktree", () => {
    const params = makeParams();
    const agentPath = writeMindAgentFile(params);

    const expectedPath = join(params.worktreePath, ".claude", "agents", "Mind.md");
    expect(agentPath).toBe(expectedPath);
    expect(existsSync(agentPath)).toBe(true);

    // Verify content was written
    const content = readFileSync(agentPath, "utf-8");
    expect(content).toContain("model: opus");
    expect(content).toContain("@transport");
  });

  test("auto-loads MIND.md from disk when mindMdContent is not provided", () => {
    // Create a MIND.md file in the expected location
    const mindDir = join(tmpDir, "minds", "transport");
    mkdirSync(mindDir, { recursive: true });
    writeFileSync(join(mindDir, "MIND.md"), "# Transport Mind\n\nOwns SSE and bus communication.\n");

    // Call writeMindAgentFile WITHOUT providing mindMdContent
    const params = makeParams(); // no mindMdContent in defaults
    const agentPath = writeMindAgentFile(params);

    // Verify the generated agent file contains the MIND.md content loaded from disk
    const content = readFileSync(agentPath, "utf-8");
    expect(content).toContain("Transport Mind");
    expect(content).toContain("Owns SSE and bus communication.");
    expect(content).toContain("Domain Expertise");
  });

  test("creates intermediate directories if missing", () => {
    const freshWorktree = join(tmpDir, "fresh-worktree");
    // Don't create .claude/agents/ — writeMindAgentFile should handle it
    mkdirSync(freshWorktree, { recursive: true });

    const params = makeParams({ worktreePath: freshWorktree });
    const agentPath = writeMindAgentFile(params);

    expect(existsSync(agentPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cleanupMindAgentFile
// ---------------------------------------------------------------------------

describe("cleanupMindAgentFile", () => {
  test("removes the agent file when it exists", () => {
    const params = makeParams();
    const agentPath = writeMindAgentFile(params);
    expect(existsSync(agentPath)).toBe(true);

    cleanupMindAgentFile(params.worktreePath);
    expect(existsSync(agentPath)).toBe(false);
  });

  test("no-ops when file does not exist", () => {
    // Should not throw
    cleanupMindAgentFile(join(tmpDir, "nonexistent-worktree"));
  });

  test("no-ops when worktree exists but agent file does not", () => {
    const worktree = join(tmpDir, "worktree");
    mkdirSync(worktree, { recursive: true });

    // Should not throw
    cleanupMindAgentFile(worktree);
  });
});
