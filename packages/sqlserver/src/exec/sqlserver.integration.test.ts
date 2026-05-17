import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlServerCatalogQueryRunner } from "./sqlserver.js";
import { createSqlServerConnector } from "../connector/index.js";

type MssqlModule = typeof import("mssql");

const url = process.env.MSSQL_DATABASE_URL;
const mssqlSuite = url ? describe : describe.skip;

mssqlSuite("SQL Server integration (mssql driver)", () => {
  beforeAll(async () => {
    const mod = await import("mssql");
    const mssql = ((mod as unknown as { default?: MssqlModule }).default ?? mod) as MssqlModule;
    const pool = new mssql.ConnectionPool(url!);
    await pool.connect();
    try {
      // Clean slate — drop in reverse FK order in case a prior run left them.
      await pool
        .request()
        .query(
          "IF OBJECT_ID('dbo.integration_posts', 'U') IS NOT NULL DROP TABLE dbo.integration_posts",
        );
      await pool
        .request()
        .query(
          "IF OBJECT_ID('dbo.integration_users', 'U') IS NOT NULL DROP TABLE dbo.integration_users",
        );
      await pool.request().query(`
        CREATE TABLE dbo.integration_users (
          id    INT NOT NULL IDENTITY(1,1) PRIMARY KEY,
          email NVARCHAR(255) NOT NULL
        )
      `);
      await pool.request().query(`
        CREATE TABLE dbo.integration_posts (
          id      INT NOT NULL IDENTITY(1,1) PRIMARY KEY,
          user_id INT NOT NULL,
          title   NVARCHAR(255) NOT NULL,
          CONSTRAINT fk_ipost_user FOREIGN KEY (user_id)
            REFERENCES dbo.integration_users (id)
        )
      `);
    } finally {
      await pool.close();
    }
  });

  afterAll(async () => {
    const mod = await import("mssql");
    const mssql = ((mod as unknown as { default?: MssqlModule }).default ?? mod) as MssqlModule;
    const pool = new mssql.ConnectionPool(url!);
    await pool.connect();
    try {
      await pool
        .request()
        .query(
          "IF OBJECT_ID('dbo.integration_posts', 'U') IS NOT NULL DROP TABLE dbo.integration_posts",
        );
      await pool
        .request()
        .query(
          "IF OBJECT_ID('dbo.integration_users', 'U') IS NOT NULL DROP TABLE dbo.integration_users",
        );
    } finally {
      await pool.close();
    }
  });

  it("runner returns columns and rows for a simple SELECT", async () => {
    const runner = createSqlServerCatalogQueryRunner(url!);
    const result = await runner("SELECT 1 AS n, 'ok' AS label");
    expect(result.columns).toEqual(["n", "label"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual([1, "ok"]);
  });

  it("connector describes a live SQL Server schema with the seeded tables", async () => {
    const runner = createSqlServerCatalogQueryRunner(url!);
    const result = await createSqlServerConnector().describe({ mode: "live", runner });

    expect(result.provider).toBe("sqlserver");
    expect(result.warnings).toEqual([]);

    const allTableNames = result.schema.schemas.flatMap((s) =>
      s.tables.map((t) => `${s.name}.${t.name}`),
    );
    expect(allTableNames).toContain("dbo.integration_users");
    expect(allTableNames).toContain("dbo.integration_posts");

    const dboNs = result.schema.schemas.find((s) => s.name === "dbo")!;

    const users = dboNs.tables.find((t) => t.name === "integration_users")!;
    expect(users.primaryKey?.columns).toEqual(["id"]);

    const posts = dboNs.tables.find((t) => t.name === "integration_posts")!;
    expect(posts.foreignKeys).toHaveLength(1);
    expect(posts.foreignKeys[0]!.references.table).toBe("integration_users");
  });
});
