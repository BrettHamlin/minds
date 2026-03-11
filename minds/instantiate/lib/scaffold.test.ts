/**
 * scaffold.test.ts — Unit tests for the @instantiate Mind scaffold logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scaffoldMind,
  scaffoldFromTasks,
  validateMindName,
  generateMindMd,
  generateServerTs,
  mindsSourceDir,
  mindsJsonPath,
} from "./scaffold.js";
import type { MindDescription } from "@minds/mind.js";
import { validateMindDescription } from "@minds/mind.js";
import type { MindTaskGroup } from "@minds/cli/lib/implement-types.js";

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

// ---------------------------------------------------------------------------
// T017: MindDescription source field validation
// ---------------------------------------------------------------------------

describe("MindDescription source field", () => {
  const baseMind: MindDescription = {
    name: "test",
    domain: "test domain",
    keywords: ["test"],
    owns_files: ["src/test/"],
    capabilities: ["do-thing"],
  };

  it("validates MindDescription with source: task-scaffolded", () => {
    expect(validateMindDescription({ ...baseMind, source: "task-scaffolded" })).toBe(true);
  });

  it("validates MindDescription with source: fission", () => {
    expect(validateMindDescription({ ...baseMind, source: "fission" })).toBe(true);
  });

  it("validates MindDescription with source: manual", () => {
    expect(validateMindDescription({ ...baseMind, source: "manual" })).toBe(true);
  });

  it("validates MindDescription without source (backward compat)", () => {
    expect(validateMindDescription(baseMind)).toBe(true);
  });

  it("rejects MindDescription with invalid source value", () => {
    expect(validateMindDescription({ ...baseMind, source: "unknown" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T019: skipIfExists option on scaffoldMind
// ---------------------------------------------------------------------------

describe("scaffoldMind skipIfExists", () => {
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

  it("returns early without error when skipIfExists is true and dir exists", async () => {
    mkdirSync(join(srcDir, "my-mind"), { recursive: true });
    const result = await scaffoldMind("my-mind", "domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
      skipIfExists: true,
    });
    expect(result.registered).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.mindDir).toBe(join(srcDir, "my-mind"));
    expect(result.mindsJson).toBe(jsonPath);
  });

  it("still throws when skipIfExists is not set and dir exists", async () => {
    mkdirSync(join(srcDir, "my-mind"), { recursive: true });
    await expect(
      scaffoldMind("my-mind", "domain", {
        mindsSrcDir: srcDir,
        mindsJsonOverride: jsonPath,
      })
    ).rejects.toThrow("already exists");
  });

  it("still throws when skipIfExists is false and dir exists", async () => {
    mkdirSync(join(srcDir, "my-mind"), { recursive: true });
    await expect(
      scaffoldMind("my-mind", "domain", {
        mindsSrcDir: srcDir,
        mindsJsonOverride: jsonPath,
        skipIfExists: false,
      })
    ).rejects.toThrow("already exists");
  });

  it("sets source field on minds.json entry when provided", async () => {
    await scaffoldMind("my-mind", "domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
      source: "task-scaffolded",
    });
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(entries[0].source).toBe("task-scaffolded");
  });

  it("omits source field from minds.json when not provided", async () => {
    await scaffoldMind("my-mind", "domain", {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(entries[0].source).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T018: scaffoldFromTasks
// ---------------------------------------------------------------------------

describe("scaffoldFromTasks", () => {
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

  function makeGroup(mind: string, ownsFiles?: string[]): MindTaskGroup {
    return {
      mind,
      tasks: [{ id: "T001", mind, description: "Do thing", parallel: false }],
      dependencies: [],
      ownsFiles,
    };
  }

  const existingMind: MindDescription = {
    name: "existing-mind",
    domain: "existing domain",
    keywords: ["existing"],
    owns_files: ["src/existing/"],
    capabilities: [],
  };

  it("scaffolds unregistered minds with owns: annotation", async () => {
    const groups = [
      makeGroup("new-api", ["src/api/**"]),
      makeGroup("new-models", ["src/models/**"]),
    ];
    const results = await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    expect(results).toHaveLength(2);
    expect(existsSync(join(srcDir, "new-api"))).toBe(true);
    expect(existsSync(join(srcDir, "new-models"))).toBe(true);

    // Verify minds.json entries have correct owns_files and source
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    const apiEntry = entries.find((e: MindDescription) => e.name === "new-api");
    const modelsEntry = entries.find((e: MindDescription) => e.name === "new-models");
    expect(apiEntry.owns_files).toEqual(["src/api/**"]);
    expect(apiEntry.source).toBe("task-scaffolded");
    expect(modelsEntry.owns_files).toEqual(["src/models/**"]);
    expect(modelsEntry.source).toBe("task-scaffolded");
  });

  it("does NOT re-scaffold a registered mind", async () => {
    const groups = [makeGroup("existing-mind", ["src/existing/**"])];
    const results = await scaffoldFromTasks(groups, [existingMind], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    expect(results).toHaveLength(0);
    expect(existsSync(join(srcDir, "existing-mind"))).toBe(false);
  });

  it("does NOT scaffold a mind without owns: annotation", async () => {
    const groups = [makeGroup("no-owns-mind")];
    const results = await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    expect(results).toHaveLength(0);
    expect(existsSync(join(srcDir, "no-owns-mind"))).toBe(false);
  });

  it("does NOT scaffold when ownsFiles is empty array", async () => {
    const groups = [makeGroup("empty-owns", [])];
    const results = await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    expect(results).toHaveLength(0);
  });

  it("is idempotent — running twice produces no errors", async () => {
    const groups = [makeGroup("new-api", ["src/api/**"])];

    // First run
    await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // Second run — directory already exists, should skip without error
    const results = await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // Second call returns results but with registered: false (skipped)
    expect(results).toHaveLength(1);
    expect(results[0].registered).toBe(false);
  });

  it("mixes registered and unregistered minds correctly", async () => {
    const groups = [
      makeGroup("existing-mind", ["src/existing/**"]),
      makeGroup("new-api", ["src/api/**"]),
      makeGroup("no-owns-mind"),
    ];
    const results = await scaffoldFromTasks(groups, [existingMind], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // Only new-api should be scaffolded
    expect(results).toHaveLength(1);
    expect(results[0].mindDir).toBe(join(srcDir, "new-api"));
    expect(existsSync(join(srcDir, "new-api"))).toBe(true);
    expect(existsSync(join(srcDir, "existing-mind"))).toBe(false);
    expect(existsSync(join(srcDir, "no-owns-mind"))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // T021: Additional edge cases
  // ---------------------------------------------------------------------------

  it("returns empty array for empty groups", async () => {
    const results = await scaffoldFromTasks([], [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });
    expect(results).toHaveLength(0);
    // minds.json should not be created
    expect(existsSync(jsonPath)).toBe(false);
  });

  it("handles duplicate mind names in groups — scaffolds only once", async () => {
    const groups = [
      makeGroup("new-api", ["src/api/**"]),
      makeGroup("new-api", ["src/api/**"]),
    ];
    const results = await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // First call scaffolds, second hits skipIfExists
    expect(results).toHaveLength(2);
    expect(results[0].registered).toBe(true);
    expect(results[1].registered).toBe(false);

    // Only one entry in minds.json (second scaffold skipped registration)
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    const apiEntries = entries.filter((e: MindDescription) => e.name === "new-api");
    expect(apiEntries).toHaveLength(1);
  });

  it("idempotent re-run does not duplicate minds.json entries", async () => {
    const groups = [makeGroup("new-api", ["src/api/**"])];

    await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // Second run — mind dir exists, should skip
    await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    // minds.json should still have exactly one entry
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("new-api");
  });

  it("preserves multiple owns_files globs on scaffolded mind", async () => {
    const groups = [makeGroup("new-api", ["src/api/**", "src/routes/**", "src/middleware/**"])];
    const results = await scaffoldFromTasks(groups, [], {
      mindsSrcDir: srcDir,
      mindsJsonOverride: jsonPath,
    });

    expect(results).toHaveLength(1);
    const entries = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(entries[0].owns_files).toEqual(["src/api/**", "src/routes/**", "src/middleware/**"]);
  });
});
