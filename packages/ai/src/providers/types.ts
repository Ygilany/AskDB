import type { AiProviderAdapter, ProviderEnvSpec } from "../provider.js";

/** A built-in provider's native env vars. Built-ins always have a default language model. */
export type BuiltinProviderEnvSpec = ProviderEnvSpec & { defaultModel: string };

/**
 * One row of the built-in provider table ({@link BUILTIN_AI_PROVIDERS}).
 * This is the single source of truth for which providers `@askdb/ai` ships,
 * what they are called, which SDK package each needs, and which env vars and
 * defaults they use. First-party surfaces (CLI `init`, Studio setup, error
 * messages) derive their provider lists from it.
 */
export type BuiltinAiProvider = {
  /** Canonical `ASKDB_AI_PROVIDER` / `ai.provider` value. */
  provider: string;
  /** Human-readable name for pickers and messages. */
  label: string;
  /** Additional `ASKDB_AI_PROVIDER` values that select this provider. */
  aliases: readonly string[];
  /** Display names for aliases that users pick as a distinct product (e.g. `foundry`). */
  aliasLabels?: Readonly<Record<string, string>>;
  /**
   * The AI SDK package this provider loads lazily — an optional peer
   * dependency of `@askdb/ai` the host app must install. `undefined` when the
   * provider ships with `ai` itself (the Vercel AI Gateway).
   */
  peerPackage: string | undefined;
  /** Native env vars and defaults, as consumed by `resolveBaseConfig`. */
  env: BuiltinProviderEnvSpec;
  /** Whether the provider offers an embeddings API. */
  embeddings: boolean;
  /** Setup hint shown when no API key is configured (same as `adapter.configHint`). */
  configHint: string;
  /** The adapter registered by `createAiRegistry()`. */
  adapter: AiProviderAdapter;
};
