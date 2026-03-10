import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { RustExtractor } from "../rust.js";
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

describe("RustExtractor", () => {
  describe("metadata", () => {
    it("has language = 'rust'", () => {
      const extractor = new RustExtractor();
      expect(extractor.language).toBe("rust");
    });

    it("handles .rs extensions", () => {
      const extractor = new RustExtractor();
      expect(extractor.extensions).toEqual([".rs"]);
    });
  });

  describe("basic use crate:: resolution", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-basic-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod config;
mod utils;

use crate::config::Settings;
use crate::utils::helper;

fn main() {}
`,
      );
      write(root, "src/config.rs", `pub struct Settings { pub port: u16 }\n`);
      write(
        root,
        "src/utils.rs",
        `pub fn helper() {}\n`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves use crate::config to src/config.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/main.rs", "src/config.rs");
      expect(edge).toBeDefined();
    });

    it("resolves use crate::utils to src/utils.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/main.rs", "src/utils.rs");
      expect(edge).toBeDefined();
    });

    it("creates edges for mod declarations", async () => {
      const graph = await extractor.extract(root);
      // mod config; in main.rs should create edge to config.rs
      const edge = edgeBetween(graph, "src/main.rs", "src/config.rs");
      expect(edge).toBeDefined();
    });

    it("includes all .rs files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main.rs");
      expect(graph.nodes).toContain("src/config.rs");
      expect(graph.nodes).toContain("src/utils.rs");
    });

    it("all nodes are relative paths", async () => {
      const graph = await extractor.extract(root);
      for (const node of graph.nodes) {
        expect(node.startsWith("/")).toBe(false);
      }
    });
  });

  describe("mod declaration resolving to directory module", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-dirmod-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/lib.rs",
        `
mod models;

use crate::models::User;
`,
      );
      // models is a directory module with mod.rs
      write(
        root,
        "src/models/mod.rs",
        `
mod user;
pub use user::User;
`,
      );
      write(root, "src/models/user.rs", `pub struct User { pub name: String }\n`);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves mod models; to src/models/mod.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/lib.rs", "src/models/mod.rs");
      expect(edge).toBeDefined();
    });

    it("resolves mod user; inside models/mod.rs to models/user.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/models/mod.rs", "src/models/user.rs");
      expect(edge).toBeDefined();
    });

    it("resolves use crate::models to src/models/mod.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/lib.rs", "src/models/mod.rs");
      expect(edge).toBeDefined();
    });
  });

  describe("grouped use with weight", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-grouped-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod db;

use crate::db::{connect, query, migrate};
`,
      );
      write(
        root,
        "src/db.rs",
        `
pub fn connect() {}
pub fn query() {}
pub fn migrate() {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("weights grouped use by item count (3 items = weight 3)", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/main.rs", "src/db.rs");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(3);
    });
  });

  describe("use super:: resolution", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-super-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/lib.rs",
        `
mod handlers;
pub fn shared_helper() {}
`,
      );
      write(
        root,
        "src/handlers/mod.rs",
        `
mod routes;
use super::shared_helper;
`,
      );
      write(
        root,
        "src/handlers/routes.rs",
        `
use super::something;
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves use super:: from handlers/mod.rs to lib.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/handlers/mod.rs", "src/lib.rs");
      expect(edge).toBeDefined();
    });

    it("resolves use super:: from handlers/routes.rs to handlers/mod.rs", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/handlers/routes.rs", "src/handlers/mod.rs");
      expect(edge).toBeDefined();
    });
  });

  describe("external crate filtering", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-external-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod config;

use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use tokio::runtime::Runtime;
use crate::config::Settings;
`,
      );
      write(root, "src/config.rs", `pub struct Settings {}\n`);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create edges for std:: imports", async () => {
      const graph = await extractor.extract(root);
      const stdEdges = graph.edges.filter((e) => e.to.includes("std"));
      expect(stdEdges).toHaveLength(0);
    });

    it("does not create edges for serde:: imports", async () => {
      const graph = await extractor.extract(root);
      const serdeEdges = graph.edges.filter((e) => e.to.includes("serde"));
      expect(serdeEdges).toHaveLength(0);
    });

    it("does not create edges for tokio:: imports", async () => {
      const graph = await extractor.extract(root);
      const tokioEdges = graph.edges.filter((e) => e.to.includes("tokio"));
      expect(tokioEdges).toHaveLength(0);
    });

    it("still creates edges for crate:: imports", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/main.rs", "src/config.rs");
      expect(edge).toBeDefined();
    });
  });

  describe("nested module paths", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-nested-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/lib.rs",
        `
mod api;

use crate::api::handlers::user::create_user;
`,
      );
      write(
        root,
        "src/api/mod.rs",
        `
pub mod handlers;
`,
      );
      write(
        root,
        "src/api/handlers/mod.rs",
        `
pub mod user;
`,
      );
      write(
        root,
        "src/api/handlers/user.rs",
        `
pub fn create_user() {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves deep nested use crate::api::handlers::user", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/lib.rs", "src/api/handlers/user.rs");
      expect(edge).toBeDefined();
    });
  });

  describe("empty project / no Cargo.toml", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-empty-"));
      extractor = new RustExtractor();
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("returns empty graph when no Cargo.toml exists", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe("target/ directory exclusion", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-target-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(root, "src/main.rs", `fn main() {}\n`);
      // Files under target/ should be excluded
      write(
        root,
        "target/debug/build/generated.rs",
        `pub fn generated() {}\n`,
      );
      write(
        root,
        "target/release/build/output.rs",
        `pub fn output() {}\n`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not include target/ directory files as nodes", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes.some((n) => n.includes("target/"))).toBe(false);
    });

    it("only includes src/ files", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("src/main.rs");
      expect(graph.nodes).toHaveLength(1);
    });
  });

  describe("pub use (re-exports) create edges", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-reexport-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/lib.rs",
        `
mod internal;
pub use crate::internal::Widget;
`,
      );
      write(
        root,
        "src/internal.rs",
        `
pub struct Widget {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edge for pub use re-export", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/lib.rs", "src/internal.rs");
      expect(edge).toBeDefined();
    });
  });

  describe("glob use (wildcard)", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-glob-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod prelude;

use crate::prelude::*;
`,
      );
      write(
        root,
        "src/prelude.rs",
        `
pub use std::collections::HashMap;
pub fn utility() {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edge for glob use with weight 1", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/main.rs", "src/prelude.rs");
      expect(edge).toBeDefined();
      expect(edge!.weight).toBe(1);
    });
  });

  describe("aliased use (as)", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-alias-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod config;

use crate::config::Settings as AppSettings;
`,
      );
      write(root, "src/config.rs", `pub struct Settings {}\n`);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("creates edge for aliased use", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/main.rs", "src/config.rs");
      expect(edge).toBeDefined();
    });
  });

  describe("comment stripping", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-comments-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod real_dep;

// use crate::fake::module;
/* use crate::another_fake::thing; */

/*
 * use crate::multiline_fake::stuff;
 */

use crate::real_dep::something;
`,
      );
      write(root, "src/real_dep.rs", `pub fn something() {}\n`);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("does not create edges for commented-out use statements", async () => {
      const graph = await extractor.extract(root);
      // Should only have edges to real_dep.rs
      const edges = graph.edges.filter((e) => e.from === "src/main.rs");
      expect(edges.length).toBeGreaterThanOrEqual(1);
      // All edges should point to real_dep.rs (from mod + use)
      for (const e of edges) {
        expect(e.to).toBe("src/real_dep.rs");
      }
    });
  });

  describe("no duplicate edges", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-dedup-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/main.rs",
        `
mod db;

use crate::db::connect;
use crate::db::{query, migrate};
`,
      );
      write(
        root,
        "src/db.rs",
        `
pub fn connect() {}
pub fn query() {}
pub fn migrate() {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("deduplicates edges to same file, keeping max weight", async () => {
      const graph = await extractor.extract(root);
      const edges = graph.edges.filter(
        (e) => e.from === "src/main.rs" && e.to === "src/db.rs",
      );
      // Should be a single deduplicated edge
      expect(edges).toHaveLength(1);
      // Weight should be max of: mod(1), use single(1), use grouped(2) = 2
      expect(edges[0].weight).toBe(2);
    });
  });

  describe("workspace support", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-workspace-"));
      extractor = new RustExtractor();

      write(
        root,
        "Cargo.toml",
        `[workspace]\nmembers = ["crate-a", "crate-b"]\n`,
      );
      write(
        root,
        "crate-a/Cargo.toml",
        `[package]\nname = "crate-a"\nversion = "0.1.0"\n`,
      );
      write(
        root,
        "crate-a/src/lib.rs",
        `
mod util;
use crate::util::do_thing;
`,
      );
      write(root, "crate-a/src/util.rs", `pub fn do_thing() {}\n`);

      write(
        root,
        "crate-b/Cargo.toml",
        `[package]\nname = "crate-b"\nversion = "0.1.0"\n`,
      );
      write(
        root,
        "crate-b/src/lib.rs",
        `
mod service;
use crate::service::run;
`,
      );
      write(root, "crate-b/src/service.rs", `pub fn run() {}\n`);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("discovers files from all workspace members", async () => {
      const graph = await extractor.extract(root);
      expect(graph.nodes).toContain("crate-a/src/lib.rs");
      expect(graph.nodes).toContain("crate-a/src/util.rs");
      expect(graph.nodes).toContain("crate-b/src/lib.rs");
      expect(graph.nodes).toContain("crate-b/src/service.rs");
    });

    it("resolves crate-internal imports within workspace members", async () => {
      const graph = await extractor.extract(root);
      const edgeA = edgeBetween(graph, "crate-a/src/lib.rs", "crate-a/src/util.rs");
      const edgeB = edgeBetween(graph, "crate-b/src/lib.rs", "crate-b/src/service.rs");
      expect(edgeA).toBeDefined();
      expect(edgeB).toBeDefined();
    });
  });

  describe("use self:: resolution", () => {
    let root: string;
    let extractor: RustExtractor;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "fission-rust-self-"));
      extractor = new RustExtractor();

      write(root, "Cargo.toml", `[package]\nname = "myapp"\nversion = "0.1.0"\n`);
      write(
        root,
        "src/lib.rs",
        `
mod api;
`,
      );
      write(
        root,
        "src/api/mod.rs",
        `
mod handlers;
use self::handlers::handle_request;
`,
      );
      write(
        root,
        "src/api/handlers.rs",
        `
pub fn handle_request() {}
`,
      );
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("resolves use self::handlers to sibling/child module", async () => {
      const graph = await extractor.extract(root);
      const edge = edgeBetween(graph, "src/api/mod.rs", "src/api/handlers.rs");
      expect(edge).toBeDefined();
    });
  });
});
