import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlCatalogQueryRunner } from "./mysql.js";
import { createMysqlConnector } from "../connector/index.js";

const url = process.env.MYSQL_DATABASE_URL;
const mysqlSuite = url ? describe : describe.skip;

mysqlSuite("MySQL integration (mysql2 driver)", () => {
  beforeAll(async () => {
    const mod = await import("mysql2/promise");
    const mysql = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const conn = await mysql.createConnection(url!);
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS integration_users (
          id    INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL
        )
      `);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS integration_posts (
          id      INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          title   VARCHAR(255) NOT NULL,
          CONSTRAINT fk_ipost_user FOREIGN KEY (user_id)
            REFERENCES integration_users (id)
        )
      `);
    } finally {
      await conn.end();
    }
  });

  afterAll(async () => {
    const mod = await import("mysql2/promise");
    const mysql = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const conn = await mysql.createConnection(url!);
    try {
      await conn.query("DROP TABLE IF EXISTS integration_posts");
      await conn.query("DROP TABLE IF EXISTS integration_users");
    } finally {
      await conn.end();
    }
  });

  it("runner returns columns and rows for a simple SELECT", async () => {
    const runner = createMysqlCatalogQueryRunner(url!);
    const result = await runner("SELECT 1 AS n, 'ok' AS label");
    expect(result.columns).toEqual(["n", "label"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual([1, "ok"]);
  });

  it("connector describes a live MySQL schema with the seeded tables", async () => {
    const runner = createMysqlCatalogQueryRunner(url!);
    const result = await createMysqlConnector().describe({ mode: "live", runner });

    expect(result.provider).toBe("mysql");
    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);

    const ns = result.schema.schemas[0]!;
    expect(ns.name).toBe("public");

    const tableNames = ns.tables.map((t) => t.name);
    expect(tableNames).toContain("integration_users");
    expect(tableNames).toContain("integration_posts");

    const users = ns.tables.find((t) => t.name === "integration_users")!;
    expect(users.primaryKey?.columns).toEqual(["id"]);

    const posts = ns.tables.find((t) => t.name === "integration_posts")!;
    expect(posts.foreignKeys).toHaveLength(1);
    expect(posts.foreignKeys[0]!.references.table).toBe("integration_users");
  });
});
