import type { EmbeddingModel } from "ai";
import type { Embedder } from "../types.js";

export type CreateAiSdkEmbedderOptions = {
  model: EmbeddingModel<string>;
  /** Maximum retries per AI SDK embedding call. Defaults to AI SDK's behavior. */
  maxRetries?: number;
  /** Called with provider-reported token usage for each embedding request when available. */
  onUsage?: (usage: AiSdkEmbedderUsage) => void;
};

export type AiSdkEmbedderUsage = {
  tokens?: number;
  promptTokens?: number;
  totalTokens?: number;
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
    const result = await embedMany({
      model: options.model,
      values: texts,
      maxRetries: options.maxRetries,
    });
    const usage = normalizeUsage((result as { usage?: unknown }).usage);
    if (usage) options.onUsage?.(usage);
    return result.embeddings;
  };
}

function normalizeUsage(value: unknown): AiSdkEmbedderUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const tokens = readNumber(record.tokens);
  const promptTokens = readNumber(record.promptTokens);
  const totalTokens = readNumber(record.totalTokens);
  if (tokens === undefined && promptTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { tokens, promptTokens, totalTokens };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
