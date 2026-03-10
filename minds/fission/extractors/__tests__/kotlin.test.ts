import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { KotlinExtractor } from "../kotlin.js";
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
// Test: Basic import resolution
// ---------------------------------------------------------------------------

describe("KotlinExtractor", () => {
  describe("metadata", () => {
    it("has language = 'kotlin'", () => {
      const extractor = new KotlinExtractor();
      expect(extractor.language).toBe("kotlin");
    });

    it("handles .kt and .kts extensions", () => {
      const extractor = new KotlinExtractor();
      expect(extractor.extensions).toEqual([".kt", ".kts"]);
    });
  });

  describe("basic import resolution", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-basic-"));
      extractor = new KotlinExtractor();

      // build.gradle.kts marker
      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      // Two packages, one imports from the other
      write(
        root,
        "src/main/kotlin/com/example/feature/FeatureService.kt",
        `package com.example.feature

import com.example.utils.Helper

class FeatureService {
    val helper = Helper()
}
`,
      );

      write(
        root,
        "src/main/kotlin/com/example/utils/Helper.kt",
        `package com.example.utils

class Helper {
    fun help() = "helping"
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves fully qualified import to defining file", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/example/feature/FeatureService.kt",
        "src/main/kotlin/com/example/utils/Helper.kt",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });

    it("includes both files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain(
        "src/main/kotlin/com/example/feature/FeatureService.kt",
      );
      expect(graph.nodes).toContain(
        "src/main/kotlin/com/example/utils/Helper.kt",
      );
    });

    it("all nodes are relative paths", async () => {
      const graph = await extractor.extract(root);
      for (const node of graph.nodes) {
        expect(node.startsWith("/")).toBe(false);
      }
    });
  });

  describe("wildcard import", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-wildcard-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/app/Main.kt",
        `package com.app

import com.app.models.*

fun main() {
    val user = User()
    val order = Order()
}
`,
      );

      write(
        root,
        "src/main/kotlin/com/app/models/User.kt",
        `package com.app.models

data class User(val name: String = "")
`,
      );

      write(
        root,
        "src/main/kotlin/com/app/models/Order.kt",
        `package com.app.models

data class Order(val id: Int = 0)
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edges to all files in the wildcard package", async () => {
      const graph = await extractor.extract(root);
      const edgeToUser = edgeBetween(
        graph,
        "src/main/kotlin/com/app/Main.kt",
        "src/main/kotlin/com/app/models/User.kt",
      );
      const edgeToOrder = edgeBetween(
        graph,
        "src/main/kotlin/com/app/Main.kt",
        "src/main/kotlin/com/app/models/Order.kt",
      );
      expect(edgeToUser).toBeDefined();
      expect(edgeToOrder).toBeDefined();
    });

    it("wildcard edges each have weight 1", async () => {
      const graph = await extractor.extract(root);
      const edgeToUser = edgeBetween(
        graph,
        "src/main/kotlin/com/app/Main.kt",
        "src/main/kotlin/com/app/models/User.kt",
      );
      expect(edgeToUser!.weight).toBe(1);
    });
  });

  describe("external import filtering", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-external-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/app/App.kt",
        `package com.app

import kotlin.collections.List
import kotlinx.coroutines.launch
import java.util.Date
import javax.inject.Inject
import org.springframework.stereotype.Service
import com.app.internal.Config

class App {
    fun run() {}
}
`,
      );

      write(
        root,
        "src/main/kotlin/com/app/internal/Config.kt",
        `package com.app.internal

class Config {
    val port = 8080
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("skips kotlin.* imports", async () => {
      const graph = await extractor.extract(root);
      const kotlinEdges = graph.edges.filter(
        (e) => e.to.includes("kotlin"),
      );
      // Only edge should be to internal Config, not kotlin stdlib
      expect(
        kotlinEdges.every((e) =>
          e.to.includes("com/app"),
        ),
      ).toBe(true);
    });

    it("skips kotlinx.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("kotlinx")),
      ).toBe(false);
    });

    it("skips java.* and javax.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("java")),
      ).toBe(false);
    });

    it("skips unresolvable external imports (org.springframework)", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("spring")),
      ).toBe(false);
    });

    it("resolves internal imports correctly", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/app/App.kt",
        "src/main/kotlin/com/app/internal/Config.kt",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("class/interface/object/enum detection", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-declarations-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/types/Declarations.kt",
        `package com.types

class RegularClass
interface MyInterface
object MySingleton
enum class Direction { NORTH, SOUTH }
sealed class Result
data class UserDto(val name: String)
value class Password(val value: String)
annotation class Fancy
`,
      );

      write(
        root,
        "src/main/kotlin/com/consumer/Consumer.kt",
        `package com.consumer

import com.types.RegularClass
import com.types.MyInterface
import com.types.MySingleton
import com.types.Direction
import com.types.Result
import com.types.UserDto
import com.types.Password
import com.types.Fancy

class Consumer
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves import of regular class", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/consumer/Consumer.kt",
        "src/main/kotlin/com/types/Declarations.kt",
      );
      expect(edge).toBeDefined();
    });

    it("resolves import of interface", async () => {
      const graph = await extractor.extract(root);
      // All types are in the same file, so multiple imports -> same target
      const edges = graph.edges.filter(
        (e) =>
          e.from === "src/main/kotlin/com/consumer/Consumer.kt" &&
          e.to === "src/main/kotlin/com/types/Declarations.kt",
      );
      // Should have an edge (could be consolidated or multiple)
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("multiple classes in same file", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-multi-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/multi/Models.kt",
        `package com.multi

class Alpha
class Beta
class Gamma
`,
      );

      write(
        root,
        "src/main/kotlin/com/multi/use/UseAlpha.kt",
        `package com.multi.use

import com.multi.Alpha

class UseAlpha
`,
      );

      write(
        root,
        "src/main/kotlin/com/multi/use/UseBeta.kt",
        `package com.multi.use

import com.multi.Beta

class UseBeta
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves both Alpha and Beta to the same Models.kt file", async () => {
      const graph = await extractor.extract(root);
      const edgeAlpha = edgeBetween(
        graph,
        "src/main/kotlin/com/multi/use/UseAlpha.kt",
        "src/main/kotlin/com/multi/Models.kt",
      );
      const edgeBeta = edgeBetween(
        graph,
        "src/main/kotlin/com/multi/use/UseBeta.kt",
        "src/main/kotlin/com/multi/Models.kt",
      );
      expect(edgeAlpha).toBeDefined();
      expect(edgeBeta).toBeDefined();
    });
  });

  describe("empty project handling", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-empty-"));
      extractor = new KotlinExtractor();
      // No kotlin files at all
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("returns empty graph for project with no Kotlin files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe("build directory exclusion", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-buildexcl-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/app/App.kt",
        `package com.app

class App
`,
      );

      // These should be excluded
      write(
        root,
        "build/classes/kotlin/main/com/app/App.kt",
        `package com.app

class App
`,
      );

      write(
        root,
        ".gradle/caches/SomeFile.kt",
        `package gradle.internal

class SomeFile
`,
      );

      write(
        root,
        ".git/objects/SomeFile.kt",
        `package git.internal

class SomeFile
`,
      );

      write(
        root,
        "node_modules/some/File.kt",
        `package node.internal

class File
`,
      );

      write(
        root,
        "out/production/App.kt",
        `package com.app

class App
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("excludes build/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("build/"))).toBe(false);
    });

    it("excludes .gradle/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.startsWith(".gradle/") || n.includes("/.gradle/"))).toBe(false);
    });

    it("excludes .git/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".git"))).toBe(false);
    });

    it("excludes node_modules/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("node_modules"))).toBe(false);
    });

    it("excludes out/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("out/"))).toBe(false);
    });

    it("includes src/ files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/kotlin/com/app/App.kt");
    });
  });

  describe("multi-level package paths", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-multilevel-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/example/deep/nested/level/DeepClass.kt",
        `package com.example.deep.nested.level

class DeepClass
`,
      );

      write(
        root,
        "src/main/kotlin/com/example/top/TopClass.kt",
        `package com.example.top

import com.example.deep.nested.level.DeepClass

class TopClass {
    val deep = DeepClass()
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves imports across deeply nested packages", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/example/top/TopClass.kt",
        "src/main/kotlin/com/example/deep/nested/level/DeepClass.kt",
      );
      expect(edge).toBeDefined();
    });
  });

  describe(".kts file support", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-kts-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/scripts/Utils.kt",
        `package com.scripts

object Utils {
    fun greet() = "hello"
}
`,
      );

      write(
        root,
        "src/main/kotlin/com/scripts/build.kts",
        `package com.scripts

import com.scripts.Utils

println(Utils.greet())
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("discovers .kts files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/kotlin/com/scripts/build.kts");
    });

    it("resolves imports from .kts files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/scripts/build.kts",
        "src/main/kotlin/com/scripts/Utils.kt",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("package declaration parsing", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-pkg-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      // File without package declaration (default package)
      write(
        root,
        "src/main/kotlin/NoPkg.kt",
        `class NoPkg
`,
      );

      // File with package
      write(
        root,
        "src/main/kotlin/com/pkg/WithPkg.kt",
        `package com.pkg

class WithPkg
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("handles files without package declarations", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/kotlin/NoPkg.kt");
    });

    it("handles files with package declarations", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/kotlin/com/pkg/WithPkg.kt");
    });
  });

  describe("no self-edges", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-selfedge-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      // A file that imports from its own package with wildcard
      write(
        root,
        "src/main/kotlin/com/self/Alpha.kt",
        `package com.self

import com.self.*

class Alpha
`,
      );

      write(
        root,
        "src/main/kotlin/com/self/Beta.kt",
        `package com.self

class Beta
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create self-edges from wildcard imports", async () => {
      const graph = await extractor.extract(root);
      const selfEdges = graph.edges.filter((e) => e.from === e.to);
      expect(selfEdges).toHaveLength(0);
    });

    it("creates edge to other file in same package via wildcard", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/self/Alpha.kt",
        "src/main/kotlin/com/self/Beta.kt",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("no duplicate edges", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-dedup-"));
      extractor = new KotlinExtractor();

      write(root, "build.gradle.kts", "plugins { kotlin(\"jvm\") }");

      write(
        root,
        "src/main/kotlin/com/dup/Models.kt",
        `package com.dup

class Foo
class Bar
`,
      );

      // Imports two classes from the same file
      write(
        root,
        "src/main/kotlin/com/dup/use/Consumer.kt",
        `package com.dup.use

import com.dup.Foo
import com.dup.Bar

class Consumer
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("deduplicates edges from same source to same target", async () => {
      const graph = await extractor.extract(root);
      const edges = graph.edges.filter(
        (e) =>
          e.from === "src/main/kotlin/com/dup/use/Consumer.kt" &&
          e.to === "src/main/kotlin/com/dup/Models.kt",
      );
      expect(edges).toHaveLength(1);
    });

    it("accumulates weight for deduplicated edges", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/kotlin/com/dup/use/Consumer.kt",
        "src/main/kotlin/com/dup/Models.kt",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2);
    });
  });

  describe("flat project layout", () => {
    let root: string;
    let extractor: KotlinExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-kt-flat-"));
      extractor = new KotlinExtractor();

      // No src/main/kotlin structure, just .kt files directly
      write(
        root,
        "Main.kt",
        `package myapp

import myapp.utils.StringUtils

fun main() {
    println(StringUtils.upper("hello"))
}
`,
      );

      write(
        root,
        "utils/StringUtils.kt",
        `package myapp.utils

object StringUtils {
    fun upper(s: String) = s.uppercase()
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("discovers files in flat layout", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Main.kt");
      expect(graph.nodes).toContain("utils/StringUtils.kt");
    });

    it("resolves imports in flat layout", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "Main.kt", "utils/StringUtils.kt");
      expect(edge).toBeDefined();
    });
  });
});
