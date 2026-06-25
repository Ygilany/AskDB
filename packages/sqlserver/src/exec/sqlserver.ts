import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

async function importOptionalMssql(): Promise<MssqlModule> {
  try {
    return await import("mssql");
  } catch (cause) {
    if (!isModuleResolutionFailure(cause, "mssql")) throw cause;

    const projectRequire = createRequire(join(process.cwd(), "package.json"));
    try {
      const resolved = projectRequire.resolve("mssql");
      return (await import(pathToFileURL(resolved).href)) as MssqlModule;
    } catch (projectCause) {
      if (!isModuleResolutionFailure(projectCause, "mssql")) throw projectCause;
      throw new AggregateError([cause, projectCause], "Unable to resolve optional `mssql` peer dependency");
    }
  }
}

async function loadMssqlOrThrow(): Promise<MssqlModule> {
  if (!mssqlModulePromise) {
    mssqlModulePromise = importOptionalMssql().catch((cause) => {
      mssqlModulePromise = undefined;
      throw new AskDbError(
        "The built-in SQL Server catalog query runner requires the optional `mssql` peer dependency. " +
          "Install it in your project (e.g. `pnpm add mssql`) or include it in the same one-off command " +
          "(e.g. `pnpm dlx -p askdb -p mssql askdb ...` or `npx -p askdb -p mssql askdb ...`). " +
          "You can also pass a custom catalog query runner to the SQL Server connector.",
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
