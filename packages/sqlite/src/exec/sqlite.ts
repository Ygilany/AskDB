import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
// `@types/better-sqlite3` ships an `export =` declaration: the default import
// IS the constructor. `typeof DatabaseCtor` gives us the constructor type;
// the dynamic `import()` returns a namespace whose `.default` is that ctor.
import type DatabaseCtor from "better-sqlite3";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

type Bs3Namespace = { default: typeof DatabaseCtor };

/**
 * Lazily resolve the optional `better-sqlite3` peer dependency. Mirrors the
 * pattern in `@askdb/postgres` / `@askdb/mysql` so consumers with a custom
 * `CatalogQueryRunner` can use `@askdb/sqlite` without installing the driver.
 */
let bs3ModulePromise: Promise<Bs3Namespace> | undefined;

async function loadBetterSqlite3OrThrow(): Promise<Bs3Namespace> {
  if (!bs3ModulePromise) {
    bs3ModulePromise = (
      import("better-sqlite3") as unknown as Promise<Bs3Namespace>
    ).catch((cause) => {
      bs3ModulePromise = undefined;
      throw new AskDbError(
        "The built-in SQLite catalog query runner requires the optional `better-sqlite3` peer dependency. " +
          "Install it (e.g. `pnpm add better-sqlite3`) or pass a custom catalog query runner to the SQLite connector.",
        cause,
      );
    });
  }
  return bs3ModulePromise;
}

/** @internal exposed for tests that need to reset the lazy `better-sqlite3` cache. */
export function __resetBetterSqlite3ModuleCacheForTests(): void {
  bs3ModulePromise = undefined;
}

async function runSqliteCatalogQuery(
  filename: string,
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<CatalogQueryResult> {
  const mod = await loadBetterSqlite3OrThrow();
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
export function createSqliteCatalogQueryRunner(filename: string): CatalogQueryRunner {
  return (sql, params) => runSqliteCatalogQuery(filename, sql, params);
}
