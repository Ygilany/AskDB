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
let pgModulePromise: Promise<typeof import("pg")> | undefined;

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

async function importOptionalPg(): Promise<typeof import("pg")> {
  try {
    return await import("pg");
  } catch (cause) {
    if (!isModuleResolutionFailure(cause, "pg")) throw cause;

    const projectRequire = createRequire(join(process.cwd(), "package.json"));
    try {
      const resolved = projectRequire.resolve("pg");
      return (await import(pathToFileURL(resolved).href)) as typeof import("pg");
    } catch (projectCause) {
      if (!isModuleResolutionFailure(projectCause, "pg")) throw projectCause;
      throw new AggregateError([cause, projectCause], "Unable to resolve optional `pg` peer dependency");
    }
  }
}

async function loadPgOrThrow(): Promise<typeof import("pg")> {
  if (!pgModulePromise) {
    pgModulePromise = importOptionalPg().catch((cause) => {
      pgModulePromise = undefined;
      throw new AskDbError(
        "The built-in Postgres catalog query runner requires the optional `pg` peer dependency. " +
          "Install it in your project (e.g. `pnpm add pg`) or include it in the same one-off command " +
          "(e.g. `pnpm dlx -p askdb -p pg askdb ...` or `npx -p askdb -p pg askdb ...`). " +
          "You can also pass a custom catalog query runner to the Postgres connector.",
        cause,
      );
    });
  }
  return pgModulePromise;
}

/**
 * @internal exposed for tests that need to reset the lazy `pg` cache between cases.
 */
export function __resetPgModuleCacheForTests(): void {
  pgModulePromise = undefined;
}

async function runPostgresCatalogQuery(
  connectionString: string,
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<CatalogQueryResult> {
  const mod = await loadPgOrThrow();
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
export function createPostgresCatalogQueryRunner(connectionString: string): CatalogQueryRunner {
  return (sql, params) => runPostgresCatalogQuery(connectionString, sql, params);
}
