/**
 * Seeds every lab database from the canonical dataset (dataset/data/*.json) using
 * each dialect's hand-written DDL (dataset/ddl/<dialect>.sql).
 *
 * Idempotent: a dialect whose stored dataset hash matches the current dataset is
 * left alone; otherwise its lab objects are dropped and recreated.
 *
 *   tsx src/seed.ts                 # every dialect
 *   tsx src/seed.ts sqlite mysql    # only these
 *   tsx src/seed.ts --force         # reseed even when the hash matches
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { datasetHash, loadLogicalSchema, loadRows, logicalTypeOf, metaTable, physicalName, quoteIdent } from "./dataset.js";
import { openDb, placeholder, type LabDb } from "./host/db.js";
import { DATASET_DIR, DIALECTS, SQLITE_FILE, type Dialect } from "./lab-env.js";

const SQLITE_HASH_FILE = `${SQLITE_FILE}.hash`;

async function storedHash(dialect: Dialect): Promise<string | undefined> {
  if (dialect === "sqlite") {
    return existsSync(SQLITE_FILE) && existsSync(SQLITE_HASH_FILE) ? readFileSync(SQLITE_HASH_FILE, "utf8").trim() : undefined;
  }
  let db: LabDb | undefined;
  try {
    // SQL Server: read through master so a missing askdb_lab database is just "no hash".
    // MySQL/MariaDB: the hash lives in its own `lab` database, so connect without one.
    const database = dialect === "sqlserver" ? "master" : dialect === "postgres" ? undefined : null;
    db = await openDb(dialect, "owner", { database });
    const table = dialect === "sqlserver" ? `askdb_lab.${metaTable(dialect)}` : metaTable(dialect);
    const rows = await db.query(`SELECT dataset_hash FROM ${table}`);
    return rows[0]?.dataset_hash as string | undefined;
  } catch {
    return undefined;
  } finally {
    await db?.close();
  }
}

/** Recreate the database the DDL runs in, where the engine needs that done outside the DDL. */
async function recreateContainer(dialect: Dialect): Promise<void> {
  if (dialect === "sqlite") {
    rmSync(SQLITE_HASH_FILE, { force: true });
    rmSync(SQLITE_FILE, { force: true });
    return;
  }
  if (dialect === "sqlserver") {
    const master = await openDb("sqlserver", "owner", { database: "master" });
    try {
      await master.exec(`
        IF DB_ID('askdb_lab') IS NOT NULL
        BEGIN
          ALTER DATABASE askdb_lab SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
          DROP DATABASE askdb_lab;
        END
        GO
        CREATE DATABASE askdb_lab;
      `);
    } finally {
      await master.close();
    }
  }
  // Postgres: the DDL drops its own schemas. MySQL/MariaDB: the DDL drops its own databases.
}

/** Convert a canonical JSON value to what this dialect's driver should bind. */
function toDriverValue(dialect: Dialect, type: string, value: unknown): unknown {
  if (value === null) return null;
  const logical = logicalTypeOf(type);
  if (logical === "boolean" && (dialect === "mysql" || dialect === "mariadb" || dialect === "sqlite")) {
    return value ? 1 : 0;
  }
  if (logical === "timestamp" && dialect === "sqlite") return String(value).replace("T", " ");
  return value;
}

async function seed(dialect: Dialect, force: boolean): Promise<void> {
  const hash = datasetHash(dialect);
  if (!force && (await storedHash(dialect)) === hash) {
    console.log(`[${dialect}] up to date (${hash.slice(0, 12)})`);
    return;
  }

  await recreateContainer(dialect);
  const db = await openDb(dialect, "owner", dialect === "mysql" || dialect === "mariadb" ? { database: null } : {});
  try {
    await db.exec(readFileSync(join(DATASET_DIR, "ddl", `${dialect}.sql`), "utf8"));

    const schema = loadLogicalSchema();
    const counts: string[] = [];
    for (const table of schema.tables) {
      const rows = loadRows(table);
      const columns = table.columns;
      const params: unknown[] = [];
      const tuples = rows.map((row) => {
        const markers = columns.map((col) => {
          params.push(toDriverValue(dialect, col.type, row[col.name] ?? null));
          return placeholder(dialect, params.length - 1);
        });
        return `(${markers.join(", ")})`;
      });
      const columnList = columns.map((c) => quoteIdent(dialect, c.name)).join(", ");
      await db.query(`INSERT INTO ${physicalName(dialect, table)} (${columnList}) VALUES ${tuples.join(", ")}`, params);
      counts.push(`${table.name}=${rows.length}`);
    }

    if (dialect === "sqlite") {
      writeFileSync(SQLITE_HASH_FILE, `${hash}\n`);
    } else {
      await db.query(`INSERT INTO ${metaTable(dialect)} (dataset_hash, seeded_at) VALUES (${placeholder(dialect, 0)}, ${placeholder(dialect, 1)})`, [
        hash,
        new Date().toISOString().slice(0, 19),
      ]);
    }
    console.log(`[${dialect}] seeded ${counts.join(" ")} (${hash.slice(0, 12)})`);
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const requested = args.filter((a) => !a.startsWith("--"));
  const unknown = requested.filter((a) => !(DIALECTS as readonly string[]).includes(a));
  if (unknown.length) throw new Error(`Unknown dialect(s): ${unknown.join(", ")}. Expected: ${DIALECTS.join(", ")}`);
  const targets = requested.length ? (requested as Dialect[]) : [...DIALECTS];

  const results = await Promise.allSettled(targets.map((d) => seed(d, force)));
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [`[${targets[i]}] ${String(r.reason)}`] : []));
  if (failed.length) {
    console.error(failed.join("\n"));
    process.exitCode = 1;
  }
}

await main();
