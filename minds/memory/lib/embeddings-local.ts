/**
 * embeddings-local.ts — node-llama-cpp local embedding provider.
 *
 * T004: Provides embeddings via a local GGUF model using node-llama-cpp.
 * Lazy-loaded: LlamaModel is not initialized until first embed call.
 * Applies L2 normalization to all output vectors.
 *
 * Model path resolution order:
 *   1. LLAMA_MODEL_PATH environment variable
 *   2. ~/.cache/collab/embeddings/embedding-model.gguf
 *
 * Compatible with EmbeddingGemma 300M GGUF or any embedding-capable GGUF.
 */

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { EmbeddingProvider } from "./embeddings.js";
import { l2Normalize } from "./embeddings.js";

/** Default model path if LLAMA_MODEL_PATH is not set. */
const DEFAULT_MODEL_PATH = join(homedir(), ".cache", "collab", "embeddings", "embedding-model.gguf");

type LlamaInstance = Awaited<ReturnType<typeof import("node-llama-cpp").getLlama>>;
type LlamaModel = Awaited<ReturnType<LlamaInstance["loadModel"]>>;
type LlamaEmbeddingCtx = Awaited<ReturnType<LlamaModel["createEmbeddingContext"]>>;

/** Local embedding provider using node-llama-cpp with a GGUF model. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private llama: LlamaInstance | null = null;
  private model: LlamaModel | null = null;
  private ctx: LlamaEmbeddingCtx | null = null;
  private readonly modelPath: string;

  constructor() {
    this.modelPath = process.env.LLAMA_MODEL_PATH ?? DEFAULT_MODEL_PATH;
  }

  /** Returns true if the model file exists at the resolved path. */
  async isAvailable(): Promise<boolean> {
    return existsSync(this.modelPath);
  }

  async embedQuery(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const embedding = await this.ctx!.getEmbeddingFor(text);
    return l2Normalize(Array.from(embedding.vector));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    await this.ensureLoaded();
    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.ctx!.getEmbeddingFor(text);
      results.push(l2Normalize(Array.from(embedding.vector)));
    }
    return results;
  }

  /** Lazy-init: load Llama instance, model, and context on first use. */
  private async ensureLoaded(): Promise<void> {
    if (this.ctx) return;

    if (!existsSync(this.modelPath)) {
      throw new Error(
        `LocalEmbeddingProvider: model file not found at "${this.modelPath}". ` +
          `Set LLAMA_MODEL_PATH to the GGUF model path or place a model at the default location.`
      );
    }

    const { getLlama } = await import("node-llama-cpp");
    this.llama = await getLlama();
    this.model = await this.llama.loadModel({ modelPath: this.modelPath });
    this.ctx = await this.model.createEmbeddingContext();
  }

  /** Dispose resources (model + context). */
  async dispose(): Promise<void> {
    if (this.ctx) {
      await this.ctx.dispose();
      this.ctx = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
    if (this.llama) {
      await this.llama.dispose();
      this.llama = null;
    }
  }
}
