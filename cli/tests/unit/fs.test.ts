import { describe, test, expect, afterEach } from "bun:test";
import { ensureDir, copyRecursive, setExecutable, countFiles } from "../../src/utils/fs";
import { createTempDir, cleanupTempDir } from "../helpers";
import { existsSync, writeFileSync, mkdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

describe("fs utils", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      cleanupTempDir(dir);
    }
    dirs.length = 0;
  });

  describe("ensureDir", () => {
    test("creates a directory that does not exist", () => {
      const dir = createTempDir();
      dirs.push(dir);
      const target = join(dir, "a", "b", "c");
      expect(existsSync(target)).toBe(false);
      ensureDir(target);
      expect(existsSync(target)).toBe(true);
      expect(statSync(target).isDirectory()).toBe(true);
    });

    test("does not throw when directory already exists", () => {
      const dir = createTempDir();
      dirs.push(dir);
      ensureDir(dir);
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("copyRecursive", () => {
    test("copies a single file", () => {
      const dir = createTempDir();
      dirs.push(dir);
      const src = join(dir, "source.txt");
      const dest = join(dir, "dest.txt");
      writeFileSync(src, "hello");

      const result = copyRecursive(src, dest);

      expect(result.copied).toContain(dest);
      expect(result.errors).toHaveLength(0);
      expect(readFileSync(dest, "utf-8")).toBe("hello");
    });

    test("copies a directory recursively", () => {
      const dir = createTempDir();
      dirs.push(dir);

      // Create source structure
      const srcDir = join(dir, "src");
      mkdirSync(join(srcDir, "sub"), { recursive: true });
      writeFileSync(join(srcDir, "a.txt"), "file-a");
      writeFileSync(join(srcDir, "sub", "b.txt"), "file-b");

      const destDir = join(dir, "dest");
      const result = copyRecursive(srcDir, destDir);

      expect(result.copied.length).toBeGreaterThanOrEqual(2);
      expect(readFileSync(join(destDir, "a.txt"), "utf-8")).toBe("file-a");
      expect(readFileSync(join(destDir, "sub", "b.txt"), "utf-8")).toBe("file-b");
    });

    test("skips existing file when skipIfExists is true", () => {
      const dir = createTempDir();
      dirs.push(dir);
      const src = join(dir, "source.txt");
      const dest = join(dir, "dest.txt");
      writeFileSync(src, "new content");
      writeFileSync(dest, "existing content");

      const result = copyRecursive(src, dest, { skipIfExists: true });

      expect(result.skipped).toContain(dest);
      expect(readFileSync(dest, "utf-8")).toBe("existing content");
    });

    test("overwrites existing file when force is true", () => {
      const dir = createTempDir();
      dirs.push(dir);
      const src = join(dir, "source.txt");
      const dest = join(dir, "dest.txt");
      writeFileSync(src, "new content");
      writeFileSync(dest, "existing content");

      const result = copyRecursive(src, dest, { force: true });

      expect(result.copied).toContain(dest);
      expect(readFileSync(dest, "utf-8")).toBe("new content");
    });

    test("returns error for nonexistent source", () => {
      const dir = createTempDir();
      dirs.push(dir);
      const result = copyRecursive(join(dir, "nope"), join(dir, "dest"));
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("not found");
    });
  });

  describe("setExecutable", () => {
    test("sets executable permission on a file", () => {
      const dir = createTempDir();
      dirs.push(dir);
      const filePath = join(dir, "script.sh");
      writeFileSync(filePath, "#!/bin/bash\necho hi");

      setExecutable(filePath);

      const stat = statSync(filePath);
      // Check owner execute bit (0o100)
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });
  });

  describe("countFiles", () => {
    test("counts all files in a directory", () => {
      const dir = createTempDir();
      dirs.push(dir);
      writeFileSync(join(dir, "a.txt"), "");
      writeFileSync(join(dir, "b.md"), "");
      writeFileSync(join(dir, "c.ts"), "");

      expect(countFiles(dir)).toBe(3);
    });

    test("counts files matching a pattern", () => {
      const dir = createTempDir();
      dirs.push(dir);
      writeFileSync(join(dir, "a.txt"), "");
      writeFileSync(join(dir, "b.md"), "");
      writeFileSync(join(dir, "c.ts"), "");

      expect(countFiles(dir, /\.md$/)).toBe(1);
      expect(countFiles(dir, /\.ts$/)).toBe(1);
    });

    test("counts files in nested subdirectories", () => {
      const dir = createTempDir();
      dirs.push(dir);
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "a.ts"), "");
      writeFileSync(join(dir, "sub", "b.ts"), "");

      expect(countFiles(dir, /\.ts$/)).toBe(2);
    });

    test("returns 0 for nonexistent directory", () => {
      expect(countFiles("/tmp/this-does-not-exist-collab-test")).toBe(0);
    });

    test("returns 0 for empty directory", () => {
      const dir = createTempDir();
      dirs.push(dir);
      expect(countFiles(dir)).toBe(0);
    });
  });
});
