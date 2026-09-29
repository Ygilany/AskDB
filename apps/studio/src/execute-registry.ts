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
 *
 * Safety model (every engine):
 *
 * 1. The server validates SQL with `@askdb/core`'s `validateSelectSql` before it
 *    reaches a runner ({@link validateExecuteSql}). Runners receive the
 *    normalized single statement (no trailing semicolon, no comments).
 * 2. Each runner executes exactly one statement, inside a read-only (or
 *    always-rolled-back) transaction, with a statement timeout.
 * 3. Each runner fetches at most `maxRows + 1` rows and reports `truncated`.
 *
 * None of this replaces a read-only database role — point Studio at one.
 */

import {
  getDialectSpec,
  validateSelectSql,
  type BuiltInDialectId,
  type DialectSpec,
} from "@askdb/core";
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
  /**
   * A single SELECT that already passed {@link validateExecuteSql}. Runners
   * wrap it (row cap, transaction) but never re-validate.
   */
  sql: string;
  params: unknown[];
  /** Absolute path to the user's project root, used for driver resolution. */
  projectRoot: string;
  /** Per-query timeout in ms. Default {@link DEFAULT_EXECUTE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Max rows returned. Default {@link DEFAULT_EXECUTE_MAX_ROWS}. */
  maxRows?: number;
};

export type StudioDriverDefinition = {
  provider: StudioExecuteProvider;
  label: string;
  packageName: "pg" | "mysql2" | "better-sqlite3" | "mssql";
  installCommand: string;
  execute(input: StudioExecuteInput): Promise<ExecuteResponse>;
};

export const DEFAULT_EXECUTE_TIMEOUT_MS = 30_000;
export const DEFAULT_EXECUTE_MAX_ROWS = 500;

/** Alias for the row-cap subquery wrapper. */
const ROW_LIMIT_ALIAS = "askdb_q";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Built-in dialects each execute provider can run. The first is the default. */
const PROVIDER_DIALECTS: Record<StudioExecuteProvider, readonly BuiltInDialectId[]> = {
  postgres: ["postgres", "cockroachdb"],
  mysql: ["mysql", "mariadb"],
  sqlite: ["sqlite"],
  sqlserver: ["sqlserver"],
};

/**
 * The dialect spec used to validate SQL for `provider`. A configured NL→SQL
 * dialect override (`dialect` in `askdb.config.ts`) is honored when it belongs
 * to the same engine family (e.g. `mariadb` on the `mysql` provider).
 */
export function executeDialectFor(provider: StudioExecuteProvider, dialectOverride?: string): DialectSpec {
  const family = PROVIDER_DIALECTS[provider];
  const id =
    dialectOverride && (family as readonly string[]).includes(dialectOverride)
      ? (dialectOverride as BuiltInDialectId)
      : family[0]!;
  return getDialectSpec(id);
}

/**
 * Run `@askdb/core`'s read-only SELECT guardrail for the provider's dialect.
 * Returns the normalized single statement; throws `SqlValidationError`.
 */
export function validateExecuteSql(
  provider: StudioExecuteProvider,
  sql: string,
  dialectOverride?: string,
): string {
  return validateSelectSql(executeDialectFor(provider, dialectOverride), sql);
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function resolveLimits(input: StudioExecuteInput): { timeoutMs: number; maxRows: number; fetchLimit: number } {
  const timeoutMs = positiveInt(input.timeoutMs) ?? DEFAULT_EXECUTE_TIMEOUT_MS;
  const maxRows = positiveInt(input.maxRows) ?? DEFAULT_EXECUTE_MAX_ROWS;
  return { timeoutMs, maxRows, fetchLimit: maxRows + 1 };
}

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Wrap a validated single SELECT so the database returns at most `fetchLimit`
 * rows. Used for engines with `LIMIT` (Postgres, MySQL). The newlines keep the
 * wrapper intact even if the statement ends in something unexpected.
 */
export function wrapWithRowLimit(sql: string, fetchLimit: number): string {
  return `SELECT * FROM (\n${sql}\n) AS ${ROW_LIMIT_ALIAS} LIMIT ${fetchLimit}`;
}

function buildOkResponse(
  columns: string[],
  rows: unknown[][],
  maxRows: number,
  durationMs: number,
): ExecuteResponse {
  const truncated = rows.length > maxRows;
  const shown = truncated ? rows.slice(0, maxRows) : rows;
  return {
    ok: true,
    columns,
    rows: shown,
    rowCount: shown.length,
    durationMs,
    truncated,
    rowLimit: maxRows,
  };
}

function toRowArray(row: unknown, columns: string[]): unknown[] {
  if (Array.isArray(row)) return row;
  const record = (row ?? {}) as Record<string, unknown>;
  return columns.map((c) => record[c]);
}

function errorResponse(err: unknown): ExecuteResponse {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * Race `promise` against a timer. On timeout, run `onTimeout` (cancel/destroy
 * the connection) and reject. A client-side backstop for server-side timeouts.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // best effort
      }
      reject(new Error(`Query timed out after ${ms} ms.`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Grace period before the client-side backstop fires after the server-side timeout. */
const CLIENT_TIMEOUT_GRACE_MS = 2_000;

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

type PgQueryConfig = {
  text: string;
  values: unknown[];
  /** Force the extended query protocol: exactly one statement, even with no params. */
  queryMode: "extended";
  /** Named statements are always prepared, which also forces extended protocol on older pg 8.x. */
  name: string;
  rowMode: "array";
};
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string): Promise<unknown>;
  query(config: PgQueryConfig): Promise<{
    fields: Array<{ name: string }>;
    rows: unknown[];
  }>;
};
type PgMod = {
  Client: new (opts: {
    connectionString: string;
    connectionTimeoutMillis?: number;
    query_timeout?: number;
  }) => PgClient;
};

async function executePostgres(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  const { timeoutMs, maxRows, fetchLimit } = resolveLimits(input);
  if (!connectionString) {
    return { ok: false, error: "No connection URL configured for Postgres execute. Set studio.execute.databaseUrl in askdb.config.ts." };
  }

  let pgMod: PgMod;
  try {
    pgMod = await loadPgDriver({ resolveFrom: projectRoot }) as unknown as PgMod;
  } catch (err) {
    return errorResponse(err);
  }

  const client = new pgMod.Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    // Client-side backstop; the server-side statement_timeout below fires first.
    query_timeout: timeoutMs + CLIENT_TIMEOUT_GRACE_MS,
  });
  try {
    await client.connect();
  } catch (err) {
    return errorResponse(err);
  }
  const startMs = Date.now();
  try {
    // Session default + explicit read-only transaction: even a statement that
    // slipped past validation cannot write, and cannot COMMIT its way out
    // (the extended protocol below runs exactly one statement).
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await client.query({
      text: wrapWithRowLimit(sql, fetchLimit),
      values: params,
      queryMode: "extended",
      name: "askdb_studio_execute",
      rowMode: "array",
    });
    await client.query("ROLLBACK");
    const durationMs = Date.now() - startMs;
    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.map((r) => toRowArray(r, columns));
    return buildOkResponse(columns, rows, maxRows, durationMs);
  } catch (err) {
    await (client.query("ROLLBACK") as Promise<unknown>).catch(() => {});
    return errorResponse(err);
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB
// ---------------------------------------------------------------------------

type Mysql2Connection = {
  execute(
    options: { sql: string; values?: unknown[]; rowsAsArray?: boolean },
  ): Promise<[unknown[], Array<{ name: string }>]>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  destroy?(): void;
};
type Mysql2Mod = {
  createConnection(opts: {
    uri?: string;
    multipleStatements?: boolean;
    connectTimeout?: number;
  }): Promise<Mysql2Connection>;
};

/** MySQL uses `max_execution_time` (ms); MariaDB uses `max_statement_time` (seconds). */
async function applyMysqlTimeout(conn: Mysql2Connection, timeoutMs: number): Promise<void> {
  try {
    await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${timeoutMs}`);
    return;
  } catch {
    // Not MySQL 5.7.8+ — try MariaDB.
  }
  try {
    await conn.query(`SET SESSION max_statement_time = ${Math.max(timeoutMs / 1000, 0.001)}`);
  } catch {
    // Neither variable exists; the client-side backstop still applies.
  }
}

async function executeMySQL(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  const { timeoutMs, maxRows, fetchLimit } = resolveLimits(input);
  if (!connectionString) {
    return { ok: false, error: "No connection URL configured for MySQL execute. Set studio.execute.databaseUrl in askdb.config.ts." };
  }

  let mysql2Mod: Mysql2Mod;
  try {
    mysql2Mod = await loadMysql2Driver({ resolveFrom: projectRoot }) as unknown as Mysql2Mod;
  } catch (err) {
    return errorResponse(err);
  }

  let conn: Mysql2Connection;
  try {
    conn = await mysql2Mod.createConnection({
      uri: connectionString,
      multipleStatements: false,
      connectTimeout: timeoutMs,
    });
  } catch (err) {
    return errorResponse(err);
  }
  const startMs = Date.now();
  try {
    await applyMysqlTimeout(conn, timeoutMs);
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    await conn.query("START TRANSACTION READ ONLY");
    // `execute` uses the binary prepared-statement protocol: one statement only.
    const [rowsRaw, fields] = await withTimeout(
      conn.execute({ sql: wrapWithRowLimit(sql, fetchLimit), values: params, rowsAsArray: true }),
      timeoutMs + CLIENT_TIMEOUT_GRACE_MS,
      () => conn.destroy?.(),
    );
    await conn.query("ROLLBACK");
    const durationMs = Date.now() - startMs;
    const columns = (fields ?? []).map((f) => f.name);
    const rows = (rowsRaw ?? []).map((r) => toRowArray(r, columns));
    return buildOkResponse(columns, rows, maxRows, durationMs);
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    return errorResponse(err);
  } finally {
    await conn.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

type BetterSqlite3Statement = {
  reader: boolean;
  columns(): Array<{ name: string }>;
  raw(toggle?: boolean): BetterSqlite3Statement;
  iterate(...params: unknown[]): IterableIterator<unknown>;
};
type BetterSqlite3Database = {
  prepare(sql: string): BetterSqlite3Statement;
  close(): void;
};
type BetterSqlite3Ctor = new (
  file: string,
  opts: { readonly: boolean; fileMustExist: boolean; timeout?: number },
) => BetterSqlite3Database;

async function executeSQLite(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { file, sql, params, projectRoot } = input;
  const { timeoutMs, maxRows, fetchLimit } = resolveLimits(input);
  if (!file) {
    return { ok: false, error: "No SQLite file path configured for execute. Set studio.execute.file in askdb.config.ts." };
  }

  let Sqlite3: BetterSqlite3Ctor;
  try {
    const mod = await loadBetterSqlite3Driver({ resolveFrom: projectRoot });
    Sqlite3 = mod.default as unknown as BetterSqlite3Ctor;
  } catch (err) {
    return errorResponse(err);
  }

  const startMs = Date.now();
  let db: BetterSqlite3Database;
  try {
    // Read-only handle. `timeout` is only the busy (lock-wait) timeout —
    // better-sqlite3 runs queries synchronously and cannot interrupt them.
    db = new Sqlite3(file, { readonly: true, fileMustExist: true, timeout: timeoutMs });
  } catch (err) {
    return errorResponse(err);
  }
  try {
    // `prepare` rejects strings containing more than one statement.
    const stmt = db.prepare(sql);
    if (!stmt.reader) {
      return { ok: false, error: "Only statements that return rows can be executed." };
    }
    stmt.raw(true);
    const columns = stmt.columns().map((c) => c.name);
    const rows: unknown[][] = [];
    // Stream rows and stop at the cap — never materialize the full result.
    for (const row of stmt.iterate(...params)) {
      rows.push(toRowArray(row, columns));
      if (rows.length >= fetchLimit) break;
    }
    const durationMs = Date.now() - startMs;
    return buildOkResponse(columns, rows, maxRows, durationMs);
  } catch (err) {
    return errorResponse(err);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// SQL Server
// ---------------------------------------------------------------------------

type MssqlRecordset = Array<Record<string, unknown>> & {
  columns?: Record<string, { index: number; name: string }>;
};
type MssqlRequest = {
  input(name: string, value: unknown): MssqlRequest;
  query(sql: string): Promise<{ recordset?: MssqlRecordset; recordsets?: MssqlRecordset[] }>;
  cancel?(): void;
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

/**
 * SQL Server has no read-only transaction mode, so the statement runs inside a
 * transaction that is always rolled back. `XACT_ABORT` rolls back on any error;
 * `ROWCOUNT` caps the rows returned (SQL Server has no `LIMIT`, and wrapping in
 * a derived table would reject unnamed columns such as `COUNT(*)`).
 */
export function buildSqlServerBatch(sql: string, fetchLimit: number): string {
  return [
    "SET XACT_ABORT ON;",
    `SET ROWCOUNT ${fetchLimit};`,
    "BEGIN TRANSACTION;",
    sql,
    ";",
    "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;",
    "SET ROWCOUNT 0;",
  ].join("\n");
}

function recordsetColumns(recordset: MssqlRecordset): string[] {
  if (recordset.columns) {
    return Object.values(recordset.columns)
      .sort((a, b) => a.index - b.index)
      .map((c) => c.name);
  }
  return recordset.length > 0 ? Object.keys(recordset[0]!) : [];
}

async function executeSQLServer(input: StudioExecuteInput): Promise<ExecuteResponse> {
  const { connectionString, sql, params, projectRoot } = input;
  const { timeoutMs, maxRows, fetchLimit } = resolveLimits(input);
  if (!connectionString) {
    return { ok: false, error: "No connection URL configured for SQL Server execute. Set studio.execute.databaseUrl in askdb.config.ts." };
  }

  let mssqlMod: MssqlMod;
  try {
    mssqlMod = await loadMssqlDriver({ resolveFrom: projectRoot }) as unknown as MssqlMod;
  } catch (err) {
    return errorResponse(err);
  }

  let pool: MssqlPool;
  try {
    pool = await new mssqlMod.ConnectionPool(resolveConnectionInput(connectionString)).connect();
  } catch (err) {
    return errorResponse(err);
  }
  const startMs = Date.now();
  try {
    const { sql: rewrittenSql, bindings } = rewriteSqlServerParams(sql, params);
    const req = pool.request();
    for (const [name, value] of Object.entries(bindings)) {
      req.input(name, value);
    }
    const result = await withTimeout(
      req.query(buildSqlServerBatch(rewrittenSql, fetchLimit)),
      timeoutMs,
      () => req.cancel?.(),
    );
    const durationMs = Date.now() - startMs;
    const recordset: MssqlRecordset = result.recordset ?? result.recordsets?.[0] ?? [];
    const columns = recordsetColumns(recordset);
    const rows = recordset.map((r) => toRowArray(r, columns));
    return buildOkResponse(columns, rows, maxRows, durationMs);
  } catch (err) {
    return errorResponse(err);
  } finally {
    await pool.close().catch(() => {});
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

/** True when `value` is a registry key (own property — rejects `constructor`, `__proto__`, …). */
export function isStudioExecuteProvider(value: unknown): value is StudioExecuteProvider {
  return typeof value === "string" && Object.hasOwn(EXECUTE_DRIVER_REGISTRY, value);
}

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
