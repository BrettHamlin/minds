import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { removeDroneBrief } from "./cleanup";

// ─── removeDroneBrief ─────────────────────────────────────────────────────────

describe("removeDroneBrief", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = join(tmpdir(), `cleanup-test-${Date.now()}`);
    mkdirSync(worktree, { recursive: true });
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
  });

  it("removes DRONE-BRIEF.md when present", () => {
    const p = join(worktree, "DRONE-BRIEF.md");
    writeFileSync(p, "drone brief content");

    const result = removeDroneBrief(worktree);

    expect(result.ok).toBe(true);
    expect(result.removed).toContain(p);
    expect(existsSync(p)).toBe(false);
  });

  it("removes MIND-BRIEF.md when present", () => {
    const p = join(worktree, "MIND-BRIEF.md");
    writeFileSync(p, "mind brief content");

    const result = removeDroneBrief(worktree);

    expect(result.ok).toBe(true);
    expect(result.removed).toContain(p);
    expect(existsSync(p)).toBe(false);
  });

  it("removes both DRONE-BRIEF.md and MIND-BRIEF.md when both present", () => {
    const drone = join(worktree, "DRONE-BRIEF.md");
    const mind = join(worktree, "MIND-BRIEF.md");
    writeFileSync(drone, "drone");
    writeFileSync(mind, "mind");

    const result = removeDroneBrief(worktree);

    expect(result.ok).toBe(true);
    expect(result.removed).toContain(drone);
    expect(result.removed).toContain(mind);
    expect(existsSync(drone)).toBe(false);
    expect(existsSync(mind)).toBe(false);
  });

  it("skips missing brief files without error", () => {
    const result = removeDroneBrief(worktree);

    expect(result.ok).toBe(true);
    expect(result.removed).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toHaveLength(2); // both files skipped
  });

  it("removes DRONE-BRIEF.md and skips missing MIND-BRIEF.md", () => {
    const drone = join(worktree, "DRONE-BRIEF.md");
    writeFileSync(drone, "drone");

    const result = removeDroneBrief(worktree);

    expect(result.ok).toBe(true);
    expect(result.removed).toEqual([drone]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("MIND-BRIEF.md");
  });
});
