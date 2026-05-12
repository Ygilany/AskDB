import type { EmbeddingModel } from "ai";
import type { Embedder } from "../types.js";

export type CreateAiSdkEmbedderOptions = {
  model: EmbeddingModel<string>;
  /** Maximum retries per AI SDK embedding call. Defaults to AI SDK's behavior. */
  maxRetries?: number;
};

/**
 * Generic AI SDK embedder adapter.
 *
 * Consumers can pass any AI SDK text embedding model here; provider selection,
 * keys, base URLs, and gateway-specific behavior stay with the model factory.
 */
export function createAiSdkEmbedder(
  options: CreateAiSdkEmbedderOptions,
): Embedder {
  return async (texts: string[]) => {
    const { embedMany } = await import("ai");
    const { embeddings } = await embedMany({
      model: options.model,
      values: texts,
      maxRetries: options.maxRetries,
    });
    return embeddings;
  };
}
