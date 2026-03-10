import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SwiftExtractor } from "../swift.js";
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
// Test suite: Basic type reference detection
// ---------------------------------------------------------------------------

describe("SwiftExtractor", () => {
  describe("metadata", () => {
    it("has language = 'swift'", () => {
      const extractor = new SwiftExtractor();
      expect(extractor.language).toBe("swift");
    });

    it("handles .swift extension", () => {
      const extractor = new SwiftExtractor();
      expect(extractor.extensions).toEqual([".swift"]);
    });
  });

  describe("basic type reference detection", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-basic-"));
      extractor = new SwiftExtractor();

      // Package.swift to confirm this is a Swift project
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      // Sources/App/Models/User.swift — declares User class
      write(
        root,
        "Sources/App/Models/User.swift",
        `
public class User {
    let name: String
    let email: String
}
`,
      );

      // Sources/App/Services/UserService.swift — references User
      write(
        root,
        "Sources/App/Services/UserService.swift",
        `
class UserService {
    func getUser() -> User {
        return User()
    }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects class declaration in one file referenced in another", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/App/Services/UserService.swift",
        "Sources/App/Models/User.swift",
      );
      expect(edge).toBeDefined();
    });

    it("creates edge with weight based on reference count", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/App/Services/UserService.swift",
        "Sources/App/Models/User.swift",
      );
      expect(edge).toBeDefined();
      // User is referenced twice: return type and constructor call
      expect(edge!.weight).toBeGreaterThanOrEqual(1);
    });

    it("includes all swift files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Sources/App/Models/User.swift");
      expect(graph.nodes).toContain(
        "Sources/App/Services/UserService.swift",
      );
    });

    it("uses relative paths for all nodes", async () => {
      const graph = await extractor.extract(root);
      for (const node of graph.nodes) {
        expect(node.startsWith("/")).toBe(false);
      }
    });
  });

  describe("self-reference exclusion", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-self-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      // File that declares AND uses a type — should NOT create a self-edge
      write(
        root,
        "Sources/Models.swift",
        `
class MyModel {
    func copy() -> MyModel {
        return MyModel()
    }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create self-edges for types used in the same file", async () => {
      const graph = await extractor.extract(root);
      const selfEdge = edgeBetween(
        graph,
        "Sources/Models.swift",
        "Sources/Models.swift",
      );
      expect(selfEdge).toBeUndefined();
    });
  });

  describe("common type filtering", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-common-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      // File A declares a type called "String" (unlikely but tests filtering)
      // File B uses String, Int, Bool — these should not create edges
      write(
        root,
        "Sources/TypeA.swift",
        `
class CustomType {
    let value: Int
}
`,
      );

      write(
        root,
        "Sources/TypeB.swift",
        `
func process() {
    let name: String = ""
    let count: Int = 0
    let flag: Bool = true
    let data: Data = Data()
    let url: URL = URL(string: "")!
    let date: Date = Date()
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create edges for common Swift/Foundation types", async () => {
      const graph = await extractor.extract(root);
      // TypeB uses String, Int, Bool, Data, URL, Date — none should create edges
      // since those are filtered out as common types
      const edges = graph.edges.filter(
        (e) => e.from === "Sources/TypeB.swift",
      );
      expect(edges).toHaveLength(0);
    });
  });

  describe("struct, enum, protocol, actor detection", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-types-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(
        root,
        "Sources/Declarations.swift",
        `
struct Config {
    let apiKey: String
}

enum Status {
    case active
    case inactive
}

protocol Fetchable {
    func fetch() async throws
}

actor DataStore {
    var items: [String] = []
}
`,
      );

      write(
        root,
        "Sources/Consumer.swift",
        `
class Service: Fetchable {
    let config: Config
    var status: Status
    let store: DataStore

    func fetch() async throws {
        // uses Config, Status, DataStore
    }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects struct references across files", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Consumer.swift",
        "Sources/Declarations.swift",
      );
      expect(edge).toBeDefined();
    });

    it("weights edge by number of distinct types referenced", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Consumer.swift",
        "Sources/Declarations.swift",
      );
      expect(edge).toBeDefined();
      // References Config, Status, Fetchable, DataStore = 4 distinct types
      expect(edge!.weight).toBe(4);
    });
  });

  describe("access modifier handling", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-access-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(
        root,
        "Sources/PublicTypes.swift",
        `
public class PublicModel {
    let id: Int
}

open class OpenBase {
    func doWork() {}
}

internal struct InternalConfig {
    let key: String
}

private struct PrivateHelper {
    let value: Int
}

public final class FinalService {
    func serve() {}
}
`,
      );

      write(
        root,
        "Sources/Uses.swift",
        `
class Consumer {
    let model: PublicModel
    let base: OpenBase
    let config: InternalConfig
    let helper: PrivateHelper
    let service: FinalService
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects public class declarations", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Uses.swift",
        "Sources/PublicTypes.swift",
      );
      expect(edge).toBeDefined();
    });

    it("detects all access-modified types in weight", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Uses.swift",
        "Sources/PublicTypes.swift",
      );
      expect(edge).toBeDefined();
      // PublicModel, OpenBase, InternalConfig, PrivateHelper, FinalService = 5
      expect(edge!.weight).toBe(5);
    });
  });

  describe("multiple types in same file", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-multi-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(
        root,
        "Sources/Models.swift",
        `
class Alpha {}
struct Beta {}
enum Gamma { case a }
`,
      );

      // References only 2 of the 3 types
      write(
        root,
        "Sources/Partial.swift",
        `
func work() {
    let a = Alpha()
    let g: Gamma = .a
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edge with weight = number of distinct types referenced", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Partial.swift",
        "Sources/Models.swift",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2); // Alpha, Gamma — not Beta
    });
  });

  describe("file with no type declarations", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-noDecl-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(
        root,
        "Sources/Types.swift",
        `
class Widget {}
`,
      );

      // File with only functions, no type declarations — still a node
      write(
        root,
        "Sources/Helpers.swift",
        `
func createWidget() -> Widget {
    return Widget()
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("includes files without type declarations as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Sources/Helpers.swift");
    });

    it("files without declarations can still have outgoing edges", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Helpers.swift",
        "Sources/Types.swift",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("directory exclusion", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-exclude-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(root, "Sources/App.swift", `class App {}`);
      write(root, ".build/debug/App.swift", `class BuiltApp {}`);
      write(root, "Pods/SomePod/Pod.swift", `class PodClass {}`);
      write(
        root,
        "Carthage/Checkouts/Lib/Lib.swift",
        `class LibClass {}`,
      );
      write(
        root,
        "DerivedData/Build/App.swift",
        `class DerivedApp {}`,
      );
      write(root, ".git/hooks/pre-commit.swift", `class Hook {}`);
      write(
        root,
        "node_modules/swift-tools/Tool.swift",
        `class Tool {}`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("excludes .build directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".build"))).toBe(false);
    });

    it("excludes Pods directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("Pods"))).toBe(false);
    });

    it("excludes Carthage directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("Carthage"))).toBe(false);
    });

    it("excludes DerivedData directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("DerivedData"))).toBe(
        false,
      );
    });

    it("excludes .git directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".git"))).toBe(false);
    });

    it("excludes node_modules directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("node_modules"))).toBe(
        false,
      );
    });

    it("includes Sources directory files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Sources/App.swift");
    });
  });

  describe("test file exclusion", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-tests-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(root, "Sources/Model.swift", `class Model {}`);
      write(
        root,
        "Tests/ModelTests.swift",
        `class ModelTests: XCTestCase {}`,
      );
      write(
        root,
        "Tests/ModelSpec.swift",
        `class ModelSpec {}`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("excludes Tests directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("Tests/"))).toBe(false);
    });

    it("includes Sources files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Sources/Model.swift");
    });
  });

  describe("empty directory handling", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-empty-"));
      extractor = new SwiftExtractor();
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("returns empty graph for directory with no swift files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe("SPM project detection — Sources focus", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-spm-"));
      extractor = new SwiftExtractor();

      write(
        root,
        "Package.swift",
        `
// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "MyApp")
`,
      );

      write(root, "Sources/MyApp/App.swift", `class App {}`);
      write(
        root,
        "Sources/MyApp/Router.swift",
        `
class Router {
    let app: App
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("finds files under Sources/", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Sources/MyApp/App.swift");
      expect(graph.nodes).toContain("Sources/MyApp/Router.swift");
    });

    it("creates edges between files under Sources/", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/MyApp/Router.swift",
        "Sources/MyApp/App.swift",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("edge deduplication and weight aggregation", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-dedup-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(
        root,
        "Sources/Models.swift",
        `
class Foo {}
class Bar {}
class Baz {}
`,
      );

      write(
        root,
        "Sources/Consumer.swift",
        `
func test() {
    let f = Foo()
    let b = Bar()
    let z = Baz()
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates a single edge per file pair", async () => {
      const graph = await extractor.extract(root);
      const edges = graph.edges.filter(
        (e) =>
          e.from === "Sources/Consumer.swift" &&
          e.to === "Sources/Models.swift",
      );
      expect(edges).toHaveLength(1);
    });

    it("weight equals number of distinct types referenced", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Consumer.swift",
        "Sources/Models.swift",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(3); // Foo, Bar, Baz
    });
  });

  describe("no duplicate nodes", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-nodup-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);
      write(root, "Sources/A.swift", `class A {}`);
      write(root, "Sources/B.swift", `let a = A()`);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not contain duplicate nodes", async () => {
      const graph = await extractor.extract(root);
      const unique = new Set(graph.nodes);
      expect(unique.size).toBe(graph.nodes.length);
    });

    it("all edge from/to are relative paths", async () => {
      const graph = await extractor.extract(root);
      for (const edge of graph.edges) {
        expect(edge.from.startsWith("/")).toBe(false);
        expect(edge.to.startsWith("/")).toBe(false);
      }
    });
  });

  describe("import statement handling", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-import-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      // Files with external module imports — should be ignored
      write(
        root,
        "Sources/App.swift",
        `
import Foundation
import UIKit
import SwiftUI

class AppController {
    func start() {}
}
`,
      );

      write(
        root,
        "Sources/Service.swift",
        `
import Combine

class Service {
    let controller: AppController
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("ignores external module imports but still detects type references", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Sources/Service.swift",
        "Sources/App.swift",
      );
      expect(edge).toBeDefined();
    });

    it("does not create edges for external module names", async () => {
      const graph = await extractor.extract(root);
      // No edges should reference Foundation, UIKit, SwiftUI, Combine
      for (const edge of graph.edges) {
        expect(edge.to).not.toContain("Foundation");
        expect(edge.to).not.toContain("UIKit");
      }
    });
  });

  describe("generic type handling", () => {
    let root: string;
    let extractor: SwiftExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-swift-generic-"));
      extractor = new SwiftExtractor();
      write(root, "Package.swift", `// swift-tools-version: 5.9`);

      write(
        root,
        "Sources/Container.swift",
        `
class Container<T> {
    var items: [T] = []
}
`,
      );

      write(
        root,
        "Sources/User.swift",
        `
struct UserProfile {
    let name: String
}
`,
      );

      write(
        root,
        "Sources/App.swift",
        `
class App {
    let users: Container<UserProfile>
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects type references inside generic parameters", async () => {
      const graph = await extractor.extract(root);
      const edgeToContainer = edgeBetween(
        graph,
        "Sources/App.swift",
        "Sources/Container.swift",
      );
      const edgeToUser = edgeBetween(
        graph,
        "Sources/App.swift",
        "Sources/User.swift",
      );
      expect(edgeToContainer).toBeDefined();
      expect(edgeToUser).toBeDefined();
    });
  });
});
