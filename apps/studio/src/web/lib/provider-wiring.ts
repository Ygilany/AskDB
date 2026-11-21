/** How a "Get the code" snippet builds a model for one provider when it calls `ask()` directly. */
export type ProviderWiring = {
  /** AI SDK package the host installs; `@askdb/ai` loads it lazily for the config-driven path. */
  sdkPackage: string;
  sdkImport: string;
  sdkModel: (model: string) => string;
};

/**
 * One entry per provider built into `@askdb/ai`. Studio's browser bundle can't import
 * `@askdb/ai`, so the table is kept here; `apps/studio/src/provider-wiring.test.ts` fails
 * when a built-in provider or alias has no entry, or an entry names the wrong SDK package.
 */
export const PROVIDER_WIRING: Record<string, ProviderWiring> = {
  openai: {
    sdkPackage: "@ai-sdk/openai",
    sdkImport: "openai",
    sdkModel: (model) => `openai(${JSON.stringify(model)})`,
  },
  anthropic: {
    sdkPackage: "@ai-sdk/anthropic",
    sdkImport: "anthropic",
    sdkModel: (model) => `anthropic(${JSON.stringify(model)})`,
  },
  google: {
    sdkPackage: "@ai-sdk/google",
    sdkImport: "google",
    sdkModel: (model) => `google(${JSON.stringify(model)})`,
  },
  azure: {
    sdkPackage: "@ai-sdk/azure",
    sdkImport: "azure",
    sdkModel: (model) => `azure(${JSON.stringify(model)}) // your deployment name`,
  },
  gateway: {
    sdkPackage: "ai",
    sdkImport: "gateway",
    sdkModel: (model) => `gateway(${JSON.stringify(model)})`,
  },
};

/** Alias ids that share another provider's wiring. */
export const PROVIDER_WIRING_ALIASES: Record<string, string> = {
  foundry: "azure",
  "azure-openai": "azure",
};

/** The wiring for a provider id or alias, or `undefined` when Studio has none for it. */
export function providerWiring(aiProvider: string): ProviderWiring | undefined {
  const id = PROVIDER_WIRING_ALIASES[aiProvider] ?? aiProvider;
  return Object.hasOwn(PROVIDER_WIRING, id) ? PROVIDER_WIRING[id] : undefined;
}
