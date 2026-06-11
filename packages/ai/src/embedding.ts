import type { EmbeddingModel } from "ai";
import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";
import type { CreateEmbeddingModelOptions } from "./provider.js";

type EmbeddingModelV3 = Parameters<typeof wrapEmbeddingModel>[0]["model"];

/**
 * Wraps an embedding model so `dimensions`/`user` are forwarded as
 * provider options under `providerKey`. Returns the model unchanged when
 * no options are set.
 */
export function withEmbeddingProviderOptions(
  model: EmbeddingModelV3,
  providerKey: string,
  options: CreateEmbeddingModelOptions = {},
): EmbeddingModel {
  const settings: { dimensions?: number; user?: string } = {};
  if (options.dimensions !== undefined) settings.dimensions = options.dimensions;
  if (options.user !== undefined) settings.user = options.user;
  if (Object.keys(settings).length === 0) return model;
  return wrapEmbeddingModel({
    model,
    middleware: defaultEmbeddingSettingsMiddleware({
      settings: { providerOptions: { [providerKey]: settings } },
    }),
  });
}
