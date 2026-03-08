/**
 * Unit tests for hygiene.ts — promotion and pruning operations.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { promoteToMemoryMd, pruneStaleEntries } from "./hygiene";
import { memoryMdPath } from "./paths";

const TEST_MIND = "memory";

// Save/restore MEMORY.md around tests
let originalContent: string | null = null;
const mdPath = memoryMdPath(TEST_MIND);

function saveOriginal(): void {
  originalContent = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null;
}

function restoreOriginal(): void {
  if (originalContent !== null) {
    writeFileSync(mdPath, originalContent, "utf8");
  }
}

describe("promoteToMemoryMd", () => {
  afterEach(restoreOriginal);

  test("no-op when entries array is empty", async () => {
    saveOriginal();
    const before = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
    await promoteToMemoryMd(TEST_MIND, []);
    const after = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
    expect(after).toBe(before);
  });

  test("adds promoted section with entries", async () => {
    saveOriginal();
    await promoteToMemoryMd(TEST_MIND, ["Insight alpha", "Insight beta"]);
    const content = readFileSync(mdPath, "utf8");
    expect(content).toContain("Insight alpha");
    expect(content).toContain("Insight beta");
    expect(content).toContain("<!-- PROMOTED ENTRIES START -->");
    expect(content).toContain("<!-- PROMOTED ENTRIES END -->");
  });

  test("idempotent — duplicate entries not added twice", async () => {
    saveOriginal();
    await promoteToMemoryMd(TEST_MIND, ["Stable truth X"]);
    await promoteToMemoryMd(TEST_MIND, ["Stable truth X"]);
    const content = readFileSync(mdPath, "utf8");
    const count = (content.match(/Stable truth X/g) ?? []).length;
    expect(count).toBe(1);
  });

  test("second call adds new entries without duplicating old", async () => {
    saveOriginal();
    await promoteToMemoryMd(TEST_MIND, ["Entry one"]);
    await promoteToMemoryMd(TEST_MIND, ["Entry two"]);
    const content = readFileSync(mdPath, "utf8");
    expect(content).toContain("Entry one");
    expect(content).toContain("Entry two");
  });

  test("entries include date stamp", async () => {
    saveOriginal();
    await promoteToMemoryMd(TEST_MIND, ["Dated insight"]);
    const content = readFileSync(mdPath, "utf8");
    // Should contain a date in [YYYY-MM-DD] format
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}\]/);
  });
});

describe("pruneStaleEntries", () => {
  afterEach(restoreOriginal);

  test("no-op when no stale markers", async () => {
    saveOriginal();
    const before = readFileSync(mdPath, "utf8");
    await pruneStaleEntries(TEST_MIND);
    const after = readFileSync(mdPath, "utf8");
    expect(after).toBe(before);
  });

  test("removes lines with STALE marker", async () => {
    saveOriginal();
    const before = readFileSync(mdPath, "utf8");
    writeFileSync(mdPath, before + "\n- This is stale <!-- STALE -->\n- This is fresh\n", "utf8");
    await pruneStaleEntries(TEST_MIND);
    const after = readFileSync(mdPath, "utf8");
    expect(after).not.toContain("<!-- STALE -->");
    expect(after).toContain("This is fresh");
  });

  test("idempotent — second prune has no effect", async () => {
    saveOriginal();
    const before = readFileSync(mdPath, "utf8");
    writeFileSync(mdPath, before + "\n- Stale line <!-- STALE -->\n", "utf8");
    await pruneStaleEntries(TEST_MIND);
    const afterFirst = readFileSync(mdPath, "utf8");
    await pruneStaleEntries(TEST_MIND);
    const afterSecond = readFileSync(mdPath, "utf8");
    expect(afterFirst).toBe(afterSecond);
    expect(afterSecond).not.toContain("<!-- STALE -->");
  });

  test("no-op when MEMORY.md does not exist", async () => {
    // Test with a mind that has no memory dir yet — should not throw
    await expect(pruneStaleEntries("nonexistent-mind-xyz")).resolves.toBeUndefined();
  });
});
