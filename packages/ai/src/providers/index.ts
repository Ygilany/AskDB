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

/** What a setup wizard needs to scaffold `askdb.config.*` for one built-in provider id or alias. */
export type BuiltinAiProviderSetup = {
  /** The id as given (e.g. `"foundry"`), used for `ai.provider` / `providerConfig.<id>`. */
  id: string;
  /** Display name, honoring alias labels (e.g. "Azure AI Foundry"). */
  label: string;
  /** Conventional env var for the API key (the provider's primary native var). */
  keyEnv: string;
  /** Conventional env var for the model; `ASKDB_AI_MODEL` when the provider has no native one. */
  modelEnv: string;
  /** SDK package the host must install, or `undefined` when it ships with `ai`. */
  peerPackage: string | undefined;
};

/**
 * Setup defaults for a built-in provider id or alias, derived from
 * {@link BUILTIN_AI_PROVIDERS}. Returns `undefined` for non-built-in ids.
 */
export function getBuiltinAiProviderSetup(id: string): BuiltinAiProviderSetup | undefined {
  const row = findBuiltinAiProvider(id);
  if (!row) return undefined;
  const key = id.toLowerCase().trim();
  return {
    id: key,
    label: row.aliasLabels?.[key] ?? row.label,
    keyEnv: row.env.apiKeyVars[0]!,
    modelEnv: row.env.modelVars?.[0] ?? "ASKDB_AI_MODEL",
    peerPackage: row.peerPackage,
  };
}

/**
 * Setup options for every id in `ids` that is a built-in provider or alias,
 * in built-in table order (canonical name first, then its aliases). Pass
 * `@askdb/config`'s `ASKDB_AI_PROVIDERS` to get exactly the ids that have an
 * `askdb.config.*` branch.
 */
export function listBuiltinAiProviderSetups(ids: readonly string[]): BuiltinAiProviderSetup[] {
  const wanted = new Set(ids.map((id) => id.toLowerCase().trim()));
  return BUILTIN_AI_PROVIDERS.flatMap((row) => [row.provider, ...row.aliases])
    .filter((id) => wanted.has(id))
    .map((id) => getBuiltinAiProviderSetup(id)!);
}

export type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";
export { anthropicProvider } from "./anthropic.js";
export { azureProvider } from "./azure.js";
export { gatewayProvider } from "./gateway.js";
export { googleProvider } from "./google.js";
export { openaiProvider } from "./openai.js";
export { optionalPeerMissingMessage } from "./optional-peer.js";
