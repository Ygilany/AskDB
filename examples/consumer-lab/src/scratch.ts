/**
 * Scratch databases: writable, throwaway copies of the fixture's schema and rows, one per
 * engine, that the lab creates, resets and drops itself. A test that needs to show what a
 * statement would really do (a write lands, a table goes, a lock is held) runs it here, as
 * the engine's owner, and never on the shared fixture's databases.
 *
 * | Engine        | Scratch copy                                                           |
 * |---------------|------------------------------------------------------------------------|
 * | Postgres      | its own database, `lab_scratch_<token>`, with the fixture's schemas    |
 * | SQL Server    | its own database, `lab_scratch_<token>`, with the fixture's schemas    |
 * | MySQL/MariaDB | one database per logical schema, `lab_scratch_<token>_org`, `…_people`, … |
 * | SQLite        | a file, `.lab/scratch/lab_scratch_<token>.sqlite`                       |
 *
 * Each copy is built from the fixture's own DDL (`dataset/ddl/<dialect>.sql`) and rows
 * (`loadRows`), so it holds the same tables and data as the fixture. The DDL is adapted in
 * two ways, both checked so a DDL change that defeats them fails loudly:
 *
 * - The database names MySQL and MariaDB hardcode (`org`, `people`, `billing`, `ref`,
 *   `fixture`) are rewritten to the scratch copy's.
 * - The read-only role section at the end of each server engine's DDL is cut. It changes
 *   server-level principals the shared fixture owns (Postgres `ALTER ROLE fixture_reader`,
 *   MySQL grants that outlive a dropped database) and names the fixture's database
 *   (`GRANT CONNECT ON DATABASE askdb_fixture`, `DATABASE::askdb_fixture`). A scratch copy
 *   is owner-only.
 *
 * The seeder (`fixtures/multi-engine/src/seed.ts`, `db.ts`) is not imported: its source is
 * part of the fixture's dataset hash, and the lab must not depend on its internals. Rows go
 * in through the drivers the lab already has, converted the way the fixture's DDL stores
 * them (booleans as 0/1 on MySQL, MariaDB and SQLite; SQLite timestamps as
 * `YYYY-MM-DD HH:MM:SS`).
 *
 * Every name carries a per-copy random token, so concurrent lab runs against one fixture
 * never share a scratch copy. `drop()` removes it; call it in `afterAll`.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import mssql from "mssql";
import mysql from "mysql2/promise";
import pg from "pg";
import type { SupportedDialect } from "./dialects.js";
import {
  FIXTURE_DDL_DIR,
  LOGICAL_SCHEMAS,
  connectionUrl,
  loadLogicalSchema,
  loadRows,
  logicalTypeOf,
  quoteIdent,
  type LogicalTable,
} from "./fixture.js";
import { LAB_STATE } from "./paths.js";

export type Row = Record<string, unknown>;

/** One owner connection to a scratch copy. */
export interface ScratchConnection {
  /**
   * Run `sql` as written, the way the engine's driver runs a batch: several statements
   * run in turn (Postgres simple query, MySQL `multipleStatements`, a T-SQL batch, SQLite
   * `exec`). Returns nothing; use {@link ScratchConnection.rows} to read.
   */
  run(sql: string): Promise<void>;
  /** Run one statement and return its rows. */
  rows(sql: string): Promise<Row[]>;
  close(): Promise<void>;
}

export interface ScratchDb {
  readonly dialect: SupportedDialect;
  /** The scratch database (Postgres, SQL Server), database-name prefix (MySQL, MariaDB) or file (SQLite). */
  readonly name: string;
  /** Owner connection string for the scratch copy (server engines), in the form `connectionUrl` gives. */
  readonly url?: string;
  /** The scratch copy's file (SQLite). */
  readonly file?: string;
  /** The physical, quoted name of a logical table in the scratch copy, e.g. `` `lab_scratch_ab12cd_billing`.`order` ``. */
  table(table: { schema: string; name: string }): string;
  /** A new owner connection. Close it when done. */
  connect(): Promise<ScratchConnection>;
  /** Drop and recreate the copy from the fixture's DDL and rows. */
  reset(): Promise<void>;
  /** Drop the copy. Safe to call more than once. */
  drop(): Promise<void>;
}

/** Where SQLite scratch files live (gitignored with the rest of `.lab/`). */
export const SCRATCH_DIR = join(LAB_STATE, "scratch");

/**
 * A scratch copy of the fixture for `dialect`, created and seeded. The caller owns it and
 * must `drop()` it.
 */
export async function createScratch(dialect: SupportedDialect): Promise<ScratchDb> {
  const name = `lab_scratch_${randomBytes(3).toString("hex")}`;
  const db = SCRATCH[dialect](name, dialect);
  try {
    await db.reset();
  } catch (error) {
    // The caller never gets `db` to drop, so drop the partial copy here; the seeding error wins.
    await db.drop().catch(() => undefined);
    throw error;
  }
  return db;
}

// --- The DDL, adapted -----------------------------------------------------------------

/** The comment that opens the read-only role section at the end of each server engine's DDL. */
const READER_SECTION = /^-- Read-only (role|login)\b/m;

/** The fixture DDL for `dialect`, with its read-only role section cut (server engines). */
function scratchDdl(dialect: SupportedDialect): string {
  const ddl = readFileSync(join(FIXTURE_DDL_DIR, `${dialect}.sql`), "utf8");
  if (dialect === "sqlite") return ddl;
  const cut = ddl.search(READER_SECTION);
  if (cut < 0) {
    throw new Error(`scratch: ${dialect}.sql has no "-- Read-only role/login" section to cut; update src/scratch.ts for the new DDL`);
  }
  const kept = ddl.slice(0, cut);
  if (/fixture_reader|askdb_fixture/.test(stripComments(kept))) {
    throw new Error(`scratch: ${dialect}.sql names the fixture's reader or database outside its read-only role section; update src/scratch.ts`);
  }
  return kept;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * The databases MySQL/MariaDB's DDL creates: the logical schemas plus the seeder's
 * `fixture`, in an order they can be dropped in (a database whose tables others reference
 * goes after them, as the DDL drops them).
 */
const MYSQL_DATABASES = ["billing", "people", "org", "ref", "fixture"] as const;
if (!LOGICAL_SCHEMAS.every((s) => (MYSQL_DATABASES as readonly string[]).includes(s))) {
  throw new Error(`scratch: MYSQL_DATABASES must list every logical schema (${LOGICAL_SCHEMAS.join(", ")})`);
}

/** MySQL/MariaDB DDL with every hardcoded database name moved under `prefix`. */
function mysqlScratchDdl(dialect: "mysql" | "mariadb", prefix: string): string {
  const names = MYSQL_DATABASES.join("|");
  const rewritten = stripComments(scratchDdl(dialect))
    // `DATABASE [IF EXISTS] org`
    .replace(new RegExp(`\\bDATABASE(\\s+IF\\s+EXISTS)?\\s+(${names})\\b`, "gi"), (_m, ifExists: string | undefined, db: string) => `DATABASE${ifExists ?? ""} ${prefix}_${db}`)
    // `org.agency`, `billing.\`order\``
    .replace(new RegExp(`(?<![\\w.\`])(${names})\\.`, "g"), (_m, db: string) => `${prefix}_${db}.`);
  const leftover = new RegExp(`(?<![\\w.\`])(${names})\\.|\\bDATABASE(\\s+IF\\s+EXISTS)?\\s+(${names})\\b`, "i").exec(rewritten);
  if (leftover) throw new Error(`scratch: ${dialect}.sql still names the fixture database after rewriting: "${leftover[0]}"`);
  return rewritten;
}

// --- Rows ------------------------------------------------------------------------------

/** A canonical JSON value as this engine's driver should bind it, matching the fixture's DDL. */
function driverValue(dialect: SupportedDialect, type: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const logical = logicalTypeOf(type);
  if (logical === "boolean" && (dialect === "mysql" || dialect === "mariadb" || dialect === "sqlite")) return value ? 1 : 0;
  if (logical === "timestamp" && dialect === "sqlite") return String(value).replace("T", " ");
  return value;
}

function marker(dialect: SupportedDialect, i: number): string {
  if (dialect === "postgres") return `$${i + 1}`;
  if (dialect === "sqlserver") return `@p${i}`;
  return "?";
}

/** One multi-row INSERT per table, in the logical schema's foreign-key-safe order. */
function* rowInserts(dialect: SupportedDialect, table: (t: LogicalTable) => string): Generator<{ sql: string; params: unknown[] }> {
  for (const t of loadLogicalSchema().tables) {
    const params: unknown[] = [];
    const tuples = loadRows(t).map((row) => {
      const markers = t.columns.map((col) => {
        params.push(driverValue(dialect, col.type, row[col.name] ?? null));
        return marker(dialect, params.length - 1);
      });
      return `(${markers.join(", ")})`;
    });
    const columns = t.columns.map((c) => quoteIdent(dialect, c.name)).join(", ");
    yield { sql: `INSERT INTO ${table(t)} (${columns}) VALUES ${tuples.join(", ")}`, params };
  }
}

// --- Engines ---------------------------------------------------------------------------

type Factory = (name: string, dialect: SupportedDialect) => ScratchDb;

const SCRATCH: Record<SupportedDialect, Factory> = {
  postgres: postgresScratch,
  mysql: (name, dialect) => mysqlScratch(name, dialect as "mysql" | "mariadb"),
  mariadb: (name, dialect) => mysqlScratch(name, dialect as "mysql" | "mariadb"),
  sqlserver: sqlServerScratch,
  sqlite: sqliteScratch,
};

function schemaQualified(dialect: SupportedDialect) {
  return (t: { schema: string; name: string }) => `${quoteIdent(dialect, t.schema)}.${quoteIdent(dialect, t.name)}`;
}

function postgresScratch(name: string): ScratchDb {
  const url = connectionUrl("postgres", "owner", { database: name });
  const admin = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client({ connectionString: connectionUrl("postgres", "owner", { database: "postgres" }) });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };
  const connect = async (): Promise<ScratchConnection> => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return {
      run: async (sql) => void (await client.query(sql)),
      rows: async (sql) => (await client.query(sql)).rows as Row[],
      close: () => client.end(),
    };
  };
  const drop = () => admin(async (c) => void (await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)));
  const table = schemaQualified("postgres");
  return {
    dialect: "postgres",
    name,
    url,
    table,
    connect,
    drop,
    async reset() {
      await drop();
      await admin(async (c) => void (await c.query(`CREATE DATABASE ${name}`)));
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(scratchDdl("postgres"));
        for (const insert of rowInserts("postgres", table)) await client.query(insert.sql, insert.params);
      } finally {
        await client.end();
      }
    },
  };
}

function mysqlScratch(prefix: string, dialect: "mysql" | "mariadb"): ScratchDb {
  const open = () =>
    mysql.createConnection({
      uri: connectionUrl(dialect, "owner", { database: null }),
      multipleStatements: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: "utf8mb4",
    });
  const table = (t: { schema: string; name: string }) => `${quoteIdent(dialect, `${prefix}_${t.schema}`)}.${quoteIdent(dialect, t.name)}`;
  const drop = async () => {
    const conn = await open();
    try {
      for (const db of MYSQL_DATABASES) await conn.query(`DROP DATABASE IF EXISTS ${quoteIdent(dialect, `${prefix}_${db}`)}`);
    } finally {
      await conn.end();
    }
  };
  return {
    dialect,
    name: prefix,
    url: connectionUrl(dialect, "owner", { database: `${prefix}_org` }),
    table,
    drop,
    async connect() {
      const conn = await open();
      return {
        run: async (sql) => void (await conn.query(sql)),
        rows: async (sql) => {
          const [rows] = await conn.query(sql);
          return Array.isArray(rows) ? (rows as Row[]) : [];
        },
        close: () => conn.end(),
      };
    },
    async reset() {
      const conn = await open();
      try {
        // The DDL drops and recreates its own databases.
        await conn.query(mysqlScratchDdl(dialect, prefix));
        for (const insert of rowInserts(dialect, table)) await conn.query(insert.sql, insert.params);
      } finally {
        await conn.end();
      }
    },
  };
}

function sqlServerScratch(name: string): ScratchDb {
  const url = connectionUrl("sqlserver", "owner", { database: name });
  // One connection per pool, so a transaction a batch opens stays on the connection the next request uses.
  const openPool = async (connectionString: string) => {
    const pool = new mssql.ConnectionPool({ ...mssql.ConnectionPool.parseConnectionString(connectionString), pool: { min: 0, max: 1 } });
    await pool.connect();
    return pool;
  };
  const master = async (sql: string) => {
    const pool = await openPool(connectionUrl("sqlserver", "owner", { database: "master" }));
    try {
      await pool.request().batch(sql);
    } finally {
      await pool.close();
    }
  };
  const drop = () =>
    master(`IF DB_ID('${name}') IS NOT NULL
      BEGIN
        ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${name}];
      END`);
  const table = schemaQualified("sqlserver");
  return {
    dialect: "sqlserver",
    name,
    url,
    table,
    drop,
    async connect() {
      const pool = await openPool(url);
      return {
        run: async (sql) => void (await pool.request().batch(sql)),
        rows: async (sql) => ((await pool.request().query(sql)).recordset ?? []) as Row[],
        close: () => pool.close(),
      };
    },
    async reset() {
      await drop();
      await master(`CREATE DATABASE [${name}]`);
      const pool = await openPool(url);
      try {
        // T-SQL scripts use GO as a batch separator; it is a client convention, not SQL.
        for (const batch of scratchDdl("sqlserver").split(/^\s*GO\s*$/im)) {
          if (batch.trim()) await pool.request().batch(batch);
        }
        for (const insert of rowInserts("sqlserver", table)) {
          const request = pool.request();
          insert.params.forEach((value, i) => {
            if (value === null) request.input(`p${i}`, mssql.NVarChar, null);
            else request.input(`p${i}`, value);
          });
          await request.query(insert.sql);
        }
      } finally {
        await pool.close();
      }
    },
  };
}

function sqliteScratch(name: string): ScratchDb {
  const file = join(SCRATCH_DIR, `${name}.sqlite`);
  const open = () => {
    const db = new Database(file);
    db.pragma("foreign_keys = ON");
    return db;
  };
  const drop = async () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
  };
  // SQLite has one namespace: logical table names are unique across schemas, so they stand alone.
  const table = (t: { schema: string; name: string }) => quoteIdent("sqlite", t.name);
  return {
    dialect: "sqlite",
    name,
    file,
    table,
    drop,
    async connect() {
      const db = open();
      return {
        run: async (sql) => void db.exec(sql),
        rows: async (sql) => {
          const stmt = db.prepare(sql);
          if (stmt.reader) return stmt.all() as Row[];
          stmt.run();
          return [];
        },
        close: async () => void db.close(),
      };
    },
    async reset() {
      await drop();
      mkdirSync(SCRATCH_DIR, { recursive: true });
      const db = open();
      try {
        db.exec(scratchDdl("sqlite"));
        for (const insert of rowInserts("sqlite", table)) db.prepare(insert.sql).run(...insert.params);
      } finally {
        db.close();
      }
    },
  };
}
