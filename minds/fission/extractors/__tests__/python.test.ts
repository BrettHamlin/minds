import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PythonExtractor } from "../python.js";
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
let extractor: PythonExtractor;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fission-py-test-"));
  extractor = new PythonExtractor();

  // ── myapp/__init__.py (package marker) ──────────────────────────────
  write(root, "myapp/__init__.py", "");

  // ── myapp/main.py ───────────────────────────────────────────────────
  write(
    root,
    "myapp/main.py",
    `
import os
import myapp.utils
from myapp.models import User, Role
from myapp import config
`,
  );

  // ── myapp/utils.py ──────────────────────────────────────────────────
  write(
    root,
    "myapp/utils.py",
    `
def helper():
    pass
`,
  );

  // ── myapp/models/__init__.py ────────────────────────────────────────
  write(root, "myapp/models/__init__.py", `from .user import User\nfrom .role import Role`);

  // ── myapp/models/user.py ────────────────────────────────────────────
  write(
    root,
    "myapp/models/user.py",
    `
from ..config import DB_URL

class User:
    pass
`,
  );

  // ── myapp/models/role.py ────────────────────────────────────────────
  write(
    root,
    "myapp/models/role.py",
    `
class Role:
    pass
`,
  );

  // ── myapp/config.py ─────────────────────────────────────────────────
  write(
    root,
    "myapp/config.py",
    `
DB_URL = "sqlite:///db.sqlite"
`,
  );

  // ── myapp/services/__init__.py ──────────────────────────────────────
  write(root, "myapp/services/__init__.py", "");

  // ── myapp/services/auth.py (relative imports) ───────────────────────
  write(
    root,
    "myapp/services/auth.py",
    `
from . import helpers
from .. import config
from ..models import User
from ...outside import something
`,
  );

  // ── myapp/services/helpers.py ───────────────────────────────────────
  write(
    root,
    "myapp/services/helpers.py",
    `
def validate():
    pass
`,
  );

  // ── myapp/deep/__init__.py ──────────────────────────────────────────
  write(root, "myapp/deep/__init__.py", "");

  // ── myapp/deep/nested/__init__.py ───────────────────────────────────
  write(root, "myapp/deep/nested/__init__.py", "");

  // ── myapp/deep/nested/module.py (multi-level relative) ─────────────
  write(
    root,
    "myapp/deep/nested/module.py",
    `
from ...config import DB_URL
from .. import nested
from . import __init__
`,
  );

  // ── myapp/dotted.py (dotted absolute import) ────────────────────────
  write(
    root,
    "myapp/dotted.py",
    `
import myapp.models.user
import myapp.services.auth
`,
  );

  // ── myapp/weight_test.py (weight counting) ──────────────────────────
  write(
    root,
    "myapp/weight_test.py",
    `
from myapp.models import User, Role
from myapp.config import DB_URL
import myapp.utils
`,
  );

  // ── __pycache__/cached.py (should be excluded) ─────────────────────
  write(root, "__pycache__/cached.py", `print("cached")`);

  // ── venv/lib/site.py (should be excluded) ──────────────────────────
  write(root, "venv/lib/site.py", `print("venv")`);

  // ── .venv/lib/site.py (should be excluded) ─────────────────────────
  write(root, ".venv/lib/site.py", `print("dotenv")`);

  // ── node_modules/something.py (should be excluded) ─────────────────
  write(root, "node_modules/something.py", `print("node")`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PythonExtractor", () => {
  describe("metadata", () => {
    it("has language = 'python'", () => {
      expect(extractor.language).toBe("python");
    });

    it("handles .py extension", () => {
      expect(extractor.extensions).toEqual([".py"]);
    });
  });

  describe("basic import resolution", () => {
    it("resolves 'import myapp.utils' to myapp/utils.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "myapp/main.py", "myapp/utils.py");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });

    it("skips external packages like 'import os'", async () => {
      const graph = await extractor.extract(root);
      const osEdges = graph.edges.filter(
        (e) => e.from === "myapp/main.py" && e.to.includes("os"),
      );
      expect(osEdges).toHaveLength(0);
    });
  });

  describe("from-import resolution", () => {
    it("resolves 'from myapp.models import User, Role' with weight=2", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "myapp/main.py", "myapp/models/__init__.py");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2);
    });

    it("resolves 'from myapp import config' to myapp/config.py", async () => {
      const graph = await extractor.extract(root);
      // 'from myapp import config' — could be myapp/config.py or myapp/__init__.py
      // Should try config.py first
      const edge = edgeBetween(graph, "myapp/main.py", "myapp/config.py");
      expect(edge).toBeDefined();
    });
  });

  describe("relative import resolution", () => {
    it("resolves 'from . import helpers' in services/auth.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/services/auth.py",
        "myapp/services/helpers.py",
      );
      expect(edge).toBeDefined();
    });

    it("resolves 'from .. import config' in services/auth.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/services/auth.py",
        "myapp/config.py",
      );
      expect(edge).toBeDefined();
    });

    it("resolves 'from ..models import User' in services/auth.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/services/auth.py",
        "myapp/models/__init__.py",
      );
      expect(edge).toBeDefined();
    });

    it("skips 'from ...outside import something' that resolves above root", async () => {
      const graph = await extractor.extract(root);
      // from ...outside in myapp/services/ would go 3 levels up: services -> myapp -> root -> ABOVE root
      // This should be skipped
      const outsideEdges = graph.edges.filter(
        (e) =>
          e.from === "myapp/services/auth.py" && e.to.includes("outside"),
      );
      expect(outsideEdges).toHaveLength(0);
    });
  });

  describe("multi-level relative imports", () => {
    it("resolves 'from ...config import DB_URL' in deep/nested/module.py", async () => {
      const graph = await extractor.extract(root);
      // deep/nested/module.py: from ...config -> 3 dots = 3 dirs up from package
      // module.py is in myapp/deep/nested/ -> ... goes to myapp/
      const edge = edgeBetween(
        graph,
        "myapp/deep/nested/module.py",
        "myapp/config.py",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("dotted module paths", () => {
    it("resolves 'import myapp.models.user' to myapp/models/user.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/dotted.py",
        "myapp/models/user.py",
      );
      expect(edge).toBeDefined();
    });

    it("resolves 'import myapp.services.auth' to myapp/services/auth.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/dotted.py",
        "myapp/services/auth.py",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("__init__.py resolution", () => {
    it("from myapp.models import X resolves to models/__init__.py", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/weight_test.py",
        "myapp/models/__init__.py",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("edge weights", () => {
    it("weights 'from X import a, b' as 2", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/weight_test.py",
        "myapp/models/__init__.py",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(2);
    });

    it("weights 'from X import a' as 1", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/weight_test.py",
        "myapp/config.py",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });

    it("weights 'import X' as 1", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(
        graph,
        "myapp/weight_test.py",
        "myapp/utils.py",
      );
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });
  });

  describe("excluded directories", () => {
    it("does not include __pycache__ files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("__pycache__"))).toBe(false);
    });

    it("does not include venv files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("venv/"))).toBe(false);
    });

    it("does not include .venv files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes(".venv/"))).toBe(false);
    });

    it("does not include node_modules files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("node_modules"))).toBe(false);
    });
  });

  describe("external package filtering", () => {
    it("does not create edges for stdlib imports", async () => {
      const graph = await extractor.extract(root);
      // 'import os' should not produce an edge (no 'os' dir in root)
      const osEdges = graph.edges.filter((e) => e.to === "os" || e.to === "os.py");
      expect(osEdges).toHaveLength(0);
    });
  });

  describe("empty directory handling", () => {
    it("returns empty graph for directory with no .py files", async () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), "fission-py-empty-"));
      mkdirSync(join(emptyRoot, "src"), { recursive: true });
      writeFileSync(join(emptyRoot, "src/readme.txt"), "hello", "utf-8");

      const graph = await extractor.extract(emptyRoot);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);

      rmSync(emptyRoot, { recursive: true, force: true });
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

  describe("comment and string handling", () => {
    it("skips imports in comments", async () => {
      const commentRoot = mkdtempSync(join(tmpdir(), "fission-py-comment-"));
      write(commentRoot, "pkg/__init__.py", "");
      write(commentRoot, "pkg/real.py", "");
      write(commentRoot, "pkg/fake.py", "");
      write(
        commentRoot,
        "pkg/main.py",
        `
# from pkg import fake
from pkg import real
`,
      );

      const graph = await extractor.extract(commentRoot);
      const fakeEdge = edgeBetween(graph, "pkg/main.py", "pkg/fake.py");
      const realEdge = edgeBetween(graph, "pkg/main.py", "pkg/real.py");
      expect(fakeEdge).toBeUndefined();
      expect(realEdge).toBeDefined();

      rmSync(commentRoot, { recursive: true, force: true });
    });
  });

  describe("complete graph structure", () => {
    it("includes all .py files as nodes", async () => {
      const graph = await extractor.extract(root);
      const expected = [
        "myapp/__init__.py",
        "myapp/main.py",
        "myapp/utils.py",
        "myapp/config.py",
        "myapp/dotted.py",
        "myapp/weight_test.py",
        "myapp/models/__init__.py",
        "myapp/models/user.py",
        "myapp/models/role.py",
        "myapp/services/__init__.py",
        "myapp/services/auth.py",
        "myapp/services/helpers.py",
        "myapp/deep/__init__.py",
        "myapp/deep/nested/__init__.py",
        "myapp/deep/nested/module.py",
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
