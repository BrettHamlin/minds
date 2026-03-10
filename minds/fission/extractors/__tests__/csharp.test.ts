import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CSharpExtractor } from "../csharp.js";
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
// Test suite
// ---------------------------------------------------------------------------

describe("CSharpExtractor", () => {
  describe("metadata", () => {
    it("has language = 'csharp'", () => {
      const extractor = new CSharpExtractor();
      expect(extractor.language).toBe("csharp");
    });

    it("handles .cs extension", () => {
      const extractor = new CSharpExtractor();
      expect(extractor.extensions).toEqual([".cs"]);
    });
  });

  describe("basic using namespace resolution", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-basic-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Models/User.cs",
        `namespace MyApp.Models;

public class User
{
    public string Name { get; set; }
    public string Email { get; set; }
}
`,
      );

      write(
        root,
        "Services/UserService.cs",
        `using MyApp.Models;

namespace MyApp.Services;

public class UserService
{
    public User GetUser()
    {
        return new User();
    }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edge from file using a namespace to files in that namespace", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Services/UserService.cs",
        "Models/User.cs",
      );
      expect(edge).toBeDefined();
    });

    it("includes all cs files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("Models/User.cs");
      expect(graph.nodes).toContain("Services/UserService.cs");
    });

    it("uses relative paths for all nodes", async () => {
      const graph = await extractor.extract(root);
      for (const node of graph.nodes) {
        expect(node.startsWith("/")).toBe(false);
      }
    });
  });

  describe("using static resolution", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-static-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Utils/Constants.cs",
        `namespace MyApp.Utils;

public static class Constants
{
    public const string AppName = "MyApp";
}
`,
      );

      write(
        root,
        "App.cs",
        `using static MyApp.Utils.Constants;

namespace MyApp;

public class App
{
    public string Name => AppName;
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves using static to the file declaring the type", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "App.cs", "Utils/Constants.cs");
      expect(edge).toBeDefined();
    });
  });

  describe("using alias resolution", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-alias-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Services/FooService.cs",
        `namespace MyApp.Services;

public class FooService
{
    public void DoWork() {}
}
`,
      );

      write(
        root,
        "App.cs",
        `using Svc = MyApp.Services.FooService;

namespace MyApp;

public class App
{
    private Svc service;
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves using alias to the file declaring the type", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "App.cs", "Services/FooService.cs");
      expect(edge).toBeDefined();
    });
  });

  describe("intra-namespace type reference detection", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-intra-"));
      extractor = new CSharpExtractor();

      // Two files in the same namespace — no using directives needed
      write(
        root,
        "Models/User.cs",
        `namespace MyApp.Models;

public class User
{
    public string Name { get; set; }
}
`,
      );

      write(
        root,
        "Models/UserProfile.cs",
        `namespace MyApp.Models;

public class UserProfile
{
    public User Owner { get; set; }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects type references between files in the same namespace", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "Models/UserProfile.cs",
        "Models/User.cs",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("external namespace filtering", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-external-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "App.cs",
        `using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc;
using Windows.UI.Xaml;

namespace MyApp;

public class App
{
    public void Run() {}
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create edges for System.* imports", async () => {
      const graph = await extractor.extract(root);
      expect(graph.edges).toHaveLength(0);
    });

    it("does not create edges for Microsoft.* imports", async () => {
      const graph = await extractor.extract(root);
      const microsoftEdges = graph.edges.filter((e) =>
        e.to.includes("Microsoft"),
      );
      expect(microsoftEdges).toHaveLength(0);
    });
  });

  describe("type declaration detection — class, struct, interface, enum, record", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-types-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Types.cs",
        `namespace MyApp;

public class MyClass {}
public struct MyStruct {}
public interface IMyInterface {}
public enum MyEnum { A, B, C }
public record MyRecord(string Name);
`,
      );

      write(
        root,
        "Consumer.cs",
        `namespace MyApp;

public class Consumer
{
    public MyClass Cls { get; set; }
    public MyStruct Str { get; set; }
    public IMyInterface Iface { get; set; }
    public MyEnum Enm { get; set; }
    public MyRecord Rec { get; set; }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects all type kinds in the declaring file", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "Consumer.cs", "Types.cs");
      expect(edge).toBeDefined();
    });

    it("weights edge by number of distinct types referenced", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "Consumer.cs", "Types.cs");
      expect(edge).toBeDefined();
      // MyClass, MyStruct, IMyInterface, MyEnum, MyRecord = 5
      expect(edge!.weight).toBe(5);
    });
  });

  describe("file-scoped namespaces", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-filescoped-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "A.cs",
        `namespace MyApp;

public class Alpha {}
`,
      );

      write(
        root,
        "B.cs",
        `namespace MyApp
{
    public class Beta
    {
        public Alpha A { get; set; }
    }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("handles both file-scoped and traditional namespaces", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "B.cs", "A.cs");
      expect(edge).toBeDefined();
    });
  });

  describe("partial class handling", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-partial-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "UserPart1.cs",
        `namespace MyApp;

public partial class User
{
    public string Name { get; set; }
}
`,
      );

      write(
        root,
        "UserPart2.cs",
        `namespace MyApp;

public partial class User
{
    public string Email { get; set; }
}
`,
      );

      write(
        root,
        "Consumer.cs",
        `namespace MyApp;

public class Consumer
{
    public User CurrentUser { get; set; }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects partial class — first file wins for type map", async () => {
      const graph = await extractor.extract(root);
      // Consumer references User — should create an edge to at least one file
      const edgesToUser = graph.edges.filter(
        (e) => e.from === "Consumer.cs" && e.to.startsWith("User"),
      );
      expect(edgesToUser.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("empty project handling", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-empty-"));
      extractor = new CSharpExtractor();
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("returns empty graph for directory with no cs files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe("bin/ and obj/ exclusion", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-exclude-"));
      extractor = new CSharpExtractor();

      write(root, "App.cs", `namespace MyApp;\npublic class App {}`);
      write(
        root,
        "bin/Debug/net8.0/App.cs",
        `namespace MyApp;\npublic class CompiledApp {}`,
      );
      write(
        root,
        "obj/Debug/net8.0/App.g.cs",
        `namespace MyApp;\npublic class GeneratedApp {}`,
      );
      write(
        root,
        ".git/hooks/pre-commit.cs",
        `namespace Hooks;\npublic class Hook {}`,
      );
      write(
        root,
        "node_modules/pkg/File.cs",
        `namespace Pkg;\npublic class PkgClass {}`,
      );
      write(
        root,
        "packages/nuget/File.cs",
        `namespace NuGet;\npublic class NuGetClass {}`,
      );
      write(
        root,
        ".vs/settings.cs",
        `namespace VS;\npublic class Settings {}`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("excludes bin directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("bin"))).toBe(false);
    });

    it("excludes obj directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("obj"))).toBe(false);
    });

    it("excludes .git directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".git"))).toBe(false);
    });

    it("excludes node_modules directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("node_modules"))).toBe(false);
    });

    it("excludes packages directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("packages"))).toBe(false);
    });

    it("excludes .vs directory", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".vs"))).toBe(false);
    });

    it("includes root-level source files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("App.cs");
    });
  });

  describe("access modifier and keyword combinations", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-modifiers-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Declarations.cs",
        `namespace MyApp;

public class PublicClass {}
internal class InternalClass {}
private class PrivateClass {}
protected class ProtectedClass {}
public static class StaticClass {}
public abstract class AbstractClass {}
public sealed class SealedClass {}
public partial class PartialClass {}
`,
      );

      write(
        root,
        "Consumer.cs",
        `namespace MyApp;

public class Consumer
{
    public PublicClass Pub { get; set; }
    public InternalClass Int { get; set; }
    public PrivateClass Priv { get; set; }
    public ProtectedClass Prot { get; set; }
    public StaticClass Stat { get; set; }
    public AbstractClass Abs { get; set; }
    public SealedClass Seal { get; set; }
    public PartialClass Part { get; set; }
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("detects types with all access modifier and keyword combinations", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "Consumer.cs", "Declarations.cs");
      expect(edge).toBeDefined();
      // PublicClass, InternalClass, PrivateClass, ProtectedClass,
      // StaticClass, AbstractClass, SealedClass, PartialClass = 8
      expect(edge!.weight).toBe(8);
    });
  });

  describe("self-reference exclusion", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-self-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Models.cs",
        `namespace MyApp;

public class MyModel
{
    public MyModel Clone() => new MyModel();
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create self-edges", async () => {
      const graph = await extractor.extract(root);
      const selfEdge = edgeBetween(graph, "Models.cs", "Models.cs");
      expect(selfEdge).toBeUndefined();
    });
  });

  describe("no duplicate nodes", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-nodup-"));
      extractor = new CSharpExtractor();
      write(root, "A.cs", `namespace MyApp;\npublic class A {}`);
      write(root, "B.cs", `namespace MyApp;\npublic class B { public A a; }`);
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

  describe("multiple namespaces in single project", () => {
    let root: string;
    let extractor: CSharpExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-csharp-multi-ns-"));
      extractor = new CSharpExtractor();

      write(
        root,
        "Models/User.cs",
        `namespace MyApp.Models;
public class User {}
`,
      );

      write(
        root,
        "Models/Order.cs",
        `namespace MyApp.Models;
public class Order {}
`,
      );

      write(
        root,
        "Services/OrderService.cs",
        `using MyApp.Models;

namespace MyApp.Services;

public class OrderService
{
    public User GetUser() => new User();
    public Order GetOrder() => new Order();
}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edges to all files in a used namespace", async () => {
      const graph = await extractor.extract(root);
      const edgeToUser = edgeBetween(
        graph,
        "Services/OrderService.cs",
        "Models/User.cs",
      );
      const edgeToOrder = edgeBetween(
        graph,
        "Services/OrderService.cs",
        "Models/Order.cs",
      );
      expect(edgeToUser).toBeDefined();
      expect(edgeToOrder).toBeDefined();
    });
  });
});
