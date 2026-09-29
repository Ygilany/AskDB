/**
 * describeSqlite against a real in-memory SQLite database (better-sqlite3), so
 * the catalog SQL and PRAGMA semantics are exercised end to end — not just the
 * fold over hand-written rows. Skipped when the optional driver is missing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type DatabaseCtor from "better-sqlite3";
import type { CatalogQueryRunner, SqlTable } from "@askdb/introspect";
import { describeSqlite } from "./describe.js";

type Bs3Namespace = { default: typeof DatabaseCtor };
type Db = InstanceType<typeof DatabaseCtor>;

async function loadDriver(): Promise<Bs3Namespace | undefined> {
  try {
    const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
    new mod.default(":memory:").close();
    return mod;
  } catch {
    return undefined;
  }
}

const driver = await loadDriver();
const suite = driver ? describe : describe.skip;

function runnerFor(db: Db): CatalogQueryRunner {
  return async (sql) => {
    const stmt = db.prepare(sql);
    stmt.raw(true);
    const rows = stmt.all() as unknown[][];
    return { columns: stmt.columns().map((c) => c.name), rows };
  };
}

suite("describeSqlite (live in-memory database)", () => {
  let db: Db;
  beforeEach(() => {
    db = new driver!.default(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  async function tables(): Promise<SqlTable[]> {
    const result = await describeSqlite({ runner: runnerFor(db) });
    return result.schema.schemas[0]?.tables ?? [];
  }

  it("resolves `REFERENCES parent` (no column list) to the parent's primary key", async () => {
    db.exec(`
      CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors);
    `);
    const books = (await tables()).find((t) => t.name === "books")!;
    expect(books.foreignKeys).toHaveLength(1);
    expect(books.foreignKeys[0]!.columns).toEqual(["author_id"]);
    // Before the fix this was ["author_id"] — the child column name.
    expect(books.foreignKeys[0]!.references).toEqual({
      schema: "public",
      table: "authors",
      columns: ["id"],
    });
  });

  it("resolves composite implicit FK targets in PK ordinal order, case-insensitively", async () => {
    db.exec(`
      CREATE TABLE editions (code TEXT, year INTEGER, PRIMARY KEY (year, code));
      CREATE TABLE prints (
        id INTEGER PRIMARY KEY,
        ed_year INTEGER,
        ed_code TEXT,
        FOREIGN KEY (ed_year, ed_code) REFERENCES Editions
      );
    `);
    const prints = (await tables()).find((t) => t.name === "prints")!;
    expect(prints.foreignKeys[0]!.columns).toEqual(["ed_year", "ed_code"]);
    expect(prints.foreignKeys[0]!.references).toEqual({
      schema: "public",
      table: "editions",
      columns: ["year", "code"],
    });
  });

  it("keeps explicit FK target columns untouched", async () => {
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE);
      CREATE TABLE invites (id INTEGER PRIMARY KEY, email TEXT REFERENCES users(email));
    `);
    const invites = (await tables()).find((t) => t.name === "invites")!;
    expect(invites.foreignKeys[0]!.references.columns).toEqual(["email"]);
  });

  it("keeps user tables whose names merely resemble the internal `sqlite_` prefix", async () => {
    db.exec(`
      CREATE TABLE SqliteUsers (id INTEGER PRIMARY KEY);
      CREATE TABLE sqliteXlog (id INTEGER PRIMARY KEY);
      CREATE TABLE counters (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER);
      INSERT INTO counters (n) VALUES (1);
    `);
    const names = (await tables()).map((t) => t.name).sort();
    // AUTOINCREMENT creates the internal `sqlite_sequence`, which stays excluded.
    expect(names).toEqual(["SqliteUsers", "counters", "sqliteXlog"].sort());
  });

  it("classifies UNIQUE constraints (origin 'u') vs CREATE INDEX (origin 'c')", async () => {
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT UNIQUE, city TEXT);
      CREATE INDEX idx_people_city ON people (city);
    `);
    const people = (await tables()).find((t) => t.name === "people")!;
    expect(people.uniqueConstraints.map((u) => u.columns)).toEqual([["email"]]);
    const cityIdx = people.indexes.find((i) => i.name === "idx_people_city")!;
    expect(cityIdx.unique).toBe(false);
  });
});
