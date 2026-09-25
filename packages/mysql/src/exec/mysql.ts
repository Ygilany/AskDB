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
 * Lazily resolve the optional `mysql2` peer dependency. Mirrors the pattern in
 * `@askdb/postgres` so consumers with a custom `CatalogQueryRunner` can use
 * `@askdb/mysql` without installing `mysql2`.
 */
const mysql2Loader = createOptionalDriverLoader<typeof import("mysql2/promise")>({
  packageName: "mysql2",
  specifier: "mysql2/promise",
  importDriver: () => import("mysql2/promise"),
  missingMessage: missingDriverMessage({ engine: "MySQL", packageName: "mysql2" }),
});

/** @internal exposed for tests that need to reset the lazy `mysql2` cache. */
export function __resetMysql2ModuleCacheForTests(): void {
  mysql2Loader.reset();
}

type Mysql2DriverModule = typeof import("mysql2/promise");

/**
 * Resolve and cache the optional `mysql2` peer driver, with the same lazy-import
 * + project-root fallback behavior as the catalog runner.
 */
export async function loadMysql2Driver(options?: DriverLoadOptions): Promise<Mysql2DriverModule> {
  const mod = await mysql2Loader.load(options);
  return (mod as unknown as { default?: Mysql2DriverModule }).default ?? mod;
}

export function isMysql2DriverInstalled(options?: DriverLoadOptions): boolean {
  return isDriverInstalled("mysql2", options);
}

async function runMysqlCatalogQuery(
  connectionString: string,
  sql: string,
  params: ReadonlyArray<unknown> | undefined,
  options?: DriverLoadOptions,
): Promise<CatalogQueryResult> {
  const mod = await mysql2Loader.load(options);
  const mysql = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const connection = await mysql.createConnection(connectionString);
  try {
    // information_schema is read-only by construction; we still force-disable
    // the multi-statement protocol via mysql2 defaults and don't open a tx.
    const [rows, fields] = (await connection.query(
      sql,
      params ? (params as unknown[]) : undefined,
    )) as [Array<Record<string, unknown>>, Array<{ name: string }>];
    const columns = (fields ?? []).map((f) => f.name);
    const rowList = Array.isArray(rows) ? rows : [];
    const data = rowList.map((row) => columns.map((c) => row[c] ?? null));
    return { columns, rows: data };
  } catch (e) {
    if (e instanceof AskDbError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new AskDbError(`MySQL catalog query failed: ${message}`, e);
  } finally {
    await connection.end();
  }
}

/**
 * Build the built-in `mysql2`-backed catalog query runner used by live MySQL
 * introspection. The connection string follows the standard MySQL URI form
 * (`mysql://user:pass@host:port/database`); the named database is the target
 * namespace for introspection.
 */
export function createMysqlCatalogQueryRunner(
  connectionString: string,
  options?: DriverLoadOptions,
): CatalogQueryRunner {
  return (sql, params) => runMysqlCatalogQuery(connectionString, sql, params, options);
}
