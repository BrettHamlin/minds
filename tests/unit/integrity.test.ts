/**
 * Unit tests for src/cli/lib/integrity.ts
 * Covers: hash generation, verification, mismatch detection, file hash.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeChecksum,
  checksumFile,
  verifyChecksum,
  verifyFileChecksum,
  checksumMap,
  generateChecksum,
  verifyDirectoryChecksum,
} from "../../minds/cli/lib/integrity.js";

// ─── computeChecksum ─────────────────────────────────────────────────────────

describe("computeChecksum", () => {
  test("produces hex SHA-256 for a string", () => {
    const hash = computeChecksum("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });

  test("produces hex SHA-256 for a Buffer", () => {
    // String and Buffer of same content should produce same hash
    const hashStr = computeChecksum("hello world");
    const hashBuf = computeChecksum(Buffer.from("hello world"));
    expect(hashStr).toBe(hashBuf);
  });

  test("same input always produces same hash", () => {
    const a = computeChecksum("test data 123");
    const b = computeChecksum("test data 123");
    expect(a).toBe(b);
  });

  test("different inputs produce different hashes", () => {
    const a = computeChecksum("data a");
    const b = computeChecksum("data b");
    expect(a).not.toBe(b);
  });

  test("empty string produces 64-char hex hash", () => {
    const hash = computeChecksum("");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });
});

// ─── checksumFile ─────────────────────────────────────────────────────────────

describe("checksumFile", () => {
  test("hashes a file on disk", () => {
    const tmpPath = join(tmpdir(), `integrity-test-${Date.now()}.txt`);
    writeFileSync(tmpPath, "file content for hashing");

    const hash = checksumFile(tmpPath);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(computeChecksum("file content for hashing"));

    unlinkSync(tmpPath);
  });

  test("throws CollabError on missing file", () => {
    expect(() => checksumFile("/nonexistent/path/that/does/not/exist.txt")).toThrow();

    try {
      checksumFile("/nonexistent/path/that/does/not/exist.txt");
    } catch (err) {
      expect((err as { code: string }).code).toBe("CHECKSUM_MISMATCH");
    }
  });
});

// ─── verifyChecksum ───────────────────────────────────────────────────────────

describe("verifyChecksum", () => {
  test("passes when checksum matches", () => {
    const data = "my tarball content";
    const expected = computeChecksum(data);
    // Should not throw
    expect(() => verifyChecksum(data, expected, "my-pipeline")).not.toThrow();
  });

  test("throws CHECKSUM_MISMATCH when checksums differ", () => {
    expect(() =>
      verifyChecksum("real data", "000000wrongchecksum000000", "my-pipeline")
    ).toThrow();

    try {
      verifyChecksum("real data", "000000wrongchecksum000000", "my-pipeline");
    } catch (err) {
      expect((err as { code: string }).code).toBe("CHECKSUM_MISMATCH");
      expect((err as { error: string }).error).toContain("my-pipeline");
    }
  });

  test("works with Buffer input", () => {
    const data = Buffer.from("tarball bytes");
    const expected = computeChecksum(data);
    expect(() => verifyChecksum(data, expected, "pkg")).not.toThrow();
  });
});

// ─── verifyFileChecksum ───────────────────────────────────────────────────────

describe("verifyFileChecksum", () => {
  test("passes when file checksum matches", () => {
    const tmpPath = join(tmpdir(), `integrity-verify-${Date.now()}.txt`);
    const content = "verifiable content";
    writeFileSync(tmpPath, content);
    const expected = computeChecksum(content);

    expect(() => verifyFileChecksum(tmpPath, expected, "test-pkg")).not.toThrow();
    unlinkSync(tmpPath);
  });

  test("throws when file content doesn't match expected checksum", () => {
    const tmpPath = join(tmpdir(), `integrity-mismatch-${Date.now()}.txt`);
    writeFileSync(tmpPath, "actual content");

    expect(() =>
      verifyFileChecksum(tmpPath, "000000wrongchecksum", "test-pkg")
    ).toThrow();

    unlinkSync(tmpPath);
  });
});

// ─── generateChecksum (directory) ────────────────────────────────────────────

describe("generateChecksum (directory)", () => {
  function makePipelineDir(files: Record<string, string>): string {
    const dir = join(tmpdir(), `integrity-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const fullPath = join(dir, rel);
      mkdirSync(join(dir, rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "."), { recursive: true });
      writeFileSync(fullPath, content);
    }
    return dir;
  }

  test("hash determinism — same directory, two calls produce identical hash", () => {
    const dir = makePipelineDir({
      "pipeline.json": '{"name":"specify","version":"1.0.0"}',
      "commands/collab.specify.md": "# Specify command content",
    });

    const hash1 = generateChecksum(dir);
    const hash2 = generateChecksum(dir);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    rmSync(dir, { recursive: true, force: true });
  });

  test("hash changes on file edit", () => {
    const dir = makePipelineDir({
      "pipeline.json": '{"name":"specify","version":"1.0.0"}',
      "commands/collab.specify.md": "# Original content",
    });

    const before = generateChecksum(dir);
    writeFileSync(join(dir, "commands/collab.specify.md"), "# Modified content");
    const after = generateChecksum(dir);

    expect(before).not.toBe(after);

    rmSync(dir, { recursive: true, force: true });
  });

  test("hash changes on file add", () => {
    const dir = makePipelineDir({
      "pipeline.json": '{"name":"specify","version":"1.0.0"}',
    });

    const before = generateChecksum(dir);
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "commands/collab.specify.md"), "# New file");
    const after = generateChecksum(dir);

    expect(before).not.toBe(after);

    rmSync(dir, { recursive: true, force: true });
  });

  test("hash changes on file remove", () => {
    const dir = makePipelineDir({
      "pipeline.json": '{"name":"specify","version":"1.0.0"}',
      "commands/collab.specify.md": "# Command content",
    });

    const before = generateChecksum(dir);
    unlinkSync(join(dir, "commands/collab.specify.md"));
    const after = generateChecksum(dir);

    expect(before).not.toBe(after);

    rmSync(dir, { recursive: true, force: true });
  });

  test("sort order independence — files created in different order produce same hash", () => {
    // Directory A: pipeline.json first, then command
    const dirA = makePipelineDir({
      "pipeline.json": '{"name":"plan","version":"1.0.0"}',
      "commands/collab.plan.md": "# Plan content",
    });

    // Directory B: command first, then pipeline.json (same content, different creation order)
    const dirB = join(tmpdir(), `integrity-dir-b-${Date.now()}`);
    mkdirSync(join(dirB, "commands"), { recursive: true });
    writeFileSync(join(dirB, "commands/collab.plan.md"), "# Plan content");
    writeFileSync(join(dirB, "pipeline.json"), '{"name":"plan","version":"1.0.0"}');

    const hashA = generateChecksum(dirA);
    const hashB = generateChecksum(dirB);

    expect(hashA).toBe(hashB);

    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  test("empty directory returns consistent hash (not an error)", () => {
    const dir = join(tmpdir(), `integrity-empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const hash1 = generateChecksum(dir);
    const hash2 = generateChecksum(dir);

    expect(hash1).toBe(hash2); // consistent
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // valid hex

    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── verifyDirectoryChecksum ──────────────────────────────────────────────────

describe("verifyDirectoryChecksum", () => {
  test("verify match — returns { valid: true } when hash matches", () => {
    const dir = join(tmpdir(), `integrity-verify-dir-${Date.now()}`);
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "pipeline.json"), '{"name":"tasks","version":"1.0.0"}');
    writeFileSync(join(dir, "commands/collab.tasks.md"), "# Tasks");

    const expected = generateChecksum(dir);
    const result = verifyDirectoryChecksum(dir, expected);

    expect(result.valid).toBe(true);
    expect(result.actual).toBe(expected);

    rmSync(dir, { recursive: true, force: true });
  });

  test("verify mismatch — returns { valid: false, actual } when hash differs", () => {
    const dir = join(tmpdir(), `integrity-mismatch-dir-${Date.now()}`);
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "pipeline.json"), '{"name":"tasks","version":"1.0.0"}');

    const result = verifyDirectoryChecksum(dir, "0".repeat(64));

    expect(result.valid).toBe(false);
    expect(result.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(result.actual).not.toBe("0".repeat(64));

    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── checksumMap ─────────────────────────────────────────────────────────────

describe("checksumMap", () => {
  test("generates checksums for multiple named entries", () => {
    const entries = [
      { name: "specify", data: Buffer.from("specify tarball") },
      { name: "plan", data: Buffer.from("plan tarball") },
    ];

    const map = checksumMap(entries);
    expect(map.size).toBe(2);
    expect(map.get("specify")).toBe(computeChecksum("specify tarball"));
    expect(map.get("plan")).toBe(computeChecksum("plan tarball"));
  });
});
