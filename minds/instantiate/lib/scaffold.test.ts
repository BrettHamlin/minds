/**
 * scaffold.test.ts — Unit tests for the @instantiate Mind scaffold logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scaffoldMind,
  validateMindName,
  generateMindMd,
  generateServerTs,
  mindsSourceDir,
  mindsJsonPath,
} from "./scaffold.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  const dir = join(tmpdir(), `instantiate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// validateMindName
// ---------------------------------------------------------------------------

describe("validateMindName", () => {
  it("accepts valid lowercase names", () => {
    expect(validateMindName("foo")).toBeNull();
    expect(validateMindName("my-mind")).toBeNull();
    expect(validateMindName("mind123")).toBeNull();
    expect(validateMindName("a")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateMindName("")).not.toBeNull();
  });

  it("rejects names with uppercase", () => {
    expect(validateMindName("MyMind")).not.toBeNull();
    expect(validateMindName("FOO")).not.toBeNull();
  });

  it("rejects names with spaces", () => {
    expect(validateMindName("my mind")).not.toBeNull();
  });

  it("rejects names starting with a digit", () => {
    expect(validateMindName("1foo")).not.toBeNull();
  });

  it("rejects names starting with a hyphen", () => {
    expect(validateMindName("-foo")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

describe("generateMindMd", () => {
  it("includes the name in the heading", () => {
    const md = generateMindMd("test-mind", "Test domain");
    expect(md).toContain("# @test-mind Mind Profile");
  });

  it("includes the domain", () => {
    const md = generateMindMd("test-mind", "Test domain description");
    expect(md).toContain("Test domain description");
  });

  it("defaults to minds/ prefix in paths", () => {
    const md = generateMindMd("test-mind", "Test domain");
    expect(md).toContain("`minds/test-mind/server.ts`");
    expect(md).toContain("`minds/test-mind/lib/`");
  });

  it("uses .minds/ prefix when specified", () => {
    const md = generateMindMd("test-mind", "Test domain", ".minds");
    expect(md).toContain("`.minds/test-mind/server.ts`");
    expect(md).toContain("`.minds/test-mind/lib/`");
    expect(md).not.toContain("`minds/test-mind/");
  });
});

describe("generateServerTs", () => {
  it("includes the name in createMind call", () => {
    const ts = generateServerTs("test-mind", "Test domain");
    expect(ts).toContain('name: "test-mind"');
  });

  it("includes the domain in createMind call", () => {
    const ts = generateServerTs("test-mind", "Test domain");
    expect(ts).toContain('domain: "Test domain"');
  });

  it("imports createMind from @minds/server-base.js", () => {
    const ts = generateServerTs("test-mind", "Test domain");
    expect(ts).toContain('from "@minds/server-base.js"');
  });

  it("exports default from createMind call", () => {
    const ts = generateServerTs("test-mind", "Test domain");
    expect(ts).toContain("export default createMind(");
  });

  it("defaults to minds/ prefix in owns_files", () => {
    const ts = generateServerTs("test-mind", "Test domain");
    expect(ts).toContain('owns_files: ["minds/test-mind/"]');
  });

  it("uses .minds/ prefix when specified", () => {
    const ts = generateServerTs("test-mind", "Test domain", ".minds");
    expect(ts).toContain('owns_files: [".minds/test-mind/"]');
    expect(ts).not.toContain('owns_files: ["minds/test-mind/"]');
  });
});

// ---------------------------------------------------------------------------
// scaffoldMind — file creation
// ---------------------------------------------------------------------------

describe("scaffoldMind", () => {
  let srcDir: string;
  let jsonDir: string;
  let jsonPath: string;

  beforeEach(() => {
    srcDir = tempDir();
    jsonDir = tempDir();
    jsonPath = join(jsonDir, "minds.json");
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(jsonDir, { recursive: true, force: true });
  });

  it("creates the Mind directory", async () => {
    await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    expect(existsSync(join(srcDir, "my-mind"))).toBe(true);
  });

  it("creates MIND.md with correct name and domain", async () => {
    await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    const content = readFileSync(join(srcDir, "my-mind", "MIND.md"), "utf8");
    expect(content).toContain("# @my-mind Mind Profile");
    expect(content).toContain("My domain");
  });

  it("creates server.ts with correct name and domain", async () => {
    await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    const content = readFileSync(join(srcDir, "my-mind", "server.ts"), "utf8");
    expect(content).toContain('name: "my-mind"');
    expect(content).toContain('domain: "My domain"');
  });

  it("creates lib/ directory", async () => {
    await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    expect(existsSync(join(srcDir, "my-mind", "lib"))).toBe(true);
  });

  it("returns correct result shape", async () => {
    const result = await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    expect(result.registered).toBe(true);
    expect(result.mindDir).toBe(join(srcDir, "my-mind"));
    expect(result.files).toHaveLength(2);
    expect(result.mindsJson).toBe(jsonPath);
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  it("creates minds.json when it doesn't exist", async () => {
    await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    expect(existsSync(jsonPath)).toBe(true);
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("my-mind");
  });

  it("appends to existing minds.json", async () => {
    const existing = [{ name: "existing", domain: "existing domain", keywords: [], owns_files: [], capabilities: [] }];
    writeFileSync(jsonPath, JSON.stringify(existing, null, 2));

    await scaffoldMind("my-mind", "My domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(entries).toHaveLength(2);
    expect(entries.map((e: { name: string }) => e.name)).toContain("existing");
    expect(entries.map((e: { name: string }) => e.name)).toContain("my-mind");
  });

  it("replaces stale entry with same name", async () => {
    const existing = [{ name: "my-mind", domain: "old domain", keywords: [], owns_files: [], capabilities: [] }];
    writeFileSync(jsonPath, JSON.stringify(existing, null, 2));

    // Remove the existing directory guard so we can re-register
    const result = await scaffoldMind("my-mind", "New domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(entries).toHaveLength(1);
    expect(entries[0].domain).toBe("New domain");
    expect(result.registered).toBe(true);
  });

  it("registered entry has correct fields", async () => {
    await scaffoldMind("my-mind", "My domain description", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    const entry = entries[0];
    expect(entry.name).toBe("my-mind");
    expect(entry.domain).toBe("My domain description");
    expect(Array.isArray(entry.keywords)).toBe(true);
    expect(Array.isArray(entry.owns_files)).toBe(true);
    expect(Array.isArray(entry.capabilities)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------

  it("throws on invalid name", async () => {
    await expect(
      scaffoldMind("My Mind", "domain", { mindsSrcDir: srcDir, mindsJsonOverride: jsonPath })
    ).rejects.toThrow("name");
  });

  it("throws on empty domain", async () => {
    await expect(
      scaffoldMind("my-mind", "", { mindsSrcDir: srcDir, mindsJsonOverride: jsonPath })
    ).rejects.toThrow("domain");
  });

  it("throws if Mind directory already exists", async () => {
    mkdirSync(join(srcDir, "my-mind"), { recursive: true });
    await expect(
      scaffoldMind("my-mind", "domain", { mindsSrcDir: srcDir, mindsJsonOverride: jsonPath })
    ).rejects.toThrow("already exists");
  });

  // ---------------------------------------------------------------------------
  // Prefix detection (.minds vs minds)
  // ---------------------------------------------------------------------------

  it("uses .minds prefix when mindsSrcDir basename is .minds", async () => {
    const dotMindsDir = join(tempDir(), ".minds");
    mkdirSync(dotMindsDir, { recursive: true });

    try {
      const result = await scaffoldMind("my-mind", "My domain", {
        mindsSrcDir: dotMindsDir,
        mindsJsonOverride: jsonPath,
      });

      // Generated server.ts should use .minds/ prefix
      const serverContent = readFileSync(join(result.mindDir, "server.ts"), "utf8");
      expect(serverContent).toContain('owns_files: [".minds/my-mind/"]');

      // Generated MIND.md should use .minds/ prefix
      const mindMdContent = readFileSync(join(result.mindDir, "MIND.md"), "utf8");
      expect(mindMdContent).toContain("`.minds/my-mind/server.ts`");

      // Registry entry should use .minds/ prefix
      const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(entries[0].owns_files).toEqual([".minds/my-mind/"]);
    } finally {
      rmSync(join(dotMindsDir, ".."), { recursive: true, force: true });
    }
  });

  it("uses minds prefix when mindsSrcDir basename is minds", async () => {
    const mindsDir = join(tempDir(), "minds");
    mkdirSync(mindsDir, { recursive: true });

    try {
      const result = await scaffoldMind("my-mind", "My domain", {
        mindsSrcDir: mindsDir,
        mindsJsonOverride: jsonPath,
      });

      const serverContent = readFileSync(join(result.mindDir, "server.ts"), "utf8");
      expect(serverContent).toContain('owns_files: ["minds/my-mind/"]');

      const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(entries[0].owns_files).toEqual(["minds/my-mind/"]);
    } finally {
      rmSync(join(mindsDir, ".."), { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// mindsSourceDir / mindsJsonPath — smoke tests (env override path)
// ---------------------------------------------------------------------------

describe("mindsSourceDir", () => {
  it("uses MINDS_SOURCE_DIR env when set", () => {
    const original = process.env.MINDS_SOURCE_DIR;
    process.env.MINDS_SOURCE_DIR = "/custom/path";
    try {
      expect(mindsSourceDir()).toBe("/custom/path");
    } finally {
      if (original === undefined) delete process.env.MINDS_SOURCE_DIR;
      else process.env.MINDS_SOURCE_DIR = original;
    }
  });
});

describe("mindsJsonPath", () => {
  it("uses MINDS_ROOT env when set", () => {
    const original = process.env.MINDS_ROOT;
    process.env.MINDS_ROOT = "/custom/root";
    try {
      expect(mindsJsonPath()).toBe("/custom/root/minds.json");
    } finally {
      if (original === undefined) delete process.env.MINDS_ROOT;
      else process.env.MINDS_ROOT = original;
    }
  });
});
