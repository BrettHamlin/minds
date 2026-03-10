import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TypeScriptExtractor } from "../typescript.js";
import type { DependencyGraph, GraphEdge } from "../../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function write(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

function edgeBetween(
  graph: DependencyGraph,
  from: string,
  to: string,
): GraphEdge | undefined {
  return graph.edges.find((e) => e.from === from && e.to === to);
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let root: string;
let extractor: TypeScriptExtractor;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fission-ts-test-"));
  extractor = new TypeScriptExtractor();

  // ── src/index.ts ────────────────────────────────────────────────────
  write(
    root,
    "src/index.ts",
    `
import { greet } from "./utils/greet.js";
import { Config } from "./config.js";
import { helper, transform } from "./lib/helpers.js";
import "react";
`,
  );

  // ── src/utils/greet.ts ──────────────────────────────────────────────
  write(
    root,
    "src/utils/greet.ts",
    `
export function greet(name: string) { return "Hello " + name; }
`,
  );

  // ── src/config.ts ───────────────────────────────────────────────────
  write(
    root,
    "src/config.ts",
    `
export interface Config { port: number; }
`,
  );

  // ── src/lib/helpers.ts ──────────────────────────────────────────────
  write(
    root,
    "src/lib/helpers.ts",
    `
export function helper() {}
export function transform() {}
`,
  );

  // ── src/lib/index.ts (barrel) ───────────────────────────────────────
  write(
    root,
    "src/lib/index.ts",
    `
export { helper, transform } from "./helpers.js";
`,
  );

  // ── src/app.tsx ─────────────────────────────────────────────────────
  write(
    root,
    "src/app.tsx",
    `
import { greet } from "./utils/greet";
import { Config } from "./config";
const lib = require("./lib");
import React from "react";
`,
  );

  // ── src/dynamic.ts ──────────────────────────────────────────────────
  write(
    root,
    "src/dynamic.ts",
    `
const mod = await import("./config.js");
export { mod };
`,
  );

  // ── src/reexport.ts ─────────────────────────────────────────────────
  write(
    root,
    "src/reexport.ts",
    `
export { greet } from "./utils/greet.js";
export { Config } from "./config.js";
`,
  );

  // ── node_modules/react/index.js (should be excluded) ───────────────
  write(root, "node_modules/react/index.js", `module.exports = {};`);

  // ── dist/bundle.js (should be excluded) ─────────────────────────────
  write(root, "dist/bundle.js", `console.log("bundle");`);

  // ── .hidden/secret.ts (should be excluded) ──────────────────────────
  write(root, ".hidden/secret.ts", `export const x = 1;`);

  // ── tsconfig.json with path aliases ─────────────────────────────────
  write(
    root,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@utils/*": ["src/utils/*"],
            "@lib/*": ["src/lib/*"],
            "@config": ["src/config.ts"],
          },
        },
      },
      null,
      2,
    ),
  );

  // ── src/aliased.ts (uses path aliases) ──────────────────────────────
  write(
    root,
    "src/aliased.ts",
    `
import { greet } from "@utils/greet";
import { helper } from "@lib/helpers";
import { Config } from "@config";
`,
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TypeScriptExtractor", () => {
  describe("metadata", () => {
    it("has language = 'typescript'", () => {
      expect(extractor.language).toBe("typescript");
    });

    it("handles .ts, .tsx, .js, .jsx extensions", () => {
      expect(extractor.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
    });
  });

  describe("relative import resolution", () => {
    it("resolves ./utils/greet.js to src/utils/greet.ts (NodeNext)", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/index.ts", "src/utils/greet.ts");
      expect(edge).toBeDefined();
    });

    it("resolves ./config.js to src/config.ts", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/index.ts", "src/config.ts");
      expect(edge).toBeDefined();
    });

    it("resolves ./lib/helpers.js to src/lib/helpers.ts", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/index.ts", "src/lib/helpers.ts");
      expect(edge).toBeDefined();
    });
  });

  describe("NodeNext .js extension resolution", () => {
    it("maps .js import to .ts file on disk", async () => {
      const graph = await extractor.extract(root);
      // src/index.ts imports from "./utils/greet.js" → should resolve to greet.ts
      const edge = edgeBetween(graph, "src/index.ts", "src/utils/greet.ts");
      expect(edge).toBeDefined();
    });
  });

  describe("barrel export (index.ts) resolution", () => {
    it("resolves require('./lib') to src/lib/index.ts", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/app.tsx", "src/lib/index.ts");
      expect(edge).toBeDefined();
    });
  });

  describe("external module skipping", () => {
    it("does not include 'react' as a node", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).not.toContain("react");
      expect(graph.edges.some((e) => e.to === "react")).toBe(false);
    });

    it("does not create edges for bare specifiers", async () => {
      const graph = await extractor.extract(root);
      const reactEdges = graph.edges.filter(
        (e) => e.to.includes("react") || e.to.includes("node_modules"),
      );
      expect(reactEdges).toHaveLength(0);
    });
  });

  describe("excluded directories", () => {
    it("does not include node_modules files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("node_modules"))).toBe(false);
    });

    it("does not include dist files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("dist/"))).toBe(false);
    });

    it("does not include dot-prefixed directories", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.startsWith("."))).toBe(false);
    });
  });

  describe("edge weights (named import counts)", () => {
    it("weights a single named import as 1", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/index.ts", "src/config.ts");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });

    it("weights two named imports as 2", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/index.ts", "src/lib/helpers.ts");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2);
    });

    it("weights side-effect imports as 1", async () => {
      const graph = await extractor.extract(root);
      // "import 'react'" is a side-effect import but skipped (external)
      // require('./lib') is unknown count → weight 1
      const edge = edgeBetween(graph, "src/app.tsx", "src/lib/index.ts");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });
  });

  describe("dynamic import()", () => {
    it("resolves dynamic import to the target file", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/dynamic.ts", "src/config.ts");
      expect(edge).toBeDefined();
    });
  });

  describe("re-export statements", () => {
    it("creates edges for export ... from statements", async () => {
      const graph = await extractor.extract(root);
      const edge1 = edgeBetween(
        graph,
        "src/reexport.ts",
        "src/utils/greet.ts",
      );
      const edge2 = edgeBetween(graph, "src/reexport.ts", "src/config.ts");
      expect(edge1).toBeDefined();
      expect(edge2).toBeDefined();
    });

    it("weights re-exports by named symbol count", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/reexport.ts",
        "src/utils/greet.ts",
      );
      expect(edge!.weight).toBe(1);
    });
  });

  describe("tsconfig path alias resolution", () => {
    it("resolves @utils/* alias to src/utils/*", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/aliased.ts", "src/utils/greet.ts");
      expect(edge).toBeDefined();
    });

    it("resolves @lib/* alias to src/lib/*", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/aliased.ts",
        "src/lib/helpers.ts",
      );
      expect(edge).toBeDefined();
    });

    it("resolves exact @config alias to src/config.ts", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/aliased.ts", "src/config.ts");
      expect(edge).toBeDefined();
    });
  });

  describe("fan-in / fan-out", () => {
    it("config.ts has high fan-in (imported by many)", async () => {
      const graph = await extractor.extract(root);
      const fanIn = graph.edges.filter(
        (e) => e.to === "src/config.ts",
      ).length;
      // imported by: index.ts, app.tsx, dynamic.ts, reexport.ts, aliased.ts
      expect(fanIn).toBeGreaterThanOrEqual(4);
    });

    it("index.ts has high fan-out (imports many)", async () => {
      const graph = await extractor.extract(root);
      const fanOut = graph.edges.filter(
        (e) => e.from === "src/index.ts",
      ).length;
      // imports: greet.ts, config.ts, helpers.ts
      expect(fanOut).toBeGreaterThanOrEqual(3);
    });
  });

  describe("all nodes are relative paths", () => {
    it("no node contains an absolute path", async () => {
      const graph = await extractor.extract(root);
      for (const node of graph.nodes) {
        expect(node.startsWith("/")).toBe(false);
      }
    });

    it("all edge from/to are relative", async () => {
      const graph = await extractor.extract(root);
      for (const edge of graph.edges) {
        expect(edge.from.startsWith("/")).toBe(false);
        expect(edge.to.startsWith("/")).toBe(false);
      }
    });
  });

  describe("complete graph structure", () => {
    it("includes all source files as nodes", async () => {
      const graph = await extractor.extract(root);
      const expected = [
        "src/index.ts",
        "src/utils/greet.ts",
        "src/config.ts",
        "src/lib/helpers.ts",
        "src/lib/index.ts",
        "src/app.tsx",
        "src/dynamic.ts",
        "src/reexport.ts",
        "src/aliased.ts",
      ];
      for (const f of expected) {
        expect(graph.nodes).toContain(f);
      }
    });

    it("does not contain duplicate nodes", async () => {
      const graph = await extractor.extract(root);
      const unique = new Set(graph.nodes);
      expect(unique.size).toBe(graph.nodes.length);
    });

    it("does not contain duplicate edges", async () => {
      const graph = await extractor.extract(root);
      const keys = graph.edges.map((e) => `${e.from}->${e.to}`);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });
  });
});
