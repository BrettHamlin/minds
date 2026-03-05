// Tests for statusline reader (BRE-398 / T015)

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { render } from "../collab-statusline";
import type { CachedStatus } from "../collab-statusline";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `test-statusline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCache(dir: string, cache: CachedStatus): string {
  const p = join(dir, "cache.json");
  writeFileSync(p, JSON.stringify(cache));
  return p;
}

describe("collab-statusline render()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("no cache file → 'collab: no status'", () => {
    expect(render(join(tempDir, "nonexistent.json"))).toBe("collab: no status");
  });

  test("empty pipelines → 'collab: idle'", () => {
    const p = writeCache(tempDir, {
      pipelines: [],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });
    expect(render(p)).toBe("collab: idle");
  });

  test("connected=false → 'collab: disconnected'", () => {
    const p = writeCache(tempDir, {
      pipelines: [],
      lastUpdate: new Date().toISOString(),
      connected: false,
    });
    expect(render(p)).toBe("collab: disconnected");
  });

  test("stale lastUpdate (>30s) → 'collab: stale'", () => {
    const staleDate = new Date(Date.now() - 60_000).toISOString();
    const p = writeCache(tempDir, {
      pipelines: [
        { ticketId: "BRE-100", phase: "implement", status: "running", detail: "running" },
      ],
      lastUpdate: staleDate,
      connected: true,
    });
    expect(render(p)).toBe("collab: stale");
  });

  test("single pipeline → formatted output", () => {
    const p = writeCache(tempDir, {
      pipelines: [
        { ticketId: "BRE-123", phase: "implement", status: "running", detail: "running" },
      ],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });
    expect(render(p)).toBe("BRE-123 implement ▸ running");
  });

  test("multiple pipelines → pipe-separated output", () => {
    const p = writeCache(tempDir, {
      pipelines: [
        { ticketId: "BRE-100", phase: "implement", status: "running", detail: "impl 2/5" },
        { ticketId: "BRE-200", phase: "plan", status: "running", detail: "Working on plan phase" },
      ],
      lastUpdate: new Date().toISOString(),
      connected: true,
    });
    const result = render(p);
    expect(result).toBe("BRE-100 implement ▸ impl 2/5 | BRE-200 plan ▸ Working on plan phase");
  });

  test("malformed JSON → 'collab: error'", () => {
    const p = join(tempDir, "bad.json");
    writeFileSync(p, "not json{{{");
    expect(render(p)).toBe("collab: error");
  });
});
