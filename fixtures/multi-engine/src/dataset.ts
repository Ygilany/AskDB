/**
 * The canonical dataset: dataset/schema.logical.json (the golden logical schema)
 * and dataset/data/<schema>.<table>.json (the rows). Everything else (the DDL,
 * the seeder, oracles, schema comparisons) is checked against these.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATASET_DIR, FIXTURE_ROOT, type Dialect } from "./env.js";
import type { LogicalType } from "./normalize.js";

export interface LogicalColumn {
  name: string;
  /** Logical type, e.g. `int`, `text(100)`, `decimal(12,2)`, `date`, `timestamp`, `boolean`. */
  type: string;
  nullable: boolean;
  sensitive?: boolean;
}

export interface LogicalForeignKey {
  columns: string[];
  references: { schema: string; table: string; columns: string[] };
}

export interface LogicalTable {
  schema: string;
  name: string;
  columns: LogicalColumn[];
  primaryKey: string[];
  unique: string[][];
  foreignKeys: LogicalForeignKey[];
  /** Present on the tenant root. `parentColumn` makes it a self-referencing tree. */
  tenantRoot?: { parentColumn?: string };
  tenantColumn?: string;
  global?: boolean;
  reservedWord?: boolean;
}

export interface LogicalView {
  schema: string;
  name: string;
  columns: string[];
  tenantColumn?: string;
  definition: string;
}

export interface LogicalSchema {
  schemas: string[];
  /** Listed in foreign-key-safe insertion order. */
  tables: LogicalTable[];
  views: LogicalView[];
}

export type DataRow = Record<string, string | number | boolean | null>;

export function loadLogicalSchema(): LogicalSchema {
  return JSON.parse(readFileSync(join(DATASET_DIR, "schema.logical.json"), "utf8")) as LogicalSchema;
}

export function loadRows(table: { schema: string; name: string }): DataRow[] {
  return JSON.parse(readFileSync(join(DATASET_DIR, "data", `${table.schema}.${table.name}.json`), "utf8")) as DataRow[];
}

/** `text(100)` → `text`, `decimal(12,2)` → `decimal`. */
export function logicalTypeOf(type: string): LogicalType {
  const base = type.replace(/\(.*\)$/, "");
  if (base === "int" || base === "bigint" || base === "decimal" || base === "boolean" || base === "date" || base === "timestamp" || base === "text") {
    return base;
  }
  throw new Error(`Unknown logical type: ${type}`);
}

/** Quote one identifier the way each engine requires (needed for the reserved-word table `order`). */
export function quoteIdent(dialect: Dialect, name: string): string {
  if (dialect === "mysql" || dialect === "mariadb") return `\`${name}\``;
  if (dialect === "sqlserver") return `[${name}]`;
  return `"${name}"`;
}

/**
 * The physical, fully quoted name of a logical table or view.
 *
 * Postgres and SQL Server have real schemas and MySQL/MariaDB have one database
 * per logical schema, so the logical schema qualifies the name. SQLite has one
 * namespace; logical table names are unique across logical schemas so that
 * flattening works.
 */
export function physicalName(dialect: Dialect, table: { schema: string; name: string }): string {
  if (dialect === "sqlite") return quoteIdent(dialect, table.name);
  return `${quoteIdent(dialect, table.schema)}.${quoteIdent(dialect, table.name)}`;
}

/**
 * Physical name of the seeder's bookkeeping table: a `fixture` schema (Postgres,
 * SQL Server) or database (MySQL/MariaDB) outside the logical schemas, so a
 * filtered introspection never sees it. SQLite keeps its hash in a sidecar file.
 */
export function metaTable(dialect: Exclude<Dialect, "sqlite">): string {
  return `${quoteIdent(dialect, "fixture")}.${quoteIdent(dialect, "fixture_meta")}`;
}

/** Source files that decide how rows are loaded; a change to any of them forces a reseed. */
const SEEDER_SOURCES = ["src/seed.ts", "src/dataset.ts", "src/db.ts"];

/** Hash of everything that determines a dialect's seeded contents. */
export function datasetHash(dialect: Dialect): string {
  const hash = createHash("sha256");
  for (const file of SEEDER_SOURCES) hash.update(readFileSync(join(FIXTURE_ROOT, file)));
  hash.update(readFileSync(join(DATASET_DIR, "schema.logical.json")));
  hash.update(readFileSync(join(DATASET_DIR, "ddl", `${dialect}.sql`)));
  for (const file of readdirSync(join(DATASET_DIR, "data")).sort()) {
    hash.update(file);
    hash.update(readFileSync(join(DATASET_DIR, "data", file)));
  }
  return hash.digest("hex");
}
