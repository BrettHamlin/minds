import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CppExtractor } from "../cpp.js";
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
let extractor: CppExtractor;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fission-cpp-test-"));
  extractor = new CppExtractor();

  // ── src/main.cpp ──────────────────────────────────────────────────
  write(
    root,
    "src/main.cpp",
    `#include "app.h"
#include "utils/helper.h"
#include <iostream>
#include <vector>

int main() {
  App app;
  app.run();
  return 0;
}
`,
  );

  // ── src/app.h ─────────────────────────────────────────────────────
  write(
    root,
    "src/app.h",
    `#pragma once

#include "config.h"

class App {
public:
  void run();
};
`,
  );

  // ── src/app.cpp ───────────────────────────────────────────────────
  write(
    root,
    "src/app.cpp",
    `#include "app.h"
#include "utils/helper.h"
#include <string>

void App::run() {
  Helper h;
  h.help();
}
`,
  );

  // ── src/config.h ──────────────────────────────────────────────────
  write(
    root,
    "src/config.h",
    `#ifndef CONFIG_H
#define CONFIG_H

struct Config {
  int port;
  const char* host;
};

#endif
`,
  );

  // ── src/utils/helper.h ────────────────────────────────────────────
  write(
    root,
    "src/utils/helper.h",
    `#pragma once

class Helper {
public:
  void help();
};
`,
  );

  // ── src/utils/helper.cpp ──────────────────────────────────────────
  write(
    root,
    "src/utils/helper.cpp",
    `#include "helper.h"
#include <cstdlib>

void Helper::help() {}
`,
  );

  // ── include/public_api.h ──────────────────────────────────────────
  write(
    root,
    "include/public_api.h",
    `#pragma once

void publicFunction();
`,
  );

  // ── src/api.cpp — includes from include/ directory ────────────────
  write(
    root,
    "src/api.cpp",
    `#include "public_api.h"
#include "app.h"

void publicFunction() {
  App app;
  app.run();
}
`,
  );

  // ── src/legacy.cc — .cc extension ─────────────────────────────────
  write(
    root,
    "src/legacy.cc",
    `#include "config.h"

void legacyInit() {}
`,
  );

  // ── src/compat.cxx — .cxx extension ───────────────────────────────
  write(
    root,
    "src/compat.cxx",
    `#include "config.h"

void compatInit() {}
`,
  );

  // ── src/types.hpp — .hpp extension ────────────────────────────────
  write(
    root,
    "src/types.hpp",
    `#pragma once

struct Point {
  double x, y;
};
`,
  );

  // ── src/math.hxx — .hxx extension ────────────────────────────────
  write(
    root,
    "src/math.hxx",
    `#pragma once

double add(double a, double b);
`,
  );

  // ── src/geometry.cpp — includes .hpp and .hxx files ───────────────
  write(
    root,
    "src/geometry.cpp",
    `#include "types.hpp"
#include "math.hxx"

double distance(Point a, Point b) {
  return add(a.x - b.x, a.y - b.y);
}
`,
  );

  // ── build/ directory (should be excluded) ─────────────────────────
  write(
    root,
    "build/generated.cpp",
    `#include "config.h"
void generated() {}
`,
  );

  // ── cmake-build-debug/ directory (should be excluded) ─────────────
  write(
    root,
    "cmake-build-debug/output.cpp",
    `#include "config.h"
void output() {}
`,
  );

  // ── third_party/ directory (should be excluded) ───────────────────
  write(
    root,
    "third_party/lib/external.h",
    `void externalFunc();
`,
  );

  // ── vendor/ directory (should be excluded) ────────────────────────
  write(
    root,
    "vendor/vendored.cpp",
    `void vendored() {}
`,
  );

  // ── external/ directory (should be excluded) ──────────────────────
  write(
    root,
    "external/ext.cpp",
    `void ext() {}
`,
  );

  // ── deps/ directory (should be excluded) ──────────────────────────
  write(
    root,
    "deps/dep.cpp",
    `void dep() {}
`,
  );

  // ── src/commented.cpp — includes inside comments (should be skipped)
  write(
    root,
    "src/commented.cpp",
    `// #include "nonexistent.h"
/* #include "also_nonexistent.h" */
/*
 * #include "multiline_comment.h"
 */
#include "config.h"

void commented() {}
`,
  );

  // ── src/only_system.cpp — only system includes, no project edges ──
  write(
    root,
    "src/only_system.cpp",
    `#include <iostream>
#include <vector>
#include <string>

void onlySystem() {}
`,
  );

  // ── src/subdir_include.cpp — includes with subdirectory paths ─────
  write(
    root,
    "src/subdir_include.cpp",
    `#include "utils/helper.h"

void subInclude() {
  Helper h;
}
`,
  );

  // ── src/unresolvable.cpp — includes that don't match any file ─────
  write(
    root,
    "src/unresolvable.cpp",
    `#include "does_not_exist.h"
#include "also_missing.hpp"

void unresolvable() {}
`,
  );

  // ── CMakeLists.txt (for detection test) ───────────────────────────
  write(root, "CMakeLists.txt", `cmake_minimum_required(VERSION 3.20)\n`);

  // ── plain C file ──────────────────────────────────────────────────
  write(
    root,
    "src/pure_c.c",
    `#include "config.h"

void pureC() {}
`,
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CppExtractor", () => {
  describe("metadata", () => {
    it("has language = 'cpp'", () => {
      expect(extractor.language).toBe("cpp");
    });

    it("handles all C++ extensions", () => {
      expect(extractor.extensions).toEqual([
        ".cpp",
        ".cc",
        ".cxx",
        ".c",
        ".h",
        ".hpp",
        ".hxx",
      ]);
    });
  });

  describe("basic #include resolution", () => {
    it("resolves #include \"file.h\" relative to includer", async () => {
      const graph = await extractor.extract(root);
      // src/main.cpp includes "app.h" → resolves to src/app.h
      const edge = edgeBetween(graph, "src/main.cpp", "src/app.h");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });

    it("resolves #include \"subdir/file.h\" relative to includer", async () => {
      const graph = await extractor.extract(root);
      // src/main.cpp includes "utils/helper.h" → resolves to src/utils/helper.h
      const edge = edgeBetween(graph, "src/main.cpp", "src/utils/helper.h");
      expect(edge).toBeDefined();
    });

    it("resolves header-to-header includes", async () => {
      const graph = await extractor.extract(root);
      // src/app.h includes "config.h" → resolves to src/config.h
      const edge = edgeBetween(graph, "src/app.h", "src/config.h");
      expect(edge).toBeDefined();
    });
  });

  describe("system include filtering", () => {
    it("does not create edges for <iostream>", async () => {
      const graph = await extractor.extract(root);
      const ioEdges = graph.edges.filter((e) => e.to.includes("iostream"));
      expect(ioEdges).toHaveLength(0);
    });

    it("does not create edges for <vector>", async () => {
      const graph = await extractor.extract(root);
      const vecEdges = graph.edges.filter((e) => e.to.includes("vector"));
      expect(vecEdges).toHaveLength(0);
    });

    it("does not create edges for <string>", async () => {
      const graph = await extractor.extract(root);
      const strEdges = graph.edges.filter((e) => e.to.includes("string"));
      expect(strEdges).toHaveLength(0);
    });
  });

  describe("include resolution from project root", () => {
    it("resolves includes from include/ directory when relative fails", async () => {
      const graph = await extractor.extract(root);
      // src/api.cpp includes "public_api.h" — not in src/, but in include/
      const edge = edgeBetween(graph, "src/api.cpp", "include/public_api.h");
      expect(edge).toBeDefined();
    });

    it("resolves includes from src/ directory as fallback", async () => {
      const graph = await extractor.extract(root);
      // src/subdir_include.cpp includes "utils/helper.h" relative to src/
      const edge = edgeBetween(
        graph,
        "src/subdir_include.cpp",
        "src/utils/helper.h",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("header-source pairing", () => {
    it("creates edge from .cpp to its .h via include", async () => {
      const graph = await extractor.extract(root);
      // src/app.cpp includes "app.h" → src/app.h
      const edge = edgeBetween(graph, "src/app.cpp", "src/app.h");
      expect(edge).toBeDefined();
    });

    it("creates edge from helper.cpp to helper.h", async () => {
      const graph = await extractor.extract(root);
      // src/utils/helper.cpp includes "helper.h" → src/utils/helper.h
      const edge = edgeBetween(
        graph,
        "src/utils/helper.cpp",
        "src/utils/helper.h",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("multiple include paths", () => {
    it("resolves from include/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("include/public_api.h");
    });

    it("resolves from src/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/config.h");
    });
  });

  describe("various extensions", () => {
    it("includes .cc files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/legacy.cc");
    });

    it("includes .cxx files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/compat.cxx");
    });

    it("includes .hpp files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/types.hpp");
    });

    it("includes .hxx files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/math.hxx");
    });

    it("includes .c files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/pure_c.c");
    });

    it("resolves includes to .hpp files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/geometry.cpp", "src/types.hpp");
      expect(edge).toBeDefined();
    });

    it("resolves includes to .hxx files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/geometry.cpp", "src/math.hxx");
      expect(edge).toBeDefined();
    });

    it("resolves includes from .cc files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/legacy.cc", "src/config.h");
      expect(edge).toBeDefined();
    });

    it("resolves includes from .cxx files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/compat.cxx", "src/config.h");
      expect(edge).toBeDefined();
    });

    it("resolves includes from .c files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/pure_c.c", "src/config.h");
      expect(edge).toBeDefined();
    });
  });

  describe("excluded directories", () => {
    it("does not include build/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const buildFiles = graph.nodes.filter((n) => n.startsWith("build/"));
      expect(buildFiles).toHaveLength(0);
    });

    it("does not include cmake-build-*/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const cmakeFiles = graph.nodes.filter((n) =>
        n.startsWith("cmake-build-"),
      );
      expect(cmakeFiles).toHaveLength(0);
    });

    it("does not include third_party/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const tpFiles = graph.nodes.filter((n) => n.startsWith("third_party/"));
      expect(tpFiles).toHaveLength(0);
    });

    it("does not include vendor/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const vendorFiles = graph.nodes.filter((n) => n.startsWith("vendor/"));
      expect(vendorFiles).toHaveLength(0);
    });

    it("does not include external/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const extFiles = graph.nodes.filter((n) => n.startsWith("external/"));
      expect(extFiles).toHaveLength(0);
    });

    it("does not include deps/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const depsFiles = graph.nodes.filter((n) => n.startsWith("deps/"));
      expect(depsFiles).toHaveLength(0);
    });

    it("does not include .git/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const gitFiles = graph.nodes.filter(
        (n) => n.startsWith(".git/") || n.startsWith(".git"),
      );
      expect(gitFiles).toHaveLength(0);
    });
  });

  describe("comment handling", () => {
    it("does not create edges for includes inside // comments", async () => {
      const graph = await extractor.extract(root);
      // src/commented.cpp has // #include "nonexistent.h" — should be skipped
      const badEdge = graph.edges.find(
        (e) =>
          e.from === "src/commented.cpp" && e.to.includes("nonexistent"),
      );
      expect(badEdge).toBeUndefined();
    });

    it("does not create edges for includes inside /* */ comments", async () => {
      const graph = await extractor.extract(root);
      const badEdge = graph.edges.find(
        (e) =>
          e.from === "src/commented.cpp" &&
          e.to.includes("also_nonexistent"),
      );
      expect(badEdge).toBeUndefined();
    });

    it("does not create edges for includes inside multiline comments", async () => {
      const graph = await extractor.extract(root);
      const badEdge = graph.edges.find(
        (e) =>
          e.from === "src/commented.cpp" &&
          e.to.includes("multiline_comment"),
      );
      expect(badEdge).toBeUndefined();
    });

    it("still resolves non-commented includes in the same file", async () => {
      const graph = await extractor.extract(root);
      // src/commented.cpp has a real #include "config.h"
      const edge = edgeBetween(graph, "src/commented.cpp", "src/config.h");
      expect(edge).toBeDefined();
    });
  });

  describe("include guards and pragma once", () => {
    it("does not affect parsing — files with #pragma once still generate edges", async () => {
      const graph = await extractor.extract(root);
      // src/app.h has #pragma once and #include "config.h"
      const edge = edgeBetween(graph, "src/app.h", "src/config.h");
      expect(edge).toBeDefined();
    });

    it("does not affect parsing — files with #ifndef guards still generate edges", async () => {
      const graph = await extractor.extract(root);
      // src/config.h has #ifndef guard but no includes — should still be a node
      expect(graph.nodes).toContain("src/config.h");
    });
  });

  describe("unresolvable includes", () => {
    it("skips includes that cannot be resolved to any file", async () => {
      const graph = await extractor.extract(root);
      // src/unresolvable.cpp includes "does_not_exist.h" — should create no edge
      const edges = graph.edges.filter(
        (e) => e.from === "src/unresolvable.cpp",
      );
      expect(edges).toHaveLength(0);
    });
  });

  describe("files with only system includes", () => {
    it("includes the file as a node but creates no edges", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/only_system.cpp");
      const edges = graph.edges.filter(
        (e) => e.from === "src/only_system.cpp",
      );
      expect(edges).toHaveLength(0);
    });
  });

  describe("empty project handling", () => {
    it("returns empty graph for directory with no C++ files", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "fission-cpp-empty-"));
      const graph = await extractor.extract(emptyDir);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
      rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe("edge weight", () => {
    it("uses weight 1 for all C++ includes", async () => {
      const graph = await extractor.extract(root);
      for (const edge of graph.edges) {
        expect(edge.weight).toBe(1);
      }
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

  describe("no duplicate nodes or edges", () => {
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

  describe("fan-in / fan-out", () => {
    it("config.h has high fan-in (included by many files)", async () => {
      const graph = await extractor.extract(root);
      const fanIn = graph.edges.filter(
        (e) => e.to === "src/config.h",
      ).length;
      // included by: app.h, legacy.cc, compat.cxx, commented.cpp, pure_c.c
      expect(fanIn).toBeGreaterThanOrEqual(5);
    });

    it("main.cpp has multiple outgoing edges", async () => {
      const graph = await extractor.extract(root);
      const fanOut = graph.edges.filter(
        (e) => e.from === "src/main.cpp",
      ).length;
      // includes: app.h, utils/helper.h
      expect(fanOut).toBeGreaterThanOrEqual(2);
    });
  });
});
