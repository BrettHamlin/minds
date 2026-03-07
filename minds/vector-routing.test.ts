/**
 * vector-routing.test.ts — Tests for hybrid BM25 + semantic routing.
 *
 * Tests loadEmbeddingModel(), vector scoring semantics, hybrid score quality,
 * and graceful BM25-only fallback when the model is unavailable.
 *
 * Model tests are skipped if the model fails to load (e.g., no network in CI).
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { loadEmbeddingModel, cosineSimilarity } from "./embeddings";
import type { EmbeddingModel } from "./embeddings";
import { MindRouter } from "./router";
import type { MindDescription } from "./mind";

// ---------------------------------------------------------------------------
// Fixtures — minds with clearly distinct semantic domains
// ---------------------------------------------------------------------------

const INSTALL_MIND: MindDescription = {
  name: "installer",
  domain: "Package installation, setup scripts, dependency management, bootstrapping",
  keywords: ["install", "setup", "bootstrap", "dependency", "package", "configure"],
  owns_files: ["minds/cli/"],
  capabilities: [
    "install pipeline scripts",
    "configure development environment",
    "manage package dependencies",
    "bootstrap new projects",
  ],
};

const SIGNALS_MIND: MindDescription = {
  name: "signals",
  domain: "Agent-to-orchestrator signal emission and transport dispatch",
  keywords: ["signal", "emit", "phase", "event", "queue", "transport"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals", "resolve signal names", "persist to queue"],
};

const OBSERVABILITY_MIND: MindDescription = {
  name: "observability",
  domain: "Metrics, run classification, gate accuracy, autonomy rate, dashboard, statusline",
  keywords: ["metrics", "dashboard", "autonomy", "accuracy", "status", "monitor", "classify"],
  owns_files: ["minds/observability/"],
  capabilities: ["track metrics", "generate dashboard", "classify runs", "monitor accuracy"],
};

// ---------------------------------------------------------------------------
// Shared model load (once per test suite — model is ~22MB)
// ---------------------------------------------------------------------------

let model: EmbeddingModel | null = null;
let modelAvailable = false;

beforeAll(async () => {
  model = await loadEmbeddingModel();
  modelAvailable = model !== null;
}, 30_000 /* 30s timeout for model download */);

// ---------------------------------------------------------------------------
// 1. loadEmbeddingModel() — returns a working model or null
// ---------------------------------------------------------------------------

describe("loadEmbeddingModel()", () => {
  it("returns null or a valid EmbeddingModel", () => {
    // Must return either null or an object with embed()
    if (model === null) {
      expect(model).toBeNull();
    } else {
      expect(typeof model.embed).toBe("function");
    }
  });

  it("embed() returns a Float32Array when model is available", async () => {
    if (!modelAvailable) {
      console.log("  [skip] model unavailable");
      return;
    }
    const vec = await model!.embed("test sentence");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBeGreaterThan(0);
  });

  it("embed() output is normalized (unit length ≈ 1)", async () => {
    if (!modelAvailable) {
      console.log("  [skip] model unavailable");
      return;
    }
    const vec = await model!.embed("normalized embedding check");
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Vector scoring — semantic similarity ordering
// ---------------------------------------------------------------------------

describe("Vector scoring — semantic matches", () => {
  it("'run the installer' is more similar to install corpus than to emit signal", async () => {
    if (!modelAvailable) {
      console.log("  [skip] model unavailable");
      return;
    }

    const query = await model!.embed("run the installer");
    const installCorpus = await model!.embed("install pipeline scripts configure development environment");
    const signalCorpus = await model!.embed("emit signal phase event queue transport");

    const simInstall = cosineSimilarity(query, installCorpus);
    const simSignal = cosineSimilarity(query, signalCorpus);

    expect(simInstall).toBeGreaterThan(simSignal);
  });

  it("semantically similar texts have higher cosine similarity than unrelated texts", async () => {
    if (!modelAvailable) {
      console.log("  [skip] model unavailable");
      return;
    }

    const setupQuery = await model!.embed("set up the development environment");
    const installText = await model!.embed("bootstrap and configure project dependencies");
    const metricsText = await model!.embed("autonomy rate accuracy dashboard monitoring");

    const simRelated = cosineSimilarity(setupQuery, installText);
    const simUnrelated = cosineSimilarity(setupQuery, metricsText);

    expect(simRelated).toBeGreaterThan(simUnrelated);
  });
});

// ---------------------------------------------------------------------------
// 3. Hybrid routing beats BM25-only for semantic (zero keyword overlap) queries
// ---------------------------------------------------------------------------

describe("Hybrid routing vs BM25-only", () => {
  it("routes 'set up the development environment' to installer with vector model", async () => {
    if (!modelAvailable) {
      console.log("  [skip] model unavailable");
      return;
    }

    const hybridRouter = new MindRouter();
    hybridRouter.setModel(model!);
    for (const mind of [INSTALL_MIND, SIGNALS_MIND, OBSERVABILITY_MIND]) {
      await hybridRouter.addChild(mind);
    }

    const results = await hybridRouter.route("set up the development environment");
    expect(results.length).toBeGreaterThan(0);
    // With vector embeddings, semantic query should find installer
    expect(results[0].mind.name).toBe("installer");
  });

  it("hybrid router finds semantic matches that BM25-only misses (zero keyword overlap)", async () => {
    if (!modelAvailable) {
      console.log("  [skip] model unavailable");
      return;
    }

    const bm25Router = new MindRouter();
    // No model — BM25 only
    for (const mind of [INSTALL_MIND, SIGNALS_MIND, OBSERVABILITY_MIND]) {
      await bm25Router.addChild(mind);
    }

    const hybridRouter = new MindRouter();
    hybridRouter.setModel(model!);
    for (const mind of [INSTALL_MIND, SIGNALS_MIND, OBSERVABILITY_MIND]) {
      await hybridRouter.addChild(mind);
    }

    // Query with NO keyword overlap with any Mind — pure semantic territory.
    // None of these words appear in the minds' keywords/capabilities:
    //   install, setup, bootstrap, dependency, package, configure,
    //   signal, emit, phase, event, queue, transport,
    //   metrics, dashboard, autonomy, accuracy, status, monitor, classify
    const query = "prepare the workspace for coding";
    const bm25Results = await bm25Router.route(query);
    const hybridResults = await hybridRouter.route(query);

    // BM25 finds nothing (no keyword overlap)
    expect(bm25Results).toHaveLength(0);

    // Hybrid finds at least one result via vector similarity
    expect(hybridResults.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Graceful fallback — BM25-only when model is null
// ---------------------------------------------------------------------------

describe("Graceful fallback (BM25-only mode)", () => {
  it("MindRouter works without a model set", async () => {
    const router = new MindRouter();
    // No setModel() call
    for (const mind of [INSTALL_MIND, SIGNALS_MIND, OBSERVABILITY_MIND]) {
      await router.addChild(mind);
    }

    const results = await router.route("emit signal");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].mind.name).toBe("signals");
  });

  it("MindRouter works after setModel(null)", async () => {
    const router = new MindRouter();
    router.setModel(null);
    for (const mind of [INSTALL_MIND, SIGNALS_MIND, OBSERVABILITY_MIND]) {
      await router.addChild(mind);
    }

    const results = await router.route("track metrics dashboard");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].mind.name).toBe("observability");
  });

  it("addChild re-indexing is safe when BM25 already has the entry", async () => {
    const router = new MindRouter();
    // Add twice — BM25Index.add() must handle duplicate removal
    await router.addChild(SIGNALS_MIND);
    await router.addChild(SIGNALS_MIND); // re-add
    expect(router.childCount).toBe(1);

    const results = await router.route("emit signal");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].mind.name).toBe("signals");
  });

  it("router returns [] for unrecognized query (no keyword match, no model)", async () => {
    const router = new MindRouter();
    for (const mind of [INSTALL_MIND, SIGNALS_MIND]) {
      await router.addChild(mind);
    }
    const results = await router.route("zzzz xxxxxxxxxxx");
    expect(results).toHaveLength(0);
  });
});
