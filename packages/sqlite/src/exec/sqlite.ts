import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import {
  createOptionalDriverLoader,
  isDriverInstalled,
  missingDriverMessage,
  type DriverLoadOptions,
} from "@askdb/introspect/kit";
// `@types/better-sqlite3` ships an `export =` declaration: the default import
// IS the constructor. `typeof DatabaseCtor` gives us the constructor type;
// the dynamic `import()` returns a namespace whose `.default` is that ctor.
import type DatabaseCtor from "better-sqlite3";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

type Bs3Namespace = { default: typeof DatabaseCtor };
export type { Bs3Namespace };

const bs3Loader = createOptionalDriverLoader<Bs3Namespace>({
  packageName: "better-sqlite3",
  importDriver: async () => (await import("better-sqlite3")) as unknown as Bs3Namespace,
  missingMessage: missingDriverMessage({ engine: "SQLite", packageName: "better-sqlite3" }),
});

/**
 * Resolve and cache the optional `better-sqlite3` peer driver, with the same
 * lazy-import + project-root fallback behavior as the catalog runner.
 */
export async function loadBetterSqlite3Driver(options?: DriverLoadOptions): Promise<Bs3Namespace> {
  return bs3Loader.load(options);
}

export function isBetterSqlite3DriverInstalled(options?: DriverLoadOptions): boolean {
  return isDriverInstalled("better-sqlite3", options);
}

async function runSqliteCatalogQuery(
  filename: string,
  sql: string,
  params: ReadonlyArray<unknown> | undefined,
  options?: DriverLoadOptions,
): Promise<CatalogQueryResult> {
  const mod = await bs3Loader.load(options);
  const Database = mod.default;
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(sql);
    // better-sqlite3 returns rows as objects keyed by column alias; raw mode
    // gives us [row[]] which is closer to our CatalogQueryResult shape.
    stmt.raw(true);
    const data = params && params.length > 0 ? stmt.all(...(params as unknown[])) : stmt.all();
    const columnInfo: ReadonlyArray<{ name: string }> = stmt.columns();
    const columns = columnInfo.map((c) => c.name);
    const rows = (data as unknown[][]).map((row) => row.map((v) => (v === undefined ? null : v)));
    return { columns, rows };
  } catch (e) {
    if (e instanceof AskDbError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new AskDbError(`SQLite catalog query failed: ${message}`, e);
  } finally {
    db.close();
  }
}

/**
 * Build the built-in `better-sqlite3`-backed catalog query runner used by live
 * SQLite introspection. `filename` is a path to a `.db` / `.sqlite` file (or
 * `:memory:` for an empty DB; useful only in tests). The DB is opened readonly.
 */
export function createSqliteCatalogQueryRunner(
  filename: string,
  options?: DriverLoadOptions,
): CatalogQueryRunner {
  return (sql, params) => runSqliteCatalogQuery(filename, sql, params, options);
}
