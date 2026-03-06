/**
 * embeddings.ts — Vector embedding wrapper for Mind routing.
 *
 * Uses @xenova/transformers (all-MiniLM-L6-v2) for local semantic embeddings.
 * Falls back to null (disabled) if the model fails to load — BM25 continues alone.
 *
 * The model runs entirely in-process via ONNX Runtime. No external API calls.
 */

export interface EmbeddingModel {
  embed(text: string): Promise<Float32Array>;
}

/**
 * Attempt to load the all-MiniLM-L6-v2 model.
 * Returns null if @xenova/transformers is unavailable or model fails to load.
 */
export async function loadEmbeddingModel(): Promise<EmbeddingModel | null> {
  try {
    // Dynamic import so the file can be loaded even without the package installed
    const { pipeline } = await import("@xenova/transformers");
    const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

    return {
      async embed(text: string): Promise<Float32Array> {
        const output = await extractor(text, { pooling: "mean", normalize: true });
        // output.data is a Float32Array of 384 dimensions
        return output.data as Float32Array;
      },
    };
  } catch {
    return null;
  }
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1]; higher = more similar.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
