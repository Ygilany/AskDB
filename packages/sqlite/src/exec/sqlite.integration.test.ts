import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unlink } from "fs/promises";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import type DatabaseCtor from "better-sqlite3";
import { createSqliteCatalogQueryRunner } from "./sqlite.js";
import { createSqliteConnector } from "../connector/index.js";

type Bs3Namespace = { default: typeof DatabaseCtor };

async function isBetterSqlite3Available(): Promise<boolean> {
  try {
    const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
    const db = new mod.default(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

const sqliteAvailable = await isBetterSqlite3Available();
const sqliteSuite = sqliteAvailable ? describe : describe.skip;

// SQLite is file-based — no server or env gate required when the optional peer is installed.
sqliteSuite("SQLite integration (better-sqlite3 driver)", () => {
  let dbPath: string;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `askdb-sqlite-integ-${randomBytes(6).toString("hex")}.db`);
    // Open in write mode to seed the schema, then the runner opens it readonly.
    const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
    const Database = mod.default;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE
      );
      CREATE TABLE posts (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title   TEXT NOT NULL
      );
      CREATE INDEX idx_posts_user ON posts (user_id);
      CREATE VIEW active_users AS SELECT id, email FROM users;
    `);
    db.close();
  });

  afterAll(async () => {
    await unlink(dbPath).catch(() => undefined);
  });

  it("runner returns columns and rows for a simple SELECT", async () => {
    const runner = createSqliteCatalogQueryRunner(dbPath);
    const result = await runner("SELECT 42 AS n, 'ok' AS label");
    expect(result.columns).toEqual(["n", "label"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual([42, "ok"]);
  });

  it("connector describes a live SQLite schema with the seeded tables", async () => {
    const runner = createSqliteCatalogQueryRunner(dbPath);
    const result = await createSqliteConnector().describe({ mode: "live", runner });

    expect(result.provider).toBe("sqlite");
    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);

    const ns = result.schema.schemas[0]!;
    expect(ns.name).toBe("public");

    const tableNames = ns.tables.map((t) => t.name);
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("posts");

    const users = ns.tables.find((t) => t.name === "users")!;
    expect(users.primaryKey?.columns).toEqual(["id"]);

    const emailCol = users.columns.find((c) => c.name === "email")!;
    expect(emailCol.nullable).toBe(false);

    const posts = ns.tables.find((t) => t.name === "posts")!;
    expect(posts.foreignKeys).toHaveLength(1);
    expect(posts.foreignKeys[0]!.references.table).toBe("users");
    // Explicit index (not the PK or UNIQUE column-level auto-index)
    const explicitIdx = posts.indexes.find((i) => i.name === "idx_posts_user");
    expect(explicitIdx).toBeDefined();

    const viewNames = ns.views.map((v) => v.name);
    expect(viewNames).toContain("active_users");
  });
});
