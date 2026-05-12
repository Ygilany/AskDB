import type { Embedder } from "../types.js";
import { createAiSdkEmbedder } from "./ai-sdk.js";

export type CreateOpenAiEmbedderOptions = {
  /** Defaults to `text-embedding-3-small`. */
  model?: string;
  /** Optional override; otherwise the OpenAI provider reads `OPENAI_API_KEY`. */
  apiKey?: string;
  /** Optional OpenAI-compatible base URL, e.g. an AI gateway ending in `/v1`. */
  baseURL?: string;
  /** Optional dimensionality override for text-embedding-3 models. */
  dimensions?: number;
  /** Optional end-user id forwarded to OpenAI embedding settings. */
  user?: string;
};

/**
 * Reference AI SDK embedder for OpenAI embeddings.
 *
 * `ai` and `@ai-sdk/openai` are optional peers of `@askdb/rag`; this helper
 * lazy-loads them so chunking and non-OpenAI stores remain zero-provider.
 */
export function createOpenAiEmbedder(
  options: CreateOpenAiEmbedderOptions = {},
): Embedder {
  return async (texts: string[]) => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const provider = createOpenAI({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    const embedder = createAiSdkEmbedder({
      model: provider.embedding(options.model ?? "text-embedding-3-small", {
        dimensions: options.dimensions,
        user: options.user,
      }),
    });
    return embedder(texts);
  };
}
