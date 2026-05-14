/**
 * Read `process.env[name]`. Returns `undefined` when missing or blank (after trim).
 * Use in `askdb.config.*` for every env-backed value; {@link flattenAskDbConfig} supplies defaults.
 */
export function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return raw.trim();
}

/**
 * Read `process.env[name]`. Throws if missing or empty (after trim).
 * For programmatic / non-config callers that need fail-fast semantics.
 */
export function requiredEnv(name: string): string {
  const v = env(name);
  if (v === undefined) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Set it in your .env file (or your shell environment) before using this code path.`,
    );
  }
  return v;
}

/**
 * Returns the current runtime environment (`process.env`).
 *
 * `@askdb/config` is the **only** package that reads `process.env` directly.
 * All other packages that need to pass a full env map to library functions (for example
 * `@askdb/core`'s `resolveAskDbAiConfig`) must obtain it through this helper rather than
 * referencing `process.env` themselves. This keeps `process.env` access centralised and
 * makes it easy to replace or augment the runtime env in future (e.g. for testing shims).
 *
 * First-party apps call {@link bootstrapAskDbEnv} (which loads `.env` and merges
 * `askdb.config.*`) **before** calling this helper so that all canonical env keys are
 * already populated.
 */
export function getAskDbRuntimeEnv(): NodeJS.ProcessEnv {
  return process.env;
}
