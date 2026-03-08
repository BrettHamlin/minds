/**
 * Unit tests for embeddings.ts — EmbeddingProvider interface and factory.
 *
 * T009: Tests provider creation, fallback chain order, L2 normalization
 * correctness, and graceful degradation when no providers are available.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { l2Normalize, createEmbeddingProvider } from "./embeddings";
import type { EmbeddingProvider } from "./embeddings";

// ─── L2 Normalization ────────────────────────────────────────────────────────

describe("l2Normalize", () => {
  test("normalizes a simple vector to unit length", () => {
    const vec = [3, 4]; // norm = 5
    const normalized = l2Normalize(vec);
    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
  });

  test("resulting vector has magnitude 1", () => {
    const vec = [1, 2, 3, 4, 5];
    const normalized = l2Normalize(vec);
    const magnitude = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  test("returns zero vector unchanged when norm is 0", () => {
    const vec = [0, 0, 0];
    const normalized = l2Normalize(vec);
    expect(normalized).toEqual([0, 0, 0]);
  });

  test("normalizes single-element vector", () => {
    const vec = [5];
    const normalized = l2Normalize(vec);
    expect(normalized[0]).toBeCloseTo(1.0, 5);
  });

  test("normalizes negative values correctly", () => {
    const vec = [-3, 4]; // norm = 5
    const normalized = l2Normalize(vec);
    expect(normalized[0]).toBeCloseTo(-0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
  });

  test("already-normalized vector is unchanged", () => {
    const vec = [1, 0, 0];
    const normalized = l2Normalize(vec);
    expect(normalized).toEqual([1, 0, 0]);
  });
});

// ─── Fallback Provider (mock environment) ────────────────────────────────────

describe("createEmbeddingProvider — fallback chain", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModelPath = process.env.LLAMA_MODEL_PATH;

  afterEach(() => {
    // Restore env vars
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
    if (originalModelPath === undefined) {
      delete process.env.LLAMA_MODEL_PATH;
    } else {
      process.env.LLAMA_MODEL_PATH = originalModelPath;
    }
  });

  test("returns null when no providers are configured", async () => {
    // Remove OpenAI key and point LLAMA_MODEL_PATH to nonexistent file
    delete process.env.OPENAI_API_KEY;
    process.env.LLAMA_MODEL_PATH = "/tmp/nonexistent-model-xyz.gguf";

    const provider = await createEmbeddingProvider();
    expect(provider).toBeNull();
  });

  test("returns null gracefully — no throw — when no providers available", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.LLAMA_MODEL_PATH = "/tmp/nonexistent-model-xyz.gguf";

    await expect(createEmbeddingProvider()).resolves.toBeNull();
  });
});

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

describe("OpenAIEmbeddingProvider", () => {
  test("throws when OPENAI_API_KEY is not set", async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const { OpenAIEmbeddingProvider } = await import("./embeddings-openai");
      expect(() => new OpenAIEmbeddingProvider()).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    }
  });

  test("instantiates when OPENAI_API_KEY is set", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key-for-instantiation";

    try {
      const { OpenAIEmbeddingProvider } = await import("./embeddings-openai");
      expect(() => new OpenAIEmbeddingProvider()).not.toThrow();
    } finally {
      if (saved !== undefined) {
        process.env.OPENAI_API_KEY = saved;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    }
  });
});

// ─── LocalEmbeddingProvider ───────────────────────────────────────────────────

describe("LocalEmbeddingProvider", () => {
  test("isAvailable returns false when model file does not exist", async () => {
    const saved = process.env.LLAMA_MODEL_PATH;
    process.env.LLAMA_MODEL_PATH = "/tmp/nonexistent-model-xyz.gguf";

    try {
      const { LocalEmbeddingProvider } = await import("./embeddings-local");
      const provider = new LocalEmbeddingProvider();
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    } finally {
      if (saved !== undefined) {
        process.env.LLAMA_MODEL_PATH = saved;
      } else {
        delete process.env.LLAMA_MODEL_PATH;
      }
    }
  });

  test("embedQuery throws descriptive error when model not found", async () => {
    const saved = process.env.LLAMA_MODEL_PATH;
    process.env.LLAMA_MODEL_PATH = "/tmp/nonexistent-model-xyz.gguf";

    try {
      const { LocalEmbeddingProvider } = await import("./embeddings-local");
      const provider = new LocalEmbeddingProvider();
      await expect(provider.embedQuery("test")).rejects.toThrow(/model file not found/);
    } finally {
      if (saved !== undefined) {
        process.env.LLAMA_MODEL_PATH = saved;
      } else {
        delete process.env.LLAMA_MODEL_PATH;
      }
    }
  });
});

// ─── Provider Interface Contract ─────────────────────────────────────────────

describe("EmbeddingProvider interface", () => {
  test("stub provider satisfies the interface", async () => {
    const stub: EmbeddingProvider = {
      embedQuery: async (text) => l2Normalize([1, 2, 3]),
      embedBatch: async (texts) => texts.map(() => l2Normalize([1, 2, 3])),
    };

    const single = await stub.embedQuery("hello");
    expect(single).toHaveLength(3);

    const batch = await stub.embedBatch(["a", "b"]);
    expect(batch).toHaveLength(2);
    expect(batch[0]).toHaveLength(3);
  });

  test("batch returns empty array for empty input", async () => {
    const stub: EmbeddingProvider = {
      embedQuery: async () => [1, 0],
      embedBatch: async (texts) => texts.map(() => [1, 0]),
    };

    const result = await stub.embedBatch([]);
    expect(result).toEqual([]);
  });
});
