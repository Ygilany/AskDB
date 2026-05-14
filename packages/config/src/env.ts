/**
 * Read `process.env[name]`. Throws if missing or empty (after trim).
 * Mirrors the ergonomics of Prisma's `env()` helper from `prisma/config`.
 */
export function env(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Set it in your .env file (or your shell environment) before loading askdb.config.`,
    );
  }
  return raw;
}

/**
 * Read `process.env[name]`. When missing or empty, returns `defaultValue`.
 * Use for template `askdb.config.ts` values so the file can load in CI or fresh clones
 * before a `.env` exists; switch to {@link env} when you want fail-fast instead.
 */
export function optionalEnv(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  return raw.trim();
}
