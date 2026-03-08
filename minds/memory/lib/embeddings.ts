/**
 * embeddings.ts — EmbeddingProvider interface and auto-fallback factory.
 *
 * T002: Defines the shared embedding contract, L2 normalization utility,
 * and createEmbeddingProvider() which auto-selects the best available
 * provider: OpenAI → local (node-llama-cpp) → null (BM25-only fallback).
 *
 * Lazy init: providers are not loaded until createEmbeddingProvider() is called.
 */

/** Embedding provider interface — all providers implement this contract. */
export interface EmbeddingProvider {
  /** Embed a single query string. Returns L2-normalized vector. */
  embedQuery(text: string): Promise<number[]>;

  /** Embed multiple strings. Returns L2-normalized vectors. */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * L2-normalize a vector so its magnitude equals 1.
 * All vectors must be normalized before storage and comparison.
 * Returns the input unchanged if the norm is zero (zero vector).
 */
export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Creates the best available EmbeddingProvider, trying in order:
 *   1. OpenAI (if OPENAI_API_KEY is set)
 *   2. Local node-llama-cpp (if LLAMA_MODEL_PATH is set or default model exists)
 *   3. null — graceful degradation to BM25-only search
 *
 * Returns null when no provider is available; callers must handle gracefully.
 */
export async function createEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  // Try OpenAI first
  if (process.env.OPENAI_API_KEY) {
    try {
      const { OpenAIEmbeddingProvider } = await import("./embeddings-openai.js");
      return new OpenAIEmbeddingProvider();
    } catch {
      // OpenAI provider failed to initialize — continue fallback
    }
  }

  // Try local node-llama-cpp
  try {
    const { LocalEmbeddingProvider } = await import("./embeddings-local.js");
    const provider = new LocalEmbeddingProvider();
    const available = await provider.isAvailable();
    if (available) return provider;
  } catch {
    // Local provider failed (model not found, load error) — continue fallback
  }

  // No provider available — caller falls back to BM25-only
  return null;
}
