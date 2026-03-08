/**
 * embeddings-openai.ts — OpenAI text-embedding-3-small provider.
 *
 * T003: Fetches embeddings from the OpenAI API via fetch().
 * Reads OPENAI_API_KEY from the environment.
 * Applies L2 normalization to all output vectors.
 *
 * Model: text-embedding-3-small (8192 token limit, 1536 dimensions)
 */

import type { EmbeddingProvider } from "./embeddings.js";
import { l2Normalize } from "./embeddings.js";

const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small";
/** OpenAI text-embedding-3-small token limit */
const MAX_TOKENS = 8192;

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/** OpenAI embedding provider using text-embedding-3-small via fetch(). */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;

  constructor() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OpenAIEmbeddingProvider: OPENAI_API_KEY environment variable is not set");
    }
    this.apiKey = key;
  }

  async embedQuery(text: string): Promise<number[]> {
    const results = await this.fetchEmbeddings([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.fetchEmbeddings(texts);
  }

  private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch(OPENAI_EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new Error(
        `OpenAIEmbeddingProvider: API request failed — HTTP ${response.status}: ${body}`
      );
    }

    const data = (await response.json()) as OpenAIEmbedResponse;

    if (!data.data || data.data.length !== texts.length) {
      throw new Error(
        `OpenAIEmbeddingProvider: expected ${texts.length} embeddings, got ${data.data?.length ?? 0}`
      );
    }

    // Sort by index (OpenAI guarantees order but be explicit) and normalize
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => l2Normalize(item.embedding));
  }
}
