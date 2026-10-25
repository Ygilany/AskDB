import { afterAll, beforeAll, expect, it } from "vitest";
import { unlink } from "fs/promises";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import type DatabaseCtor from "better-sqlite3";
import { createSqliteCatalogQueryRunner } from "./sqlite.js";
import { createSqliteConnector } from "../connector/index.js";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";

type Bs3Namespace = { default: typeof DatabaseCtor };

/** Returns why better-sqlite3 cannot be used here, or `null` when it loads and opens a DB. */
async function betterSqlite3Unavailable(): Promise<string | null> {
  try {
    const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
    const db = new mod.default(":memory:");
    db.close();
    return null;
  } catch (err) {
    return `better-sqlite3 could not be loaded (${err instanceof Error ? err.message : String(err)})`;
  }
}

// SQLite is file-based — no server or env gate, only the optional native peer. Under
// ASKDB_REQUIRE_INTEGRATION=1 a driver that fails to load fails the suite instead of skipping.
const sqliteSuite = integrationSuite({ unavailable: await betterSqlite3Unavailable() });
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
