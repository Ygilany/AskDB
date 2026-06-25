import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

/**
 * Lazily resolve the optional `mysql2` peer dependency. Mirrors the pattern in
 * `@askdb/postgres` so consumers with a custom `CatalogQueryRunner` can use
 * `@askdb/mysql` without installing `mysql2`.
 */
let mysql2ModulePromise: Promise<typeof import("mysql2/promise")> | undefined;

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

async function importOptionalMysql2(): Promise<typeof import("mysql2/promise")> {
  try {
    return await import("mysql2/promise");
  } catch (cause) {
    if (!isModuleResolutionFailure(cause, "mysql2")) throw cause;

    const projectRequire = createRequire(join(process.cwd(), "package.json"));
    try {
      const resolved = projectRequire.resolve("mysql2/promise");
      return (await import(pathToFileURL(resolved).href)) as typeof import("mysql2/promise");
    } catch (projectCause) {
      if (!isModuleResolutionFailure(projectCause, "mysql2")) throw projectCause;
      throw new AggregateError(
        [cause, projectCause],
        "Unable to resolve optional `mysql2` peer dependency",
      );
    }
  }
}

async function loadMysql2OrThrow(): Promise<typeof import("mysql2/promise")> {
  if (!mysql2ModulePromise) {
    mysql2ModulePromise = importOptionalMysql2().catch((cause) => {
      mysql2ModulePromise = undefined;
      throw new AskDbError(
        "The built-in MySQL catalog query runner requires the optional `mysql2` peer dependency. " +
          "Install it in your project (e.g. `pnpm add mysql2`) or include it in the same one-off command " +
          "(e.g. `pnpm dlx -p askdb -p mysql2 askdb ...` or `npx -p askdb -p mysql2 askdb ...`). " +
          "You can also pass a custom catalog query runner to the MySQL connector.",
        cause,
      );
    });
  }
  return mysql2ModulePromise;
}

/** @internal exposed for tests that need to reset the lazy `mysql2` cache. */
export function __resetMysql2ModuleCacheForTests(): void {
  mysql2ModulePromise = undefined;
}

async function runMysqlCatalogQuery(
  connectionString: string,
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<CatalogQueryResult> {
  const mod = await loadMysql2OrThrow();
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
export function createMysqlCatalogQueryRunner(connectionString: string): CatalogQueryRunner {
  return (sql, params) => runMysqlCatalogQuery(connectionString, sql, params);
}
