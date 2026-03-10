/**
 * pipeline.test.ts — Integration tests for the Fission pipeline orchestrator.
 *
 * Covers: full pipeline run with synthetic TS files, language detection,
 * empty graph handling, options passthrough, and result structure validation.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runPipeline, detectLanguage } from "../lib/pipeline";
import type { PipelineResult } from "../lib/pipeline";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `fission-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTS(dir: string, name: string, content: string): void {
  const filePath = join(dir, name);
  const fileDir = join(filePath, "..");
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

/* ------------------------------------------------------------------ */
/*  Language detection tests                                           */
/* ------------------------------------------------------------------ */

describe("detectLanguage", () => {
  it("detects typescript from tsconfig.json", () => {
    const dir = makeTempDir("lang-ts");
    writeFileSync(join(dir, "tsconfig.json"), "{}", "utf-8");
    expect(detectLanguage(dir)).toBe("typescript");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects typescript from package.json", () => {
    const dir = makeTempDir("lang-pkg");
    writeFileSync(join(dir, "package.json"), "{}", "utf-8");
    expect(detectLanguage(dir)).toBe("typescript");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects go from go.mod", () => {
    const dir = makeTempDir("lang-go");
    writeFileSync(join(dir, "go.mod"), "module example.com/foo", "utf-8");
    expect(detectLanguage(dir)).toBe("go");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects rust from Cargo.toml", () => {
    const dir = makeTempDir("lang-rust");
    writeFileSync(join(dir, "Cargo.toml"), "[package]", "utf-8");
    expect(detectLanguage(dir)).toBe("rust");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects swift from Package.swift", () => {
    const dir = makeTempDir("lang-swift");
    writeFileSync(join(dir, "Package.swift"), "// swift", "utf-8");
    expect(detectLanguage(dir)).toBe("swift");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects python from pyproject.toml", () => {
    const dir = makeTempDir("lang-py");
    writeFileSync(join(dir, "pyproject.toml"), "[project]", "utf-8");
    expect(detectLanguage(dir)).toBe("python");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects python from setup.py", () => {
    const dir = makeTempDir("lang-py2");
    writeFileSync(join(dir, "setup.py"), "from setuptools import setup", "utf-8");
    expect(detectLanguage(dir)).toBe("python");
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to typescript for unknown projects", () => {
    const dir = makeTempDir("lang-unknown");
    expect(detectLanguage(dir)).toBe("typescript");
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ------------------------------------------------------------------ */
/*  Full pipeline integration tests                                    */
/* ------------------------------------------------------------------ */

describe("runPipeline", () => {
  let testDir: string;

  /**
   * Build a synthetic TypeScript project with known structure:
   *
   * - shared/types.ts — hub file imported by almost everything
   * - shared/utils.ts — hub file imported by almost everything
   * - cluster-a/a1.ts through a5.ts — tightly interconnected group
   * - cluster-b/b1.ts through b5.ts — tightly interconnected group
   * - cluster-c/c1.ts through c5.ts — tightly interconnected group
   * - standalone.ts — imports types only (will be filtered as hub-adjacent)
   *
   * Total: 2 hub files + 15 cluster files + 1 standalone = 18 files
   */
  beforeAll(() => {
    testDir = makeTempDir("pipeline");

    // Hub files (imported by many)
    writeTS(testDir, "shared/types.ts", `export interface User { id: string; name: string; }\nexport interface Config { debug: boolean; }`);
    writeTS(testDir, "shared/utils.ts", `export function log(msg: string) { console.log(msg); }\nexport function format(s: string) { return s.trim(); }`);

    // Cluster A: tightly connected group
    writeTS(testDir, "cluster-a/a1.ts", `import { User } from '../shared/types';\nimport { a2fn } from './a2';\nimport { a3fn } from './a3';\nexport function a1fn(): User { return { id: '1', name: a2fn() + a3fn() }; }`);
    writeTS(testDir, "cluster-a/a2.ts", `import { log } from '../shared/utils';\nimport { a1fn } from './a1';\nimport { a4fn } from './a4';\nexport function a2fn() { log('a2'); return a4fn(); }`);
    writeTS(testDir, "cluster-a/a3.ts", `import { User } from '../shared/types';\nimport { a1fn } from './a1';\nimport { a5fn } from './a5';\nexport function a3fn() { return a5fn(); }`);
    writeTS(testDir, "cluster-a/a4.ts", `import { format } from '../shared/utils';\nimport { a2fn } from './a2';\nimport { a5fn } from './a5';\nexport function a4fn() { return format(a5fn()); }`);
    writeTS(testDir, "cluster-a/a5.ts", `import { log } from '../shared/utils';\nimport { a3fn } from './a3';\nimport { a4fn } from './a4';\nexport function a5fn() { log('a5'); return 'a5'; }`);

    // Cluster B: tightly connected group
    writeTS(testDir, "cluster-b/b1.ts", `import { User } from '../shared/types';\nimport { b2fn } from './b2';\nimport { b3fn } from './b3';\nexport function b1fn(): User { return { id: '2', name: b2fn() + b3fn() }; }`);
    writeTS(testDir, "cluster-b/b2.ts", `import { log } from '../shared/utils';\nimport { b1fn } from './b1';\nimport { b4fn } from './b4';\nexport function b2fn() { log('b2'); return b4fn(); }`);
    writeTS(testDir, "cluster-b/b3.ts", `import { User } from '../shared/types';\nimport { b1fn } from './b1';\nimport { b5fn } from './b5';\nexport function b3fn() { return b5fn(); }`);
    writeTS(testDir, "cluster-b/b4.ts", `import { format } from '../shared/utils';\nimport { b2fn } from './b2';\nimport { b5fn } from './b5';\nexport function b4fn() { return format(b5fn()); }`);
    writeTS(testDir, "cluster-b/b5.ts", `import { log } from '../shared/utils';\nimport { b3fn } from './b3';\nimport { b4fn } from './b4';\nexport function b5fn() { log('b5'); return 'b5'; }`);

    // Cluster C: tightly connected group
    writeTS(testDir, "cluster-c/c1.ts", `import { Config } from '../shared/types';\nimport { c2fn } from './c2';\nimport { c3fn } from './c3';\nexport function c1fn(): Config { return { debug: true }; }`);
    writeTS(testDir, "cluster-c/c2.ts", `import { log } from '../shared/utils';\nimport { c1fn } from './c1';\nimport { c4fn } from './c4';\nexport function c2fn() { log('c2'); return c4fn(); }`);
    writeTS(testDir, "cluster-c/c3.ts", `import { Config } from '../shared/types';\nimport { c1fn } from './c1';\nimport { c5fn } from './c5';\nexport function c3fn() { return c5fn(); }`);
    writeTS(testDir, "cluster-c/c4.ts", `import { format } from '../shared/utils';\nimport { c2fn } from './c2';\nimport { c5fn } from './c5';\nexport function c4fn() { return format(c5fn()); }`);
    writeTS(testDir, "cluster-c/c5.ts", `import { log } from '../shared/utils';\nimport { c3fn } from './c3';\nimport { c4fn } from './c4';\nexport function c5fn() { log('c5'); return 'c5'; }`);

    // Standalone file (only imports hubs)
    writeTS(testDir, "standalone.ts", `import { User } from './shared/types';\nimport { log } from './shared/utils';\nexport const user: User = { id: '0', name: 'standalone' };\nlog('init');`);
  });

  afterAll(() => {
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  it("returns correct graph statistics", async () => {
    const result = await runPipeline(testDir);

    // 18 total files: 2 shared + 15 cluster + 1 standalone
    expect(result.graph.totalNodes).toBe(18);
    expect(result.graph.totalEdges).toBeGreaterThan(0);
    expect(result.graph.density).toBeGreaterThan(0);
    expect(result.graph.density).toBeLessThanOrEqual(1);
  });

  it("detects hub files with high fan-in", async () => {
    // Use low thresholds so the two shared files are detected as hubs
    const result = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
    });

    // shared/types.ts and shared/utils.ts should be in foundation
    const foundationFiles = result.foundation.files;
    expect(foundationFiles).toContain("shared/types.ts");
    expect(foundationFiles).toContain("shared/utils.ts");

    // Foundation metrics should include fan-in/fan-out data
    expect(result.foundation.metrics.length).toBeGreaterThanOrEqual(2);
    for (const m of result.foundation.metrics) {
      expect(m.fanIn).toBeGreaterThan(0);
      expect(typeof m.fanOut).toBe("number");
    }
  });

  it("produces non-empty non-overlapping clusters", async () => {
    const result = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
    });

    expect(result.clusters.length).toBeGreaterThan(0);

    // Collect all files across clusters
    const allClusteredFiles = new Set<string>();
    for (const cluster of result.clusters) {
      expect(cluster.files.length).toBeGreaterThan(0);
      for (const f of cluster.files) {
        // No file should appear in more than one cluster
        expect(allClusteredFiles.has(f)).toBe(false);
        allClusteredFiles.add(f);
      }
    }

    // No hub file should appear in a cluster
    for (const hubFile of result.foundation.files) {
      expect(allClusteredFiles.has(hubFile)).toBe(false);
    }
  });

  it("computes valid modularity score", async () => {
    const result = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
    });

    // Modularity should be a number (can be 0 for degenerate cases,
    // but with 3 clear clusters it should be positive)
    expect(typeof result.modularity).toBe("number");
    // With well-separated clusters, modularity should be positive
    expect(result.modularity).toBeGreaterThanOrEqual(0);
  });

  it("returns valid coupling matrix", async () => {
    const result = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
    });

    // Coupling matrix entries should reference valid cluster IDs
    const validIds = new Set(result.clusters.map((c) => c.clusterId));
    for (const entry of result.couplingMatrix) {
      expect(validIds.has(entry.from)).toBe(true);
      expect(validIds.has(entry.to)).toBe(true);
      expect(entry.edges).toBeGreaterThan(0);
    }
  });

  it("reports Leiden iteration count", async () => {
    const result = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
    });

    expect(result.leidenIterations).toBeGreaterThanOrEqual(0);
  });

  it("cluster structure fields are valid", async () => {
    const result = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
    });

    for (const cluster of result.clusters) {
      expect(typeof cluster.clusterId).toBe("number");
      expect(Array.isArray(cluster.files)).toBe(true);
      expect(typeof cluster.internalEdges).toBe("number");
      expect(typeof cluster.externalEdges).toBe("number");
      expect(typeof cluster.cohesion).toBe("number");
      expect(cluster.cohesion).toBeGreaterThanOrEqual(0);
      expect(cluster.cohesion).toBeLessThanOrEqual(1);
    }
  });

  it("handles options passthrough for resolution", async () => {
    // Higher resolution should tend to produce more clusters
    const lowRes = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
      resolution: 0.5,
    });
    const highRes = await runPipeline(testDir, {
      hubThreshold: 80,
      hubMinFanIn: 3,
      resolution: 3.0,
    });

    // Both should produce valid results
    expect(lowRes.clusters.length).toBeGreaterThan(0);
    expect(highRes.clusters.length).toBeGreaterThan(0);

    // High resolution typically produces more or equal clusters
    expect(highRes.clusters.length).toBeGreaterThanOrEqual(lowRes.clusters.length);
  });

  it("handles empty directory gracefully", async () => {
    const emptyDir = makeTempDir("empty");
    const result = await runPipeline(emptyDir);

    expect(result.graph.totalNodes).toBe(0);
    expect(result.graph.totalEdges).toBe(0);
    expect(result.graph.density).toBe(0);
    expect(result.foundation.files).toEqual([]);
    expect(result.foundation.metrics).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.modularity).toBe(0);
    expect(result.couplingMatrix).toEqual([]);
    expect(result.leidenIterations).toBe(0);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("handles directory with no imports (isolated files)", async () => {
    const isolatedDir = makeTempDir("isolated");
    writeTS(isolatedDir, "a.ts", "export const a = 1;");
    writeTS(isolatedDir, "b.ts", "export const b = 2;");
    writeTS(isolatedDir, "c.ts", "export const c = 3;");

    const result = await runPipeline(isolatedDir);

    expect(result.graph.totalNodes).toBe(3);
    expect(result.graph.totalEdges).toBe(0);
    expect(result.graph.density).toBe(0);
    expect(result.foundation.files).toEqual([]);
    expect(result.modularity).toBe(0);

    rmSync(isolatedDir, { recursive: true, force: true });
  });

  it("uses auto-detected language when not specified", async () => {
    // Our test dir has .ts files, so language should auto-detect
    const result = await runPipeline(testDir);
    // Should succeed without specifying language
    expect(result.graph.totalNodes).toBeGreaterThan(0);
  });
});
