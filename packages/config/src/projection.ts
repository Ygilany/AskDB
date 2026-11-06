import type { AskDbConfig } from "./types.js";
import { resolveAskDbConfig } from "./resolve.js";

export const ASKDB_ENV_PROJECTION = Symbol.for("askdb.envProjection");

export type AskDbEnvProjection = {
  readonly [ASKDB_ENV_PROJECTION]: true;
  /** Nested config as authored (same reference passed to {@link defineConfig}). */
  readonly config: AskDbConfig;
  readonly entries: Readonly<Record<string, string>>;
  /**
   * One message per deprecated key `config` uses. {@link bootstrapAskDbEnv} emits each as a
   * `DeprecationWarning`. Absent on projections built by an older `@askdb/config`.
   */
  readonly deprecations?: readonly string[];
};

/**
 * Checks a nested {@link AskDbConfig} and wraps it with its canonical env keys, for `bootstrapAskDbEnv`
 * to install. Use TypeScript’s `satisfies AskDbConfig` on the object so excess or mistyped keys fail
 * at compile time while literals stay narrow, e.g.:
 *
 * ```ts
 * export default defineConfig({
 *   ai: {
 *     provider: "openai",
 *     providerConfig: { openai: { apiKey: env("OPENAI_API_KEY") } },
 *     language: { model: "gpt-4o-mini" },
 *   },
 *   // ...
 * } satisfies AskDbConfig);
 * ```
 *
 * Throws an `askdb.config: …` error for a config that can't load.
 */
export function defineConfig<const T extends AskDbConfig>(config: T): AskDbEnvProjection {
  const { flat, deprecations } = resolveAskDbConfig(config);
  return {
    [ASKDB_ENV_PROJECTION]: true,
    config,
    entries: flat,
    deprecations,
  };
}

/**
 * Flattens a nested {@link AskDbConfig} into the canonical env keys of the runtime snapshot
 * (`AskDbEnvProjection.entries`), for example to build a child process's env. Most optional keys are
 * written only when the config sets them, so defaults such as the HTTP port stay out of the env;
 * `ASKDB_RAG_EMBEDDER`, `ASKDB_INTROSPECT_OUT` and, with the pgvector store,
 * `ASKDB_PGVECTOR_INDEX_STRATEGY` and the mock embedder's `ASKDB_RAG_EMBEDDER_DIMENSIONS` are always
 * written. Throws the same `askdb.config: …` errors as `defineConfig`.
 */
export function flattenAskDbConfig(config: AskDbConfig): Record<string, string> {
  return resolveAskDbConfig(config).flat;
}

export function isAskDbEnvProjection(value: unknown): value is AskDbEnvProjection {
  return (
    typeof value === "object" &&
    value !== null &&
    ASKDB_ENV_PROJECTION in value &&
    value[ASKDB_ENV_PROJECTION] === true &&
    "entries" in value &&
    typeof value.entries === "object" &&
    value.entries !== null &&
    "config" in value &&
    typeof value.config === "object" &&
    value.config !== null
  );
}
