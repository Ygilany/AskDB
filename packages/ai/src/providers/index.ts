import { anthropicBuiltin } from "./anthropic.js";
import { azureBuiltin } from "./azure.js";
import { gatewayBuiltin } from "./gateway.js";
import { googleBuiltin } from "./google.js";
import { openaiBuiltin } from "./openai.js";
import type { BuiltinAiProvider } from "./types.js";

/**
 * Every provider built into `@askdb/ai`, in display order. This table is the
 * single source of truth for provider names, aliases, default models, native
 * env vars, the SDK package to install, and setup hints. `createAiRegistry()`
 * with no arguments registers all of them. Each provider loads its SDK only
 * when it first builds a model, so registering all of them costs nothing
 * until one is used.
 *
 * To add a provider: add a file next to this one and a row here (see
 * `.agents/skills/new-ai-adapter/SKILL.md`).
 */
export const BUILTIN_AI_PROVIDERS: readonly BuiltinAiProvider[] = [
  openaiBuiltin,
  anthropicBuiltin,
  googleBuiltin,
  azureBuiltin,
  gatewayBuiltin,
];

/** Canonical names of the built-in providers (no aliases), e.g. `"openai"`. */
export const BUILTIN_AI_PROVIDER_NAMES: readonly string[] = BUILTIN_AI_PROVIDERS.map(
  (row) => row.provider,
);

/**
 * Looks up a built-in provider by canonical name or alias (case-insensitive,
 * trimmed). Returns `undefined` for anything that isn't built in.
 */
export function findBuiltinAiProvider(nameOrAlias: string): BuiltinAiProvider | undefined {
  const key = nameOrAlias.toLowerCase().trim();
  return BUILTIN_AI_PROVIDERS.find(
    (row) => row.provider === key || row.aliases.includes(key),
  );
}

export type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";
export { anthropicProvider } from "./anthropic.js";
export { azureProvider } from "./azure.js";
export { gatewayProvider } from "./gateway.js";
export { googleProvider } from "./google.js";
export { openaiProvider } from "./openai.js";
export { optionalPeerMissingMessage } from "./optional-peer.js";
