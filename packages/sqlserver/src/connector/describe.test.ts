import { describe, expect, it } from "vitest";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { describeSqlServer, SQLSERVER_CATALOG_SQL } from "./describe.js";

type RowMap = Record<string, ReadonlyArray<Record<string, unknown>>>;

function fakeRunner(rows: RowMap): CatalogQueryRunner {
  const bySql = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  bySql.set(SQLSERVER_CATALOG_SQL.tables, rows.tables ?? []);
  bySql.set(SQLSERVER_CATALOG_SQL.views, rows.views ?? []);
  bySql.set(SQLSERVER_CATALOG_SQL.columns, rows.columns ?? []);
  bySql.set(SQLSERVER_CATALOG_SQL.constraints, rows.constraints ?? []);
  bySql.set(SQLSERVER_CATALOG_SQL.foreign_keys, rows.foreign_keys ?? []);
  bySql.set(SQLSERVER_CATALOG_SQL.indexes, rows.indexes ?? []);
  return async (sql) => {
    const list = bySql.get(sql);
    if (!list) throw new Error(`fakeRunner: unknown SQL: ${sql.slice(0, 60)}…`);
    return rowsToResult(list);
  };
}

function rowsToResult(rows: ReadonlyArray<Record<string, unknown>>): CatalogQueryResult {
  if (rows.length === 0) return { columns: [], rows: [] };
  const columns = Object.keys(rows[0]!);
  return {
    columns,
    rows: rows.map((row) => columns.map((c) => row[c] ?? null)),
  };
}

describe("describeSqlServer", () => {
  it("folds tables + columns + PK + UNIQUE + FK + index into an IntrospectionResult", async () => {
    const runner = fakeRunner({
      tables: [
        { schema_name: "dbo", table_name: "users", table_type: "BASE TABLE" },
        { schema_name: "dbo", table_name: "orders", table_type: "BASE TABLE" },
      ],
      columns: [
        {
          schema_name: "dbo",
          table_name: "users",
          column_name: "id",
          ordinal_position: 1,
          type_name: "int",
          max_length: 4,
          precision_v: 10,
          scale: 0,
          is_nullable: 0,
        },
        {
          schema_name: "dbo",
          table_name: "users",
          column_name: "email",
          ordinal_position: 2,
          type_name: "nvarchar",
          max_length: 510,
          precision_v: 0,
          scale: 0,
          is_nullable: 0,
        },
        {
          schema_name: "dbo",
          table_name: "orders",
          column_name: "id",
          ordinal_position: 1,
          type_name: "int",
          max_length: 4,
          precision_v: 10,
          scale: 0,
          is_nullable: 0,
        },
        {
          schema_name: "dbo",
          table_name: "orders",
          column_name: "user_id",
          ordinal_position: 2,
          type_name: "int",
          max_length: 4,
          precision_v: 10,
          scale: 0,
          is_nullable: 0,
        },
        {
          schema_name: "dbo",
          table_name: "orders",
          column_name: "total",
          ordinal_position: 3,
          type_name: "decimal",
          max_length: 9,
          precision_v: 10,
          scale: 2,
          is_nullable: 1,
        },
      ],
      constraints: [
        {
          schema_name: "dbo",
          table_name: "users",
          constraint_name: "PK_users",
          column_name: "id",
          ordinal_position: 1,
          constraint_type: "PRIMARY KEY",
        },
        {
          schema_name: "dbo",
          table_name: "users",
          constraint_name: "UQ_users_email",
          column_name: "email",
          ordinal_position: 1,
          constraint_type: "UNIQUE",
        },
        {
          schema_name: "dbo",
          table_name: "orders",
          constraint_name: "PK_orders",
          column_name: "id",
          ordinal_position: 1,
          constraint_type: "PRIMARY KEY",
        },
      ],
      foreign_keys: [
        {
          schema_name: "dbo",
          table_name: "orders",
          constraint_name: "FK_orders_users",
          column_name: "user_id",
          ordinal_position: 1,
          referenced_schema: "dbo",
          referenced_table: "users",
          referenced_column: "id",
          update_action: 0,
          delete_action: 1,
        },
      ],
      indexes: [
        {
          schema_name: "dbo",
          table_name: "orders",
          index_name: "IX_orders_user_id",
          column_name: "user_id",
          ordinal_position: 1,
          is_unique: 0,
          method: "NONCLUSTERED",
        },
      ],
    });

    const result = await describeSqlServer({ runner, schemaId: "shop" });

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.provider).toBe("sqlserver");
    expect(result.schema.schemaId).toBe("shop");

    const ns = result.schema.schemas[0]!;
    expect(ns.name).toBe("dbo");
    expect(ns.tables.map((t) => t.name)).toEqual(["orders", "users"]);

    const users = ns.tables.find((t) => t.name === "users")!;
    expect(users.id).toBe("table:dbo.users");
    expect(users.primaryKey).toEqual({ columns: ["id"] });
    expect(users.uniqueConstraints).toEqual([
      { name: "UQ_users_email", columns: ["email"] },
    ]);
    expect(users.columns[1]).toMatchObject({
      // nvarchar max_length is bytes; precision-aware renderer halves it.
      dataType: "nvarchar(255)",
      udtName: "nvarchar",
    });

    const orders = ns.tables.find((t) => t.name === "orders")!;
    expect(orders.foreignKeys).toEqual([
      {
        name: "FK_orders_users",
        columns: ["user_id"],
        references: { schema: "dbo", table: "users", columns: ["id"] },
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);
    expect(orders.indexes).toEqual([
      {
        name: "IX_orders_user_id",
        columns: ["user_id"],
        unique: false,
        method: "NONCLUSTERED",
      },
    ]);
    expect(orders.columns.find((c) => c.name === "total")).toMatchObject({
      dataType: "decimal(10,2)",
      udtName: "decimal",
      nullable: true,
    });
  });

  it("renders views with their definition into viewDefinitions", async () => {
    const runner = fakeRunner({
      tables: [{ schema_name: "dbo", table_name: "users_v", table_type: "VIEW" }],
      views: [
        {
          schema_name: "dbo",
          view_name: "users_v",
          view_definition: "CREATE VIEW dbo.users_v AS SELECT id FROM dbo.users",
        },
      ],
      columns: [
        {
          schema_name: "dbo",
          table_name: "users_v",
          column_name: "id",
          ordinal_position: 1,
          type_name: "int",
          max_length: 4,
          precision_v: 10,
          scale: 0,
          is_nullable: 1,
        },
      ],
    });
    const result = await describeSqlServer({ runner });
    expect(result.schema.schemas[0]!.views).toHaveLength(1);
    expect(result.viewDefinitions["table:dbo.users_v"]).toContain("CREATE VIEW");
  });

  it("excludes system schemas by default", async () => {
    const runner = fakeRunner({
      tables: [
        { schema_name: "sys", table_name: "internal", table_type: "BASE TABLE" },
        { schema_name: "dbo", table_name: "users", table_type: "BASE TABLE" },
      ],
      columns: [
        {
          schema_name: "dbo",
          table_name: "users",
          column_name: "id",
          ordinal_position: 1,
          type_name: "int",
          max_length: 4,
          precision_v: 10,
          scale: 0,
          is_nullable: 0,
        },
        {
          schema_name: "sys",
          table_name: "internal",
          column_name: "id",
          ordinal_position: 1,
          type_name: "int",
          max_length: 4,
          precision_v: 10,
          scale: 0,
          is_nullable: 0,
        },
      ],
    });
    const result = await describeSqlServer({ runner });
    expect(result.schema.schemas.map((s) => s.name)).toEqual(["dbo"]);
  });

  it("marks isEmpty when nothing usable remains after filtering", async () => {
    const result = await describeSqlServer({ runner: fakeRunner({}) });
    expect(result.isEmpty).toBe(true);
    expect(result.schema.schemas).toEqual([]);
    expect(result.provider).toBe("sqlserver");
  });
});
