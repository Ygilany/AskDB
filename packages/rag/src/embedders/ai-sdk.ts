import type { EmbeddingModel } from "ai";
import type { Embedder } from "../types.js";

export type AiSdkProviderOptionValue =
  | string
  | number
  | boolean
  | null
  | AiSdkProviderOptionValue[]
  | { [key: string]: AiSdkProviderOptionValue };

export type AiSdkProviderOptions = Record<
  string,
  Record<string, AiSdkProviderOptionValue>
>;

export type CreateAiSdkEmbedderOptions = {
  model: EmbeddingModel;
  /** Maximum retries per AI SDK embedding call. Defaults to AI SDK's behavior. */
  maxRetries?: number;
  /** Provider-specific embedding call options forwarded to the AI SDK. */
  providerOptions?: AiSdkProviderOptions;
  /** Called with provider-reported token usage for each embedding request when available. */
  onUsage?: (usage: AiSdkEmbedderUsage) => void;
};

export type AiSdkEmbedderUsage = {
  tokens?: number;
  promptTokens?: number;
  totalTokens?: number;
};

export type AiSdkEmbedderIdOptions = {
  /** The AI provider adapter's canonical name, such as `openai` or `azure` (`foundry` resolves to `azure`). */
  provider: string;
  /** The embedding model, or the deployment name on Azure. */
  model: string;
  /** The width requested from the model; omit it when the model's own width applies. */
  dimensions?: number;
};

/**
 * The `embedderId` an index records when it's embedded through an AI SDK embedding model built
 * from an AskDB `ai.embedding` section: `ai-sdk:<provider>:<model>:<dimensions>`, ending in
 * `default` when no width was requested. Studio and `askdb rag` both build their ids with it, so
 * either accepts an index the other built.
 */
export function aiSdkEmbedderId(options: AiSdkEmbedderIdOptions): string {
  return `ai-sdk:${options.provider}:${options.model}:${options.dimensions ?? "default"}`;
}

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
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
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
