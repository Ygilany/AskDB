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

import { loadPgDriver, isPgDriverInstalled } from "@askdb/postgres";
import { loadMysql2Driver, isMysql2DriverInstalled } from "@askdb/mysql";
import { loadBetterSqlite3Driver, isBetterSqlite3DriverInstalled } from "@askdb/sqlite";
import {
  loadMssqlDriver,
  isMssqlDriverInstalled,
  resolveConnectionInput,
  type MssqlConfigInput,
} from "@askdb/sqlserver";
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
    pgMod = await loadPgDriver({ resolveFrom: projectRoot }) as unknown as PgMod;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    mysql2Mod = await loadMysql2Driver({ resolveFrom: projectRoot }) as unknown as Mysql2Mod;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
type BetterSqlite3Ctor = new (file: string, opts: { readonly: boolean; fileMustExist: boolean }) => BetterSqlite3Database;

async function executeSQLite(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { file, sql, params, projectRoot } = input;
  if (!file) {
    return { ok: false, error: "No SQLite file path configured for execute. Set ASKDB_STUDIO_SQLITE_FILE or introspection.providerConfig.sqlite.file." };
  }

  let Sqlite3: BetterSqlite3Ctor;
  try {
    const mod = await loadBetterSqlite3Driver({ resolveFrom: projectRoot });
    Sqlite3 = mod.default as unknown as BetterSqlite3Ctor;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
  ConnectionPool: new (
    config: string | MssqlConfigInput,
  ) => MssqlPool & { connect(): Promise<MssqlPool> };
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
    mssqlMod = await loadMssqlDriver({ resolveFrom: projectRoot }) as unknown as MssqlMod;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let pool: MssqlPool;
  try {
    pool = await new mssqlMod.ConnectionPool(resolveConnectionInput(connectionString)).connect();
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
 */
export function isDriverInstalled(packageName: string, projectRoot: string): boolean {
  switch (packageName) {
    case "pg":
      return isPgDriverInstalled({ resolveFrom: projectRoot });
    case "mysql2":
      return isMysql2DriverInstalled({ resolveFrom: projectRoot });
    case "better-sqlite3":
      return isBetterSqlite3DriverInstalled({ resolveFrom: projectRoot });
    case "mssql":
      return isMssqlDriverInstalled({ resolveFrom: projectRoot });
    default:
      return false;
  }
}
