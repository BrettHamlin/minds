import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GoExtractor } from "../go.js";
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
let extractor: GoExtractor;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fission-go-test-"));
  extractor = new GoExtractor();

  // ── go.mod ──────────────────────────────────────────────────────────
  write(
    root,
    "go.mod",
    `module github.com/user/project

go 1.22
`,
  );

  // ── main.go ─────────────────────────────────────────────────────────
  write(
    root,
    "main.go",
    `package main

import (
	"fmt"
	"github.com/user/project/internal/auth"
	"github.com/user/project/pkg/config"
)

func main() {
	fmt.Println(auth.Verify())
	fmt.Println(config.Load())
}
`,
  );

  // ── cmd/server/server.go ────────────────────────────────────────────
  write(
    root,
    "cmd/server/server.go",
    `package main

import "github.com/user/project/internal/auth"

func main() {
	auth.Verify()
}
`,
  );

  // ── internal/auth/auth.go ──────────────────────────────────────────
  write(
    root,
    "internal/auth/auth.go",
    `package auth

import "github.com/user/project/pkg/config"

func Verify() bool {
	_ = config.Load()
	return true
}
`,
  );

  // ── internal/auth/middleware.go ─────────────────────────────────────
  write(
    root,
    "internal/auth/middleware.go",
    `package auth

func Middleware() {}
`,
  );

  // ── internal/auth/auth_test.go (should be excluded from nodes) ─────
  write(
    root,
    "internal/auth/auth_test.go",
    `package auth_test

import "testing"

func TestVerify(t *testing.T) {}
`,
  );

  // ── pkg/config/config.go ───────────────────────────────────────────
  write(
    root,
    "pkg/config/config.go",
    `package config

func Load() string { return "loaded" }
`,
  );

  // ── pkg/config/defaults.go ─────────────────────────────────────────
  write(
    root,
    "pkg/config/defaults.go",
    `package config

func Defaults() string { return "defaults" }
`,
  );

  // ── pkg/models/user.go — single import of internal package ────────
  write(
    root,
    "pkg/models/user.go",
    `package models

import "github.com/user/project/internal/auth"

type User struct {
	Verified bool
}

func NewUser() User {
	auth.Verify()
	return User{Verified: true}
}
`,
  );

  // ── vendor/ directory (should be excluded) ─────────────────────────
  write(
    root,
    "vendor/github.com/ext/lib/lib.go",
    `package lib

func External() {}
`,
  );

  // ── testdata/ directory (should be excluded) ───────────────────────
  write(
    root,
    "testdata/fixtures/fixture.go",
    `package fixtures

func Fixture() {}
`,
  );

  // ── file with only external/stdlib imports ─────────────────────────
  write(
    root,
    "pkg/util/util.go",
    `package util

import (
	"fmt"
	"strings"
	"github.com/external/dep"
)

func Format(s string) string {
	fmt.Println(s)
	return strings.ToUpper(s)
}
`,
  );

  // ── file with mixed internal and external imports ──────────────────
  write(
    root,
    "internal/handler/handler.go",
    `package handler

import (
	"net/http"
	"github.com/user/project/internal/auth"
	"github.com/user/project/pkg/config"
	"github.com/gin-gonic/gin"
)

func Handle(w http.ResponseWriter) {
	auth.Verify()
	_ = config.Load()
}
`,
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoExtractor", () => {
  describe("metadata", () => {
    it("has language = 'go'", () => {
      expect(extractor.language).toBe("go");
    });

    it("handles .go extension", () => {
      expect(extractor.extensions).toEqual([".go"]);
    });
  });

  describe("module-relative import resolution", () => {
    it("resolves internal/auth import to all .go files in that package", async () => {
      const graph = await extractor.extract(root);
      // main.go imports github.com/user/project/internal/auth
      // → should create edges to auth.go and middleware.go (NOT auth_test.go)
      const edge1 = edgeBetween(graph, "main.go", "internal/auth/auth.go");
      const edge2 = edgeBetween(graph, "main.go", "internal/auth/middleware.go");
      expect(edge1).toBeDefined();
      expect(edge2).toBeDefined();
    });

    it("resolves pkg/config import to config.go and defaults.go", async () => {
      const graph = await extractor.extract(root);
      const edge1 = edgeBetween(graph, "main.go", "pkg/config/config.go");
      const edge2 = edgeBetween(graph, "main.go", "pkg/config/defaults.go");
      expect(edge1).toBeDefined();
      expect(edge2).toBeDefined();
    });
  });

  describe("grouped import block parsing", () => {
    it("parses grouped imports and resolves internal ones", async () => {
      const graph = await extractor.extract(root);
      // main.go has grouped imports with both stdlib and internal
      const authEdge = edgeBetween(graph, "main.go", "internal/auth/auth.go");
      const configEdge = edgeBetween(graph, "main.go", "pkg/config/config.go");
      expect(authEdge).toBeDefined();
      expect(configEdge).toBeDefined();
    });
  });

  describe("single import statement", () => {
    it("resolves a single unparenthesized import", async () => {
      const graph = await extractor.extract(root);
      // cmd/server/server.go has: import "github.com/user/project/internal/auth"
      const edge = edgeBetween(graph, "cmd/server/server.go", "internal/auth/auth.go");
      expect(edge).toBeDefined();
    });
  });

  describe("standard library filtering", () => {
    it("does not create edges for stdlib imports like fmt", async () => {
      const graph = await extractor.extract(root);
      const fmtEdges = graph.edges.filter((e) => e.to.includes("fmt"));
      expect(fmtEdges).toHaveLength(0);
    });

    it("does not create edges for net/http imports", async () => {
      const graph = await extractor.extract(root);
      const httpEdges = graph.edges.filter((e) => e.to.includes("net/http"));
      expect(httpEdges).toHaveLength(0);
    });
  });

  describe("external dependency filtering", () => {
    it("does not create edges for external deps like github.com/gin-gonic/gin", async () => {
      const graph = await extractor.extract(root);
      const ginEdges = graph.edges.filter((e) => e.to.includes("gin"));
      expect(ginEdges).toHaveLength(0);
    });

    it("does not create edges for github.com/external/dep", async () => {
      const graph = await extractor.extract(root);
      const extEdges = graph.edges.filter((e) => e.to.includes("external"));
      expect(extEdges).toHaveLength(0);
    });
  });

  describe("_test.go file exclusion", () => {
    it("does not include _test.go files as nodes", async () => {
      const graph = await extractor.extract(root);
      const testFiles = graph.nodes.filter((n) => n.endsWith("_test.go"));
      expect(testFiles).toHaveLength(0);
    });

    it("does not create edges to _test.go files", async () => {
      const graph = await extractor.extract(root);
      const testEdges = graph.edges.filter((e) => e.to.endsWith("_test.go"));
      expect(testEdges).toHaveLength(0);
    });
  });

  describe("vendor/ directory exclusion", () => {
    it("does not include vendor/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const vendorFiles = graph.nodes.filter((n) => n.startsWith("vendor/"));
      expect(vendorFiles).toHaveLength(0);
    });
  });

  describe("testdata/ directory exclusion", () => {
    it("does not include testdata/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const testdataFiles = graph.nodes.filter((n) => n.startsWith("testdata/"));
      expect(testdataFiles).toHaveLength(0);
    });
  });

  describe(".git/ directory exclusion", () => {
    it("does not include .git/ files as nodes", async () => {
      const graph = await extractor.extract(root);
      const gitFiles = graph.nodes.filter((n) => n.startsWith(".git/") || n.startsWith(".git"));
      expect(gitFiles).toHaveLength(0);
    });
  });

  describe("edge weight", () => {
    it("uses weight 1 for all Go imports", async () => {
      const graph = await extractor.extract(root);
      for (const edge of graph.edges) {
        expect(edge.weight).toBe(1);
      }
    });
  });

  describe("multiple files importing the same package", () => {
    it("creates separate edges from each importer", async () => {
      const graph = await extractor.extract(root);
      // main.go, cmd/server/server.go, pkg/models/user.go, and
      // internal/handler/handler.go all import internal/auth
      const authEdges = graph.edges.filter(
        (e) => e.to === "internal/auth/auth.go",
      );
      expect(authEdges.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("files with only external/stdlib imports", () => {
    it("includes the file as a node but creates no edges from it", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("pkg/util/util.go");
      const utilEdges = graph.edges.filter(
        (e) => e.from === "pkg/util/util.go",
      );
      expect(utilEdges).toHaveLength(0);
    });
  });

  describe("no go.mod handling", () => {
    it("returns empty graph when go.mod is missing", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "fission-go-nomod-"));
      write(emptyDir, "main.go", `package main\nfunc main() {}`);
      const graph = await extractor.extract(emptyDir);
      // Without go.mod, we cannot resolve internal imports
      // The file should still be found but no edges created
      expect(graph.nodes).toContain("main.go");
      expect(graph.edges).toHaveLength(0);
      rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe("empty directory handling", () => {
    it("returns empty graph for directory with no Go files", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "fission-go-empty-"));
      const graph = await extractor.extract(emptyDir);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
      rmSync(emptyDir, { recursive: true, force: true });
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
    it("includes all non-test, non-vendor, non-testdata source files as nodes", async () => {
      const graph = await extractor.extract(root);
      const expected = [
        "main.go",
        "cmd/server/server.go",
        "internal/auth/auth.go",
        "internal/auth/middleware.go",
        "pkg/config/config.go",
        "pkg/config/defaults.go",
        "pkg/models/user.go",
        "pkg/util/util.go",
        "internal/handler/handler.go",
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

  describe("fan-in / fan-out", () => {
    it("internal/auth/auth.go has high fan-in (imported by many)", async () => {
      const graph = await extractor.extract(root);
      const fanIn = graph.edges.filter(
        (e) => e.to === "internal/auth/auth.go",
      ).length;
      // imported by: main.go, cmd/server/server.go, pkg/models/user.go, internal/handler/handler.go
      expect(fanIn).toBeGreaterThanOrEqual(4);
    });

    it("main.go has high fan-out (imports many packages)", async () => {
      const graph = await extractor.extract(root);
      const fanOut = graph.edges.filter(
        (e) => e.from === "main.go",
      ).length;
      // imports: internal/auth (2 files), pkg/config (2 files) = 4 edges
      expect(fanOut).toBeGreaterThanOrEqual(4);
    });
  });
});
