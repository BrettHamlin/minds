import { describe, test, expect, afterEach } from "bun:test";
import { readVersion, writeVersion, type CollabVersion } from "../../src/utils/version";
import { createTempDir, cleanupTempDir } from "../helpers";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

describe("version utils", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      cleanupTempDir(dir);
    }
    dirs.length = 0;
  });

  describe("readVersion", () => {
    test("returns null when no version.json exists", () => {
      const dir = createTempDir();
      dirs.push(dir);
      expect(readVersion(dir)).toBeNull();
    });

    test("reads a valid version.json", () => {
      const dir = createTempDir();
      dirs.push(dir);
      mkdirSync(join(dir, ".collab"), { recursive: true });
      const versionData: CollabVersion = {
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const { writeFileSync } = require("fs");
      writeFileSync(join(dir, ".collab/version.json"), JSON.stringify(versionData));

      const result = readVersion(dir);
      expect(result).not.toBeNull();
      expect(result!.version).toBe("0.1.0");
      expect(result!.installedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result!.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    test("reads version.json with previousVersion field", () => {
      const dir = createTempDir();
      dirs.push(dir);
      mkdirSync(join(dir, ".collab"), { recursive: true });
      const versionData: CollabVersion = {
        version: "0.2.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
        previousVersion: "0.1.0",
      };
      const { writeFileSync } = require("fs");
      writeFileSync(join(dir, ".collab/version.json"), JSON.stringify(versionData));

      const result = readVersion(dir);
      expect(result!.previousVersion).toBe("0.1.0");
    });
  });

  describe("writeVersion", () => {
    test("writes version.json to .collab directory", () => {
      const dir = createTempDir();
      dirs.push(dir);
      mkdirSync(join(dir, ".collab"), { recursive: true });

      const versionData: CollabVersion = {
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      writeVersion(dir, versionData);

      expect(existsSync(join(dir, ".collab/version.json"))).toBe(true);
      const written = JSON.parse(readFileSync(join(dir, ".collab/version.json"), "utf-8"));
      expect(written.version).toBe("0.1.0");
    });

    test("preserves installedAt across updates", () => {
      const dir = createTempDir();
      dirs.push(dir);
      mkdirSync(join(dir, ".collab"), { recursive: true });

      const original: CollabVersion = {
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      writeVersion(dir, original);

      // Simulate update: read, modify, write back
      const existing = readVersion(dir)!;
      const updated: CollabVersion = {
        version: "0.2.0",
        installedAt: existing.installedAt, // Preserve original
        updatedAt: "2026-02-01T00:00:00.000Z",
        previousVersion: existing.version,
      };
      writeVersion(dir, updated);

      const result = readVersion(dir)!;
      expect(result.version).toBe("0.2.0");
      expect(result.installedAt).toBe("2026-01-01T00:00:00.000Z"); // Preserved
      expect(result.updatedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(result.previousVersion).toBe("0.1.0");
    });

    test("writes formatted JSON with trailing newline", () => {
      const dir = createTempDir();
      dirs.push(dir);
      mkdirSync(join(dir, ".collab"), { recursive: true });

      writeVersion(dir, {
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const raw = readFileSync(join(dir, ".collab/version.json"), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      // Should be pretty-printed (indented)
      expect(raw).toContain("  ");
    });
  });
});
