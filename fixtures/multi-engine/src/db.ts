/**
 * Minimal per-engine database access for seeding and for reading the fixture back.
 * Uses the engine drivers directly (pg, mysql2, mssql, better-sqlite3) and never
 * AskDB, so the fixture can judge any AskDB version without depending on it.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import mysql from "mysql2/promise";
import mssql from "mssql";
import Database from "better-sqlite3";
import { connectionUrl, SQLITE_FILE, type Dialect, type Role } from "./env.js";

export type Row = Record<string, unknown>;

export interface FixtureDb {
  readonly dialect: Dialect;
  /** Run one statement and return its rows. Parameter markers: see {@link placeholder}. */
  query(sql: string, params?: readonly unknown[]): Promise<Row[]>;
  /** Run a script of one or more statements (owner connections only). */
  exec(script: string): Promise<void>;
  close(): Promise<void>;
}

/** The driver-level parameter marker for the i-th (0-based) parameter. */
export function placeholder(dialect: Dialect, i: number): string {
  if (dialect === "postgres") return `$${i + 1}`;
  if (dialect === "sqlserver") return `@p${i}`;
  return "?";
}

export interface OpenOptions {
  /** Override the default database; `null` connects without one (server-level work). */
  database?: string | null;
}

export async function openDb(dialect: Dialect, role: Role, opts: OpenOptions = {}): Promise<FixtureDb> {
  switch (dialect) {
    case "postgres":
      return openPostgres(role, opts);
    case "mysql":
    case "mariadb":
      return openMysql(dialect, role, opts);
    case "sqlserver":
      return openSqlServer(role, opts);
    case "sqlite":
      return openSqlite(role);
  }
}

// Return date/time values exactly as the server renders them, with no local
// timezone conversion. The dataset's timestamps are naive UTC.
const PG_RAW_TYPES = new Set([1082 /* date */, 1114 /* timestamp */, 1184 /* timestamptz */]);

async function openPostgres(role: Role, opts: OpenOptions): Promise<FixtureDb> {
  const client = new pg.Client({
    connectionString: connectionUrl("postgres", role, opts),
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        PG_RAW_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  });
  await client.connect();
  return {
    dialect: "postgres",
    async query(sql, params = []) {
      return (await client.query(sql, [...params])).rows;
    },
    async exec(script) {
      await client.query(script);
    },
    async close() {
      await client.end();
    },
  };
}

async function openMysql(dialect: "mysql" | "mariadb", role: Role, opts: OpenOptions): Promise<FixtureDb> {
  const conn = await mysql.createConnection({
    uri: connectionUrl(dialect, role, opts),
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: role === "owner",
    charset: "utf8mb4",
  });
  return {
    dialect,
    async query(sql, params = []) {
      const [rows] = await conn.query(sql, [...params]);
      return Array.isArray(rows) ? (rows as Row[]) : [];
    },
    async exec(script) {
      await conn.query(script);
    },
    async close() {
      await conn.end();
    },
  };
}

async function openSqlServer(role: Role, opts: OpenOptions): Promise<FixtureDb> {
  const pool = new mssql.ConnectionPool(connectionUrl("sqlserver", role, opts));
  await pool.connect();
  return {
    dialect: "sqlserver",
    async query(sql, params = []) {
      const request = pool.request();
      params.forEach((value, i) => {
        if (value === null || value === undefined) request.input(`p${i}`, mssql.NVarChar, null);
        else request.input(`p${i}`, value);
      });
      const result = await request.query(sql);
      return (result.recordset ?? []) as Row[];
    },
    async exec(script) {
      // T-SQL scripts use GO as a batch separator; it is a client convention, not SQL.
      for (const batch of script.split(/^\s*GO\s*$/im)) {
        if (batch.trim()) await pool.request().batch(batch);
      }
    },
    async close() {
      await pool.close();
    },
  };
}

async function openSqlite(role: Role): Promise<FixtureDb> {
  if (role === "owner") mkdirSync(dirname(SQLITE_FILE), { recursive: true });
  const db = new Database(SQLITE_FILE, { readonly: role === "reader", fileMustExist: role === "reader" });
  if (role === "reader") db.pragma("query_only = ON");
  else db.pragma("foreign_keys = ON");
  return {
    dialect: "sqlite",
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (stmt.reader) return stmt.all(...params) as Row[];
      stmt.run(...params);
      return [];
    },
    async exec(script) {
      db.exec(script);
    },
    async close() {
      db.close();
    },
  };
}
