import type { EmbeddingModel, JSONValue } from "ai";
import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";
import type { CreateEmbeddingModelOptions } from "./provider.js";

type EmbeddingModelV3 = Parameters<typeof wrapEmbeddingModel>[0]["model"];

/** Forwards `dimensions`/`user` under those names, as OpenAI-style embedding APIs read them. */
function sameNameSettings({ dimensions, user }: CreateEmbeddingModelOptions): Record<string, JSONValue | undefined> {
  return { dimensions, user };
}

/**
 * Wraps an embedding model so AskDB's portable embedding options are sent as
 * provider options under `providerKey`. `toSettings` maps them to the
 * provider's own setting names (default: `dimensions` and `user` as-is);
 * settings it leaves `undefined` are dropped. Returns the model unchanged when
 * no settings remain.
 */
export function withEmbeddingProviderOptions(
  model: EmbeddingModelV3,
  providerKey: string,
  options: CreateEmbeddingModelOptions = {},
  toSettings: (options: CreateEmbeddingModelOptions) => Record<string, JSONValue | undefined> = sameNameSettings,
): EmbeddingModel {
  const settings: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(toSettings(options))) {
    if (value !== undefined) settings[key] = value;
  }
  if (Object.keys(settings).length === 0) return model;
  return wrapEmbeddingModel({
    model,
    middleware: defaultEmbeddingSettingsMiddleware({
      settings: { providerOptions: { [providerKey]: settings } },
    }),
  });
}
