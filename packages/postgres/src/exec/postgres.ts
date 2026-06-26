import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
type DriverLoadOptions = { resolveFrom?: string };

let pgModulePromises = new Map<string | undefined, Promise<typeof import("pg")>>();

function isModuleResolutionFailure(cause: unknown, packageName: string): boolean {
  if (!(cause instanceof Error)) return false;
  const nestedCause = (cause as { cause?: unknown }).cause;
  if (nestedCause && nestedCause !== cause && isModuleResolutionFailure(nestedCause, packageName)) {
    return true;
  }
  const code = (cause as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  return cause.message.includes(packageName);
}

async function importOptionalPg(opts?: DriverLoadOptions): Promise<typeof import("pg")> {
  try {
    return await import("pg");
  } catch (cause) {
    if (!isModuleResolutionFailure(cause, "pg")) throw cause;

    const fromDir = opts?.resolveFrom ?? process.cwd();
    const projectRequire = createRequire(join(fromDir, "package.json"));
    try {
      const resolved = projectRequire.resolve("pg");
      return (await import(pathToFileURL(resolved).href)) as typeof import("pg");
    } catch (projectCause) {
      if (!isModuleResolutionFailure(projectCause, "pg")) throw projectCause;
      throw new AggregateError([cause, projectCause], "Unable to resolve optional `pg` peer dependency");
    }
  }
}

async function loadPgOrThrow(opts?: DriverLoadOptions): Promise<typeof import("pg")> {
  const key = opts?.resolveFrom;
  let promise = pgModulePromises.get(key);
  if (!promise) {
    promise = importOptionalPg(opts).catch((cause) => {
      pgModulePromises.delete(key);
      throw new AskDbError(
        "The built-in Postgres catalog query runner requires the optional `pg` peer dependency. " +
          "Install it in your project (e.g. `pnpm add pg`) or include it in the same one-off command " +
          "(e.g. `pnpm dlx -p askdb -p pg askdb ...` or `npx -p askdb -p pg askdb ...`). " +
          "You can also pass a custom catalog query runner to the Postgres connector.",
        cause,
      );
    });
    pgModulePromises.set(key, promise);
  }
  return promise;
}

/**
 * @internal exposed for tests that need to reset the lazy `pg` cache between cases.
 */
export function __resetPgModuleCacheForTests(): void {
  pgModulePromises.clear();
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
  const mod = await loadPgOrThrow(options);
  return (mod as unknown as { default?: PgDriverModule }).default ?? mod;
}

export function isPgDriverInstalled(options?: DriverLoadOptions): boolean {
  try {
    const req = createRequire(join(options?.resolveFrom ?? process.cwd(), "package.json"));
    req.resolve("pg");
    return true;
  } catch {
    return false;
  }
}

async function runPostgresCatalogQuery(
  connectionString: string,
  sql: string,
  params: ReadonlyArray<unknown> | undefined,
  options?: DriverLoadOptions,
): Promise<CatalogQueryResult> {
  const mod = await loadPgOrThrow(options);
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
