import type { AskDbConfig } from "./types.js";
import { flattenNormalizedAskDbConfig } from "./flatten.js";
import { normalizeAskDbConfig } from "./normalize.js";

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
 * Wraps a nested {@link AskDbConfig} for bootstrap merge. Check the object with TypeScript’s
 * `satisfies AskDbConfig` so excess or mistyped keys fail at compile time while literals stay narrow, e.g.:
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
  const { config: normalized, deprecations } = normalizeAskDbConfig(config);
  return {
    [ASKDB_ENV_PROJECTION]: true,
    config,
    entries: flattenNormalizedAskDbConfig(normalized),
    deprecations,
  };
}

export function isAskDbEnvProjection(value: unknown): value is AskDbEnvProjection {
  return (
    typeof value === "object" &&
    value !== null &&
    ASKDB_ENV_PROJECTION in value &&
    (value as AskDbEnvProjection)[ASKDB_ENV_PROJECTION] === true &&
    typeof (value as AskDbEnvProjection).entries === "object" &&
    (value as AskDbEnvProjection).entries !== null &&
    "config" in value &&
    typeof (value as AskDbEnvProjection).config === "object" &&
    (value as AskDbEnvProjection).config !== null
  );
}
