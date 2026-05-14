import type { AskDbConfig } from "./types.js";
import { flattenAskDbConfig } from "./flatten.js";

export const ASKDB_ENV_PROJECTION = Symbol.for("askdb.envProjection");

export type AskDbEnvProjection = {
  readonly [ASKDB_ENV_PROJECTION]: true;
  readonly entries: Readonly<Record<string, string>>;
};

/**
 * Wraps a nested {@link AskDbConfig} for bootstrap merge. Check the object with TypeScript’s
 * `satisfies AskDbConfig` so excess or mistyped keys fail at compile time while literals stay narrow, e.g.:
 *
 * ```ts
 * export default defineConfig({
 *   ai: { provider: "openai", providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } } },
 *   // ...
 * } satisfies AskDbConfig);
 * ```
 */
export function defineConfig<const T extends AskDbConfig>(config: T): AskDbEnvProjection {
  return {
    [ASKDB_ENV_PROJECTION]: true,
    entries: flattenAskDbConfig(config),
  };
}

export function isAskDbEnvProjection(value: unknown): value is AskDbEnvProjection {
  return (
    typeof value === "object" &&
    value !== null &&
    ASKDB_ENV_PROJECTION in value &&
    (value as AskDbEnvProjection)[ASKDB_ENV_PROJECTION] === true &&
    typeof (value as AskDbEnvProjection).entries === "object" &&
    (value as AskDbEnvProjection).entries !== null
  );
}
