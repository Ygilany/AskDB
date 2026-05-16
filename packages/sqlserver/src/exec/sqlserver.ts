import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

// `mssql` is CJS with named exports; the runtime namespace and the type-time
// namespace agree (no `export =` quirk).
type MssqlModule = typeof import("mssql");

/**
 * Lazily resolve the optional `mssql` peer dependency. Mirrors the lazy-load
 * pattern in `@askdb/postgres` / `@askdb/mysql` so consumers with a custom
 * `CatalogQueryRunner` can import `@askdb/sqlserver` without `mssql` installed.
 */
let mssqlModulePromise: Promise<MssqlModule> | undefined;

async function loadMssqlOrThrow(): Promise<MssqlModule> {
  if (!mssqlModulePromise) {
    mssqlModulePromise = import("mssql").catch((cause) => {
      mssqlModulePromise = undefined;
      throw new AskDbError(
        "The built-in SQL Server catalog query runner requires the optional `mssql` peer dependency. " +
          "Install it (e.g. `pnpm add mssql`) or pass a custom catalog query runner to the SQL Server connector.",
        cause,
      );
    });
  }
  return mssqlModulePromise;
}

/** @internal exposed for tests that need to reset the lazy `mssql` cache. */
export function __resetMssqlModuleCacheForTests(): void {
  mssqlModulePromise = undefined;
}

async function runSqlServerCatalogQuery(
  connectionString: string,
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<CatalogQueryResult> {
  const mod = await loadMssqlOrThrow();
  const mssql = (mod as unknown as { default?: MssqlModule }).default ?? mod;
  const pool = new mssql.ConnectionPool(connectionString);
  await pool.connect();
  try {
    const request = pool.request();
    // The connector currently issues only literal SQL (no parameters); honour
    // optional params via positional binding in case a custom caller plugs in.
    if (params) {
      for (let i = 0; i < params.length; i++) {
        request.input(`p${i}`, params[i] as never);
      }
    }
    const result = await request.query<Record<string, unknown>>(sql);
    const rows = result.recordset ?? [];
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    const data = rows.map((row) => columns.map((c) => (row[c] === undefined ? null : row[c])));
    return { columns, rows: data };
  } catch (e) {
    if (e instanceof AskDbError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new AskDbError(`SQL Server catalog query failed: ${message}`, e);
  } finally {
    await pool.close();
  }
}

/**
 * Build the built-in `mssql`-backed catalog query runner used by live SQL
 * Server introspection. `connectionString` follows the standard mssql URI
 * (`mssql://user:pass@host:port/database`) or the Server=...; format.
 */
export function createSqlServerCatalogQueryRunner(connectionString: string): CatalogQueryRunner {
  return (sql, params) => runSqlServerCatalogQuery(connectionString, sql, params);
}
