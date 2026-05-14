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
