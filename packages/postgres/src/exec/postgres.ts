import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import {
  createOptionalDriverLoader,
  isDriverInstalled,
  missingDriverMessage,
  type DriverLoadOptions,
} from "@askdb/introspect/kit";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

/**
 * Lazily resolve the optional `pg` peer dependency. `pg` is intentionally NOT imported at the
 * top of this module — `pg` is an optional peer of `@askdb/postgres`, so consumers who only use
 * a custom `CatalogQueryRunner` must be able to import `@askdb/postgres` (for the dialect or
 * connector) without having `pg` installed. The cost of the missing peer is paid only when the
 * built-in catalog query runner is actually invoked.
 *
 * Result is cached so repeated calls don't re-resolve. On a missing peer we clear the cache so
 * the next call retries (e.g. after the consumer runs `pnpm add pg`).
 */
const pgLoader = createOptionalDriverLoader<typeof import("pg")>({
  packageName: "pg",
  importDriver: () => import("pg"),
  missingMessage: missingDriverMessage({ engine: "Postgres", packageName: "pg" }),
});

/**
 * @internal exposed for tests that need to reset the lazy `pg` cache between cases.
 */
export function __resetPgModuleCacheForTests(): void {
  pgLoader.reset();
}

type PgDriverModule = typeof import("pg");

/**
 * Resolve and cache the optional `pg` peer driver, with the same lazy-import
 * + project-root fallback behavior as the catalog runner. Exposed for embedders
 * (e.g. `@askdb/studio`'s execute registry) that need direct driver access for
 * UI-layer concerns like timing, truncation, or SQL placeholder rewriting.
 *
 * Throws an AskDbError with install hints when the peer is missing.
 */
export async function loadPgDriver(options?: DriverLoadOptions): Promise<PgDriverModule> {
  const mod = await pgLoader.load(options);
  return (mod as unknown as { default?: PgDriverModule }).default ?? mod;
}

export function isPgDriverInstalled(options?: DriverLoadOptions): boolean {
  return isDriverInstalled("pg", options);
}

async function runPostgresCatalogQuery(
  connectionString: string,
  sql: string,
  params: ReadonlyArray<unknown> | undefined,
  options?: DriverLoadOptions,
): Promise<CatalogQueryResult> {
  const mod = await pgLoader.load(options);
  // `pg` is CJS — Node's ESM interop puts the namespace under `.default` at runtime, but the
  // static type doesn't model that. Reach for `default` defensively, then fall back to the
  // top-level namespace for bundlers that hoist the CJS named exports.
  const pgRuntime = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const pool = new pgRuntime.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const res =
      params && params.length > 0
        ? await client.query<{ [k: string]: unknown }>(sql, params as unknown[])
        : await client.query<{ [k: string]: unknown }>(sql);
    await client.query("COMMIT");
    const fields = res.fields ?? [];
    const columns = fields.map((f) => f.name);
    const rows = res.rows.map((row) => fields.map((f) => row[f.name]));
    return { columns, rows };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    if (e instanceof AskDbError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new AskDbError(`PostgreSQL catalog query failed: ${message}`, e);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Build the built-in `pg`-backed catalog query runner used by live Postgres introspection.
 *
 * Each invocation runs connector-owned catalog SQL inside a fresh connection's
 * `BEGIN READ ONLY` transaction.
 *
 * The factory itself is synchronous and does NOT load `pg`. The peer dependency is resolved
 * the first time the returned runner is invoked; if `pg` is not installed, the runner
 * rejects with a helpful {@link AskDbError} pointing the consumer at install or BYO recipes.
 */
export function createPostgresCatalogQueryRunner(
  connectionString: string,
  options?: DriverLoadOptions,
): CatalogQueryRunner {
  return (sql, params) => runPostgresCatalogQuery(connectionString, sql, params, options);
}
