/**
 * Tests for contract memory system:
 * - ContractPattern type shape
 * - writeContractPattern() — write + index sync
 * - searchMemory({ scope: "contracts" }) — BM25 search over contract patterns
 * - syncContractIndex() — indexes JSON files into FTS5 table
 * - Cold-start case: no patterns yet → search returns empty, write creates first
 */

import { describe, test, expect, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";

import type { ContractPattern } from "./contract-types";
import { writeContractPattern } from "./contract-store";
import { syncContractIndex } from "./index";
import { contractDataDir, contractIndexPath } from "./paths";
import { searchMemory } from "./search";
import { provisionContractDir } from "./provision";

// ─── Test fixture helpers ─────────────────────────────────────────────────────

/** A deterministic test timestamp far in the future to avoid collisions. */
const TEST_EPOCH = new Date("2099-06-15T12:00:00.000Z").getTime();

function makePattern(overrides: Partial<ContractPattern> = {}): ContractPattern {
  return {
    sourcePhase: "clarify",
    targetPhase: "plan",
    artifactShape:
      "Spec document describing feature requirements with Summary, Acceptance Criteria, and Tech Stack.",
    sections: [
      { name: "Summary", required: true, description: "One-paragraph feature overview." },
      { name: "Acceptance Criteria", required: true, description: "Testable conditions for done." },
      { name: "Tech Stack", required: false, description: "Libraries and frameworks in scope." },
    ],
    metadata: { domain: "pipeline", version: "1.0" },
    timestamp: new Date(TEST_EPOCH).toISOString(),
    ...overrides,
  };
}

/** Collect all test-created JSON files so we can clean them up. */
const createdFiles: string[] = [];

/** Remove all test artifacts after each test. */
function cleanupTestFiles(): void {
  // Remove tracked files
  for (const f of createdFiles) {
    if (existsSync(f)) rmSync(f);
  }
  createdFiles.length = 0;

  // Remove the contract index (rebuilt each sync)
  const dbPath = contractIndexPath();
  if (existsSync(dbPath)) rmSync(dbPath);
}

afterEach(() => {
  cleanupTestFiles();
});

afterAll(() => {
  cleanupTestFiles();
});

// ─── ContractPattern type ─────────────────────────────────────────────────────

describe("ContractPattern type", () => {
  test("has required fields: sourcePhase, targetPhase, artifactShape, sections, metadata, timestamp", () => {
    const pattern: ContractPattern = makePattern();
    expect(pattern.sourcePhase).toBeTypeOf("string");
    expect(pattern.targetPhase).toBeTypeOf("string");
    expect(pattern.artifactShape).toBeTypeOf("string");
    expect(Array.isArray(pattern.sections)).toBe(true);
    expect(typeof pattern.metadata).toBe("object");
    expect(pattern.timestamp).toBeTypeOf("string");
  });

  test("sections have name, required, description fields", () => {
    const pattern = makePattern();
    for (const section of pattern.sections) {
      expect(section.name).toBeTypeOf("string");
      expect(section.required).toBeTypeOf("boolean");
      expect(section.description).toBeTypeOf("string");
    }
  });

  test("timestamp is a valid ISO 8601 string", () => {
    const pattern = makePattern();
    const parsed = new Date(pattern.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  test("metadata is a Record<string, string>", () => {
    const pattern = makePattern({ metadata: { domain: "test", version: "2" } });
    expect(pattern.metadata.domain).toBe("test");
    expect(pattern.metadata.version).toBe("2");
  });
});

// ─── writeContractPattern ─────────────────────────────────────────────────────

describe("writeContractPattern", () => {
  test("creates a JSON file in the contract data directory", async () => {
    const pattern = makePattern();
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toMatch(/\.json$/);
  });

  test("written file contains valid JSON matching the pattern", async () => {
    const pattern = makePattern();
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    const raw = await Bun.file(filePath).text();
    const parsed = JSON.parse(raw) as ContractPattern;

    expect(parsed.sourcePhase).toBe(pattern.sourcePhase);
    expect(parsed.targetPhase).toBe(pattern.targetPhase);
    expect(parsed.artifactShape).toBe(pattern.artifactShape);
    expect(parsed.timestamp).toBe(pattern.timestamp);
    expect(parsed.sections).toHaveLength(pattern.sections.length);
    expect(parsed.metadata.domain).toBe("pipeline");
  });

  test("filename encodes sourcePhase and targetPhase", async () => {
    const pattern = makePattern({ sourcePhase: "spec_api", targetPhase: "execution" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    const name = filePath.split("/").at(-1)!;
    expect(name).toContain("spec_api");
    expect(name).toContain("execution");
  });

  test("file is placed inside contractDataDir()", async () => {
    const pattern = makePattern();
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    expect(filePath.startsWith(contractDataDir())).toBe(true);
  });

  test("syncs the contract index (index file exists after write)", async () => {
    const pattern = makePattern();
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    expect(existsSync(contractIndexPath())).toBe(true);
  });

  test("written pattern is immediately searchable via searchMemory", async () => {
    const pattern = makePattern({
      artifactShape: "Unique spec shape with zephyracceptancesection3842",
    });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    const results = await searchMemory("_ignored_", "zephyracceptancesection3842", {
      scope: "contracts",
      provider: null, // BM25 only — no embedding provider needed
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("zephyracceptancesection3842");
  });

  test("two patterns with different phases produce separate files", async () => {
    const p1 = makePattern({ sourcePhase: "clarify", targetPhase: "plan", timestamp: new Date(TEST_EPOCH + 100).toISOString() });
    const p2 = makePattern({ sourcePhase: "plan", targetPhase: "execution", timestamp: new Date(TEST_EPOCH + 200).toISOString() });

    const f1 = await writeContractPattern(p1);
    const f2 = await writeContractPattern(p2);
    createdFiles.push(f1, f2);

    expect(f1).not.toBe(f2);
    expect(existsSync(f1)).toBe(true);
    expect(existsSync(f2)).toBe(true);
  });

  test("special characters in phase names are sanitized in filename", async () => {
    const pattern = makePattern({ sourcePhase: "mind:with/slashes", targetPhase: "target.phase" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    const name = filePath.split("/").at(-1)!;
    // Should not contain raw slashes or colons in the filename segment
    expect(name).not.toContain("/");
    expect(name).not.toContain(":");
  });
});

// ─── syncContractIndex ────────────────────────────────────────────────────────

describe("syncContractIndex", () => {
  test("creates the contract index file", async () => {
    await provisionContractDir();
    await syncContractIndex();

    expect(existsSync(contractIndexPath())).toBe(true);
  });

  test("creates chunks and chunks_fts tables", async () => {
    await provisionContractDir();
    await syncContractIndex();

    const db = new Database(contractIndexPath(), { readonly: true });
    try {
      const tables = db
        .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      expect(tables).toContain("chunks");
      expect(tables).toContain("chunks_fts");
    } finally {
      db.close();
    }
  });

  test("indexes existing JSON files into the FTS5 table", async () => {
    const pattern = makePattern({ artifactShape: "handoff-shape-unique-xyz-987" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    // Re-sync to ensure the file is indexed
    await syncContractIndex();

    const db = new Database(contractIndexPath(), { readonly: true });
    try {
      const count = db.query("SELECT COUNT(*) as n FROM chunks").get() as { n: number };
      expect(count.n).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  test("idempotent — syncing twice does not duplicate chunks", async () => {
    const pattern = makePattern();
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    await syncContractIndex();

    const db1 = new Database(contractIndexPath(), { readonly: true });
    const count1 = (db1.query("SELECT COUNT(*) as n FROM chunks").get() as { n: number }).n;
    db1.close();

    await syncContractIndex();

    const db2 = new Database(contractIndexPath(), { readonly: true });
    const count2 = (db2.query("SELECT COUNT(*) as n FROM chunks").get() as { n: number }).n;
    db2.close();

    expect(count1).toBe(count2);
  });
});

// ─── searchMemory({ scope: "contracts" }) ─────────────────────────────────────

describe('searchMemory({ scope: "contracts" })', () => {
  test("returns results scoped to contract patterns (ignores mindName)", async () => {
    const pattern = makePattern({ artifactShape: "contractscopetesttoken9971" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    // mindName is irrelevant when scope is "contracts"
    const results = await searchMemory("any_mind_name_here", "contractscopetesttoken9971", {
      scope: "contracts",
      provider: null,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("contractscopetesttoken9971");
  });

  test("result has path, startLine, endLine, content, score fields", async () => {
    const pattern = makePattern({ artifactShape: "structuredresultfieldcheck5512" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    const results = await searchMemory("_", "structuredresultfieldcheck5512", {
      scope: "contracts",
      provider: null,
    });

    if (results.length > 0) {
      const r = results[0];
      expect(r.path).toBeTypeOf("string");
      expect(r.startLine).toBeTypeOf("number");
      expect(r.endLine).toBeTypeOf("number");
      expect(r.content).toBeTypeOf("string");
      expect(r.score).toBeTypeOf("number");
    }
  });

  test("result path points into contractDataDir()", async () => {
    const pattern = makePattern({ artifactShape: "pathoriginchecktoken7743" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    const results = await searchMemory("_", "pathoriginchecktoken7743", {
      scope: "contracts",
      provider: null,
    });

    if (results.length > 0) {
      expect(results[0].path.startsWith(contractDataDir())).toBe(true);
    }
  });

  test("default scope (no scope option) still searches mind memory, not contracts", async () => {
    // Write a contract pattern with unique term (no hyphens — FTS5 treats them as NOT)
    const pattern = makePattern({ artifactShape: "mindvscontractscopetoken1122" });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    // Search in mind scope (default) — should NOT find the contract pattern
    // because the memory/memory dir doesn't contain contract JSON files
    const results = await searchMemory("memory", "mindvscontractscopetoken1122", {
      provider: null,
      // no scope → defaults to "mind"
    });

    // The contract pattern should not appear in mind-scoped search
    for (const r of results) {
      expect(r.path.startsWith(contractDataDir())).toBe(false);
    }
  });
});

// ─── Cold-start case (T008) ───────────────────────────────────────────────────

describe("cold-start case", () => {
  test("searchMemory({ scope: 'contracts' }) returns empty when no patterns exist", async () => {
    // Simulate a cold start: ensure the index does not exist from a previous write,
    // but the directory may exist (from provisionContractDir). We remove the index
    // so syncContractIndex runs fresh with no JSON files.
    const dbPath = contractIndexPath();
    if (existsSync(dbPath)) rmSync(dbPath);

    // Provision the directory (creates it if missing) but don't write any patterns
    await provisionContractDir();

    // Remove any JSON files left from other tests to simulate true cold start
    const dir = contractDataDir();
    const jsonFiles = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of jsonFiles) {
      // Only remove files that look like test patterns (epoch >= TEST_EPOCH)
      if (f.includes("2099")) {
        const full = join(dir, f);
        if (existsSync(full)) rmSync(full);
      }
    }
    // Remove index so it gets rebuilt fresh
    if (existsSync(dbPath)) rmSync(dbPath);

    const results = await searchMemory("_", "any query at all", {
      scope: "contracts",
      provider: null,
    });

    expect(results).toHaveLength(0);
  });

  test("writeContractPattern creates the first pattern from cold start", async () => {
    // Clean slate: remove index
    const dbPath = contractIndexPath();
    if (existsSync(dbPath)) rmSync(dbPath);

    // Write the very first pattern
    const pattern = makePattern({
      artifactShape: "firsteverpatterncoldstartcheck8841",
      timestamp: new Date(TEST_EPOCH + 5000).toISOString(),
    });
    const filePath = await writeContractPattern(pattern);
    createdFiles.push(filePath);

    // Should now exist on disk
    expect(existsSync(filePath)).toBe(true);

    // Should be searchable
    const results = await searchMemory("_", "firsteverpatterncoldstartcheck8841", {
      scope: "contracts",
      provider: null,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("firsteverpatterncoldstartcheck8841");
  });

  test("searchMemory returns empty before any write — search does not throw", async () => {
    // Remove index to simulate pre-first-write state
    const dbPath = contractIndexPath();
    if (existsSync(dbPath)) rmSync(dbPath);

    // Remove test-created json files
    const dir = contractDataDir();
    if (existsSync(dir)) {
      const jsonFiles = readdirSync(dir).filter((f) => f.endsWith(".json") && f.includes("2099"));
      for (const f of jsonFiles) {
        const full = join(dir, f);
        if (existsSync(full)) rmSync(full);
      }
    }
    // Remove index again after potential sync
    if (existsSync(dbPath)) rmSync(dbPath);

    let results: Awaited<ReturnType<typeof searchMemory>>;
    let threw = false;
    try {
      results = await searchMemory("_", "no patterns yet", {
        scope: "contracts",
        provider: null,
      });
    } catch {
      threw = true;
      results = [];
    }

    expect(threw).toBe(false);
    expect(results!).toHaveLength(0);
  });
});

// ─── provisionContractDir ─────────────────────────────────────────────────────

describe("provisionContractDir", () => {
  test("creates the contract data directory if it doesn't exist", async () => {
    const dir = await provisionContractDir();
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(contractDataDir());
  });

  test("creates README.md in the contract data directory", async () => {
    await provisionContractDir();
    const readmePath = join(contractDataDir(), "README.md");
    expect(existsSync(readmePath)).toBe(true);
  });

  test("idempotent — calling twice does not throw", async () => {
    await provisionContractDir();
    await provisionContractDir(); // second call should be a no-op, not throw
  });

  test("README.md documents JSON storage format", async () => {
    await provisionContractDir();
    const readmePath = join(contractDataDir(), "README.md");
    const content = await Bun.file(readmePath).text();
    expect(content).toContain("ContractPattern");
    expect(content).toContain("JSON");
  });
});
