/**
 * Studio execute-driver registry.
 *
 * Each entry describes a live execute provider — how to dynamically import the
 * driver package, what connection shape it expects, and how to normalize its
 * results into the shared `ExecuteResponse` DTO.
 *
 * Drivers are optional peers. The registry never imports a driver at module
 * load time; every import lives inside an `executeXxx()` function so a missing
 * package only fails when the user actually tries to execute a query.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecuteResponse } from "./shared/api.js";

// ---------------------------------------------------------------------------
// Provider registry shape
// ---------------------------------------------------------------------------

export type StudioExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

export type StudioExecuteInput = {
  connectionString?: string;
  file?: string;
  sql: string;
  params: unknown[];
  /** Absolute path to the user's project root, used for driver resolution. */
  projectRoot: string;
};

export type StudioDriverDefinition = {
  provider: StudioExecuteProvider;
  label: string;
  packageName: "pg" | "mysql2" | "better-sqlite3" | "mssql";
  installCommand: string;
  execute(input: StudioExecuteInput): Promise<ExecuteResponse>;
};

// ---------------------------------------------------------------------------
// Driver resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute entry-point path of a driver package from the user's
 * project root.  Uses `createRequire` so that packages installed in the
 * user's own node_modules are found even when Studio is running from the
 * global npx cache (where bare `import(packageName)` cannot see them).
 *
 * The stub filename passed to `createRequire` never needs to exist on disk —
 * Node only uses its directory as the starting point for resolution.
 */
function resolveDriverPath(packageName: string, projectRoot: string): string | null {
  try {
    const req = createRequire(join(projectRoot, "__stub__.js"));
    return req.resolve(packageName);
  } catch {
    return null;
  }
}

/**
 * Import a driver package resolved from the user's project root.
 * Falls back to a bare import (works when Studio itself has the package)
 * but the project-root resolution path is tried first.
 */
async function importDriver(packageName: string, projectRoot: string): Promise<unknown> {
  const resolved = resolveDriverPath(packageName, projectRoot);
  if (resolved) {
    // Convert the absolute path to a file URL so dynamic import accepts it
    // on all platforms, including Windows.
    return import(pathToFileURL(resolved).href);
  }
  // Last resort: bare specifier (will work if Studio ships the package itself)
  return import(packageName);
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const MAX_ROWS = 500;

function buildOkResponse(
  columns: string[],
  rows: unknown[][],
  rowCount: number,
  durationMs: number,
): ExecuteResponse {
  const truncated = rows.length > MAX_ROWS;
  return {
    ok: true,
    columns,
    rows: rows.slice(0, MAX_ROWS),
    rowCount,
    durationMs,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string): Promise<unknown>;
  query(opts: { text: string; values: unknown[] }): Promise<{
    fields: Array<{ name: string }>;
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
};
type PgMod = { Client: new (opts: { connectionString: string }) => PgClient };

async function executePostgres(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  if (!connectionString) {
    return { ok: false, error: "No connection URL configured for Postgres execute. Set ASKDB_STUDIO_DATABASE_URL or introspection.providerConfig.postgres.databaseUrl." };
  }

  let pgMod: PgMod;
  try {
    const mod = await importDriver("pg", projectRoot);
    pgMod = ((mod as unknown as { default?: PgMod }).default ?? mod) as PgMod;
  } catch {
    return { ok: false, error: "The `pg` package is not installed. Install it with `pnpm add pg`." };
  }

  const client = new pgMod.Client({ connectionString });
  try {
    await client.connect();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const startMs = Date.now();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query({ text: sql, values: params });
    await client.query("COMMIT");
    const durationMs = Date.now() - startMs;
    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.map((r) => columns.map((c) => r[c]));
    return buildOkResponse(columns, rows, result.rowCount ?? rows.length, durationMs);
  } catch (err) {
    await (client.query("ROLLBACK") as Promise<unknown>).catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

type Mysql2Connection = {
  execute(sql: string, values?: unknown[]): Promise<[Array<Record<string, unknown>>, Array<{ name: string }>]>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
};
type Mysql2Mod = {
  createConnection(opts: { uri?: string; multipleStatements?: boolean }): Promise<Mysql2Connection>;
};

async function executeMySQL(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  if (!connectionString) {
    return { ok: false, error: "No connection URL configured for MySQL execute. Set ASKDB_STUDIO_DATABASE_URL or introspection.providerConfig.mysql.databaseUrl." };
  }

  let mysql2Mod: Mysql2Mod;
  try {
    // mysql2/promise resolves through mysql2's exports map; resolve mysql2 first
    // then let Node follow the exports map from the package root.
    const mod = await importDriver("mysql2/promise", projectRoot);
    mysql2Mod = ((mod as unknown as { default?: Mysql2Mod }).default ?? mod) as Mysql2Mod;
  } catch {
    return { ok: false, error: "The `mysql2` package is not installed. Install it with `pnpm add mysql2`." };
  }

  let conn: Mysql2Connection;
  try {
    conn = await mysql2Mod.createConnection({ uri: connectionString });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const startMs = Date.now();
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    await conn.query("START TRANSACTION");
    const [rowsRaw, fields] = await conn.execute(sql, params);
    await conn.query("ROLLBACK");
    const durationMs = Date.now() - startMs;
    const columns = fields.map((f) => f.name);
    const rows = (rowsRaw as Array<Record<string, unknown>>).map((r) => columns.map((c) => r[c]));
    return buildOkResponse(columns, rows, rows.length, durationMs);
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await conn.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

type BetterSqlite3Statement = {
  columns(): Array<{ name: string }>;
  all(...params: unknown[]): unknown[];
};
type BetterSqlite3Database = {
  prepare(sql: string): BetterSqlite3Statement;
  close(): void;
};
type BetterSqlite3Mod = {
  default: new (file: string, opts: { readonly: boolean; fileMustExist: boolean }) => BetterSqlite3Database;
};

async function executeSQLite(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { file, sql, params, projectRoot } = input;
  if (!file) {
    return { ok: false, error: "No SQLite file path configured for execute. Set ASKDB_STUDIO_SQLITE_FILE or introspection.providerConfig.sqlite.file." };
  }

  let Sqlite3: BetterSqlite3Mod["default"];
  try {
    const mod = await importDriver("better-sqlite3", projectRoot);
    Sqlite3 = (mod as unknown as BetterSqlite3Mod).default;
  } catch {
    return { ok: false, error: "The `better-sqlite3` package is not installed. Install it with `pnpm add better-sqlite3`." };
  }

  const startMs = Date.now();
  const db = new Sqlite3(file, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(sql);
    const columns = stmt.columns().map((c) => c.name);
    const rowsRaw = stmt.all(...params) as Array<Record<string, unknown>>;
    const durationMs = Date.now() - startMs;
    const rows = rowsRaw.map((r) => columns.map((c) => r[c]));
    return buildOkResponse(columns, rows, rows.length, durationMs);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// SQL Server
// ---------------------------------------------------------------------------

type MssqlRequest = {
  input(name: string, value: unknown): MssqlRequest;
  query(sql: string): Promise<{ recordset: Array<Record<string, unknown>>; recordsets: Array<Array<Record<string, unknown>>> }>;
};
type MssqlPool = {
  request(): MssqlRequest;
  close(): Promise<void>;
};
type MssqlMod = {
  ConnectionPool: new (connectionString: string) => MssqlPool & { connect(): Promise<MssqlPool> };
};

/**
 * Rewrite `$1`, `$2`, ... or bare `?` positional params to MSSQL `@p0`, `@p1`, ...
 * and return an object of named bindings.
 */
function rewriteSqlServerParams(sql: string, params: unknown[]): { sql: string; bindings: Record<string, unknown> } {
  if (params.length === 0) return { sql, bindings: {} };
  const bindings: Record<string, unknown> = {};
  params.forEach((value, idx) => {
    bindings[`p${idx}`] = value;
  });
  // Replace $N placeholders (1-indexed) first, then bare ? placeholders.
  let idx = 0;
  const rewritten = sql
    .replace(/\$\d+/g, () => `@p${idx++}`)
    .replace(/\?/g, () => `@p${idx++}`);
  return { sql: rewritten, bindings };
}

async function executeSQLServer(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  if (!connectionString) {
    return { ok: false, error: "No connection URL configured for SQL Server execute. Set ASKDB_STUDIO_DATABASE_URL or introspection.providerConfig.sqlserver.databaseUrl." };
  }

  let mssqlMod: MssqlMod;
  try {
    const mod = await importDriver("mssql", projectRoot);
    mssqlMod = ((mod as unknown as { default?: MssqlMod }).default ?? mod) as MssqlMod;
  } catch {
    return { ok: false, error: "The `mssql` package is not installed. Install it with `pnpm add mssql`." };
  }

  let pool: MssqlPool;
  try {
    pool = await new mssqlMod.ConnectionPool(connectionString).connect();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const startMs = Date.now();
  try {
    const { sql: rewrittenSql, bindings } = rewriteSqlServerParams(sql, params);
    const req = pool.request();
    for (const [name, value] of Object.entries(bindings)) {
      req.input(name, value);
    }
    const result = await req.query(rewrittenSql);
    const durationMs = Date.now() - startMs;
    const rowsRaw = result.recordset ?? [];
    const columns = rowsRaw.length > 0 ? Object.keys(rowsRaw[0]) : [];
    const rows = rowsRaw.map((r) => columns.map((c) => r[c]));
    return buildOkResponse(columns, rows, rows.length, durationMs);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await pool.close();
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EXECUTE_DRIVER_REGISTRY: Record<StudioExecuteProvider, StudioDriverDefinition> = {
  postgres: {
    provider: "postgres",
    label: "Postgres",
    packageName: "pg",
    installCommand: "pnpm add pg",
    execute: executePostgres,
  },
  mysql: {
    provider: "mysql",
    label: "MySQL",
    packageName: "mysql2",
    installCommand: "pnpm add mysql2",
    execute: executeMySQL,
  },
  sqlite: {
    provider: "sqlite",
    label: "SQLite",
    packageName: "better-sqlite3",
    installCommand: "pnpm add better-sqlite3",
    execute: executeSQLite,
  },
  sqlserver: {
    provider: "sqlserver",
    label: "SQL Server",
    packageName: "mssql",
    installCommand: "pnpm add mssql",
    execute: executeSQLServer,
  },
};

/**
 * Check whether a driver package is resolvable from the user's project root.
 *
 * Uses `createRequire` so that packages installed in the project's own
 * node_modules are found even when Studio runs from the global npx cache,
 * where a bare `import(packageName)` would not see them.
 */
export function isDriverInstalled(packageName: string, projectRoot: string): boolean {
  return resolveDriverPath(packageName, projectRoot) !== null;
}
