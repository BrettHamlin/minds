import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { JavaExtractor } from "../java.js";
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
// Tests
// ---------------------------------------------------------------------------

describe("JavaExtractor", () => {
  describe("metadata", () => {
    it("has language = 'java'", () => {
      const extractor = new JavaExtractor();
      expect(extractor.language).toBe("java");
    });

    it("handles .java extension", () => {
      const extractor = new JavaExtractor();
      expect(extractor.extensions).toEqual([".java"]);
    });
  });

  describe("basic import resolution", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-basic-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/example/feature/FeatureService.java",
        `package com.example.feature;

import com.example.utils.Helper;

public class FeatureService {
    private Helper helper = new Helper();
}
`,
      );

      write(
        root,
        "src/main/java/com/example/utils/Helper.java",
        `package com.example.utils;

public class Helper {
    public String help() { return "helping"; }
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
        "src/main/java/com/example/feature/FeatureService.java",
        "src/main/java/com/example/utils/Helper.java",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });

    it("includes both files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain(
        "src/main/java/com/example/feature/FeatureService.java",
      );
      expect(graph.nodes).toContain(
        "src/main/java/com/example/utils/Helper.java",
      );
    });

    it("all nodes are relative paths", async () => {
      const graph = await extractor.extract(root);
      for (const node of graph.nodes) {
        expect(node.startsWith("/")).toBe(false);
      }
    });
  });

  describe("wildcard imports", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-wildcard-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/app/Main.java",
        `package com.app;

import com.app.models.*;

public class Main {
    public static void main(String[] args) {
        User user = new User();
        Order order = new Order();
    }
}
`,
      );

      write(
        root,
        "src/main/java/com/app/models/User.java",
        `package com.app.models;

public class User {
    private String name = "";
}
`,
      );

      write(
        root,
        "src/main/java/com/app/models/Order.java",
        `package com.app.models;

public class Order {
    private int id = 0;
}
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
        "src/main/java/com/app/Main.java",
        "src/main/java/com/app/models/User.java",
      );
      const edgeToOrder = edgeBetween(
        graph,
        "src/main/java/com/app/Main.java",
        "src/main/java/com/app/models/Order.java",
      );
      expect(edgeToUser).toBeDefined();
      expect(edgeToOrder).toBeDefined();
    });

    it("wildcard edges each have weight 1", async () => {
      const graph = await extractor.extract(root);
      const edgeToUser = edgeBetween(
        graph,
        "src/main/java/com/app/Main.java",
        "src/main/java/com/app/models/User.java",
      );
      expect(edgeToUser!.weight).toBe(1);
    });
  });

  describe("static import resolution", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-static-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/app/Constants.java",
        `package com.app;

public class Constants {
    public static final int MAX_SIZE = 100;
    public static final String APP_NAME = "MyApp";
}
`,
      );

      write(
        root,
        "src/main/java/com/app/service/AppService.java",
        `package com.app.service;

import static com.app.Constants.MAX_SIZE;
import static com.app.Constants.APP_NAME;

public class AppService {
    public int getMax() { return MAX_SIZE; }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves static imports to the defining class file", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/java/com/app/service/AppService.java",
        "src/main/java/com/app/Constants.java",
      );
      expect(edge).toBeDefined();
    });

    it("accumulates weight for multiple static imports from same file", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/java/com/app/service/AppService.java",
        "src/main/java/com/app/Constants.java",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2);
    });
  });

  describe("package declaration parsing", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-pkg-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      // File without package (default package)
      write(
        root,
        "src/main/java/NoPkg.java",
        `public class NoPkg {
}
`,
      );

      // File with package
      write(
        root,
        "src/main/java/com/pkg/WithPkg.java",
        `package com.pkg;

public class WithPkg {
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("handles files without package declarations", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/java/NoPkg.java");
    });

    it("handles files with package declarations", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/java/com/pkg/WithPkg.java");
    });
  });

  describe("external import filtering", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-external-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/app/App.java",
        `package com.app;

import java.util.List;
import java.util.Map;
import javax.inject.Inject;
import sun.misc.Unsafe;
import com.sun.net.httpserver.HttpServer;
import org.springframework.stereotype.Service;
import com.app.internal.Config;

public class App {
    public void run() {}
}
`,
      );

      write(
        root,
        "src/main/java/com/app/internal/Config.java",
        `package com.app.internal;

public class Config {
    public int port = 8080;
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("skips java.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("java.util")),
      ).toBe(false);
    });

    it("skips javax.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("javax")),
      ).toBe(false);
    });

    it("skips sun.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("sun")),
      ).toBe(false);
    });

    it("skips com.sun.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.edges.some((e) => e.to.includes("com.sun")),
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
        "src/main/java/com/app/App.java",
        "src/main/java/com/app/internal/Config.java",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("class, interface, enum, record, @interface detection", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-declarations-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/types/Declarations.java",
        `package com.types;

public class RegularClass {}
interface MyInterface {}
enum Direction { NORTH, SOUTH }
record UserDto(String name) {}
@interface Fancy {}
`,
      );

      write(
        root,
        "src/main/java/com/consumer/Consumer.java",
        `package com.consumer;

import com.types.RegularClass;
import com.types.MyInterface;
import com.types.Direction;
import com.types.UserDto;
import com.types.Fancy;

public class Consumer {}
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
        "src/main/java/com/consumer/Consumer.java",
        "src/main/java/com/types/Declarations.java",
      );
      expect(edge).toBeDefined();
    });

    it("resolves imports of all declaration types to same file", async () => {
      const graph = await extractor.extract(root);
      const edges = graph.edges.filter(
        (e) =>
          e.from === "src/main/java/com/consumer/Consumer.java" &&
          e.to === "src/main/java/com/types/Declarations.java",
      );
      expect(edges.length).toBe(1);
      // 5 imports all to same file, consolidated to weight 5
      expect(edges[0].weight).toBe(5);
    });
  });

  describe("abstract, final, sealed class modifiers", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-modifiers-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/mod/AbstractBase.java",
        `package com.mod;

public abstract class AbstractBase {
    public abstract void doWork();
}
`,
      );

      write(
        root,
        "src/main/java/com/mod/FinalHelper.java",
        `package com.mod;

public final class FinalHelper {
    public static void help() {}
}
`,
      );

      write(
        root,
        "src/main/java/com/mod/SealedShape.java",
        `package com.mod;

public sealed class SealedShape permits Circle, Square {
}
`,
      );

      write(
        root,
        "src/main/java/com/user/UserCode.java",
        `package com.user;

import com.mod.AbstractBase;
import com.mod.FinalHelper;
import com.mod.SealedShape;

public class UserCode extends AbstractBase {
    public void doWork() { FinalHelper.help(); }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves import of abstract class", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/java/com/user/UserCode.java",
        "src/main/java/com/mod/AbstractBase.java",
      );
      expect(edge).toBeDefined();
    });

    it("resolves import of final class", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/java/com/user/UserCode.java",
        "src/main/java/com/mod/FinalHelper.java",
      );
      expect(edge).toBeDefined();
    });

    it("resolves import of sealed class", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/java/com/user/UserCode.java",
        "src/main/java/com/mod/SealedShape.java",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("empty project handling", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-empty-"));
      extractor = new JavaExtractor();
      // No Java files at all
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("returns empty graph for project with no Java files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe("build and target directory exclusion", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-buildexcl-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/app/App.java",
        `package com.app;

public class App {}
`,
      );

      // These should all be excluded
      write(
        root,
        "build/classes/com/app/App.java",
        `package com.app;

public class App {}
`,
      );

      write(
        root,
        "target/classes/com/app/App.java",
        `package com.app;

public class App {}
`,
      );

      write(
        root,
        ".gradle/caches/SomeFile.java",
        `package gradle.internal;

public class SomeFile {}
`,
      );

      write(
        root,
        ".git/objects/SomeFile.java",
        `package git.internal;

public class SomeFile {}
`,
      );

      write(
        root,
        "node_modules/some/File.java",
        `package node.internal;

public class File {}
`,
      );

      write(
        root,
        "out/production/App.java",
        `package com.app;

public class App {}
`,
      );

      write(
        root,
        "bin/App.java",
        `package com.app;

public class App {}
`,
      );

      write(
        root,
        ".idea/misc.java",
        `package idea.internal;

public class Misc {}
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

    it("excludes target/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("target/"))).toBe(false);
    });

    it("excludes .gradle/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(
        graph.nodes.some((n) => n.startsWith(".gradle/") || n.includes("/.gradle/")),
      ).toBe(false);
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

    it("excludes bin/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("bin/"))).toBe(false);
    });

    it("excludes .idea/ directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".idea"))).toBe(false);
    });

    it("includes src/ files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main/java/com/app/App.java");
    });
  });

  describe("multiple classes in same file", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-multi-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/multi/Models.java",
        `package com.multi;

public class Alpha {}
class Beta {}
class Gamma {}
`,
      );

      write(
        root,
        "src/main/java/com/multi/use/UseAlpha.java",
        `package com.multi.use;

import com.multi.Alpha;

public class UseAlpha {}
`,
      );

      write(
        root,
        "src/main/java/com/multi/use/UseBeta.java",
        `package com.multi.use;

import com.multi.Beta;

public class UseBeta {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves both Alpha and Beta to the same Models.java file", async () => {
      const graph = await extractor.extract(root);
      const edgeAlpha = edgeBetween(
        graph,
        "src/main/java/com/multi/use/UseAlpha.java",
        "src/main/java/com/multi/Models.java",
      );
      const edgeBeta = edgeBetween(
        graph,
        "src/main/java/com/multi/use/UseBeta.java",
        "src/main/java/com/multi/Models.java",
      );
      expect(edgeAlpha).toBeDefined();
      expect(edgeBeta).toBeDefined();
    });
  });

  describe("self-edge prevention for wildcards", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-selfedge-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      // A file that imports from its own package with wildcard
      write(
        root,
        "src/main/java/com/self/Alpha.java",
        `package com.self;

import com.self.*;

public class Alpha {}
`,
      );

      write(
        root,
        "src/main/java/com/self/Beta.java",
        `package com.self;

public class Beta {}
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
        "src/main/java/com/self/Alpha.java",
        "src/main/java/com/self/Beta.java",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("no duplicate edges", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-dedup-"));
      extractor = new JavaExtractor();

      write(root, "pom.xml", "<project></project>");

      write(
        root,
        "src/main/java/com/dup/Models.java",
        `package com.dup;

public class Foo {}
class Bar {}
`,
      );

      // Imports two classes from the same file
      write(
        root,
        "src/main/java/com/dup/use/Consumer.java",
        `package com.dup.use;

import com.dup.Foo;
import com.dup.Bar;

public class Consumer {}
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
          e.from === "src/main/java/com/dup/use/Consumer.java" &&
          e.to === "src/main/java/com/dup/Models.java",
      );
      expect(edges).toHaveLength(1);
    });

    it("accumulates weight for deduplicated edges", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "src/main/java/com/dup/use/Consumer.java",
        "src/main/java/com/dup/Models.java",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2);
    });
  });

  describe("flat project layout", () => {
    let root: string;
    let extractor: JavaExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-java-flat-"));
      extractor = new JavaExtractor();

      // No src/main/java structure, just .java files directly
      write(
        root,
        "Main.java",
        `package myapp;

import myapp.utils.StringUtils;

public class Main {
    public static void main(String[] args) {
        System.out.println(StringUtils.upper("hello"));
    }
}
`,
      );

      write(
        root,
        "utils/StringUtils.java",
        `package myapp.utils;

public class StringUtils {
    public static String upper(String s) { return s.toUpperCase(); }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("discovers files in flat layout", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Main.java");
      expect(graph.nodes).toContain("utils/StringUtils.java");
    });

    it("resolves imports in flat layout", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "Main.java", "utils/StringUtils.java");
      expect(edge).toBeDefined();
    });
  });
});
