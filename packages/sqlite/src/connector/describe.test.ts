import { describe, expect, it } from "vitest";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { describeSqlite, SQLITE_CATALOG_SQL } from "./describe.js";

type RowMap = Record<string, ReadonlyArray<Record<string, unknown>>>;

function fakeRunner(rows: RowMap): CatalogQueryRunner {
  const bySql = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  bySql.set(SQLITE_CATALOG_SQL.objects, rows.objects ?? []);
  bySql.set(SQLITE_CATALOG_SQL.columns, rows.columns ?? []);
  bySql.set(SQLITE_CATALOG_SQL.foreign_keys, rows.foreign_keys ?? []);
  bySql.set(SQLITE_CATALOG_SQL.index_list, rows.index_list ?? []);
  bySql.set(SQLITE_CATALOG_SQL.index_info, rows.index_info ?? []);
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

describe("describeSqlite", () => {
  it("folds tables + columns + PK + FK + unique index into an IntrospectionResult", async () => {
    const runner = fakeRunner({
      objects: [
        { name: "orders", type: "table", sql: "CREATE TABLE orders (...)" },
        { name: "users", type: "table", sql: "CREATE TABLE users (...)" },
      ],
      columns: [
        // pragma_table_info.cid is 0-based; pk is 1-based on PK members
        {
          table_name: "users",
          cid: 0,
          column_name: "id",
          type: "INTEGER",
          notnull: 1,
          dflt_value: null,
          pk: 1,
        },
        {
          table_name: "users",
          cid: 1,
          column_name: "email",
          type: "TEXT",
          notnull: 1,
          dflt_value: null,
          pk: 0,
        },
        {
          table_name: "orders",
          cid: 0,
          column_name: "id",
          type: "INTEGER",
          notnull: 1,
          dflt_value: null,
          pk: 1,
        },
        {
          table_name: "orders",
          cid: 1,
          column_name: "user_id",
          type: "INTEGER",
          notnull: 1,
          dflt_value: null,
          pk: 0,
        },
      ],
      foreign_keys: [
        {
          table_name: "orders",
          fk_id: 0,
          seq: 0,
          referenced_table: "users",
          column_name: "user_id",
          referenced_column: "id",
          on_update: "NO ACTION",
          on_delete: "CASCADE",
        },
      ],
      index_list: [
        // origin='u' (user-declared) + unique=1 → UNIQUE constraint
        {
          table_name: "users",
          index_name: "users_email_key",
          is_unique: 1,
          origin: "u",
        },
        // origin='c' (auto from CREATE INDEX) + unique=0 → plain index
        {
          table_name: "orders",
          index_name: "orders_user_id_idx",
          is_unique: 0,
          origin: "c",
        },
      ],
      index_info: [
        {
          table_name: "users",
          index_name: "users_email_key",
          seqno: 0,
          cid: 1,
          column_name: "email",
        },
        {
          table_name: "orders",
          index_name: "orders_user_id_idx",
          seqno: 0,
          cid: 1,
          column_name: "user_id",
        },
      ],
    });

    const result = await describeSqlite({ runner, schemaId: "shop" });

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.provider).toBe("sqlite");
    expect(result.schema.schemas).toHaveLength(1);

    const ns = result.schema.schemas[0]!;
    expect(ns.name).toBe("public");
    expect(ns.tables.map((t) => t.name)).toEqual(["orders", "users"]);

    const users = ns.tables.find((t) => t.name === "users")!;
    expect(users.id).toBe("table:public.users");
    expect(users.primaryKey).toEqual({ columns: ["id"] });
    expect(users.uniqueConstraints).toEqual([
      { name: "users_email_key", columns: ["email"] },
    ]);
    expect(users.columns[0]).toMatchObject({
      id: "table:public.users#id",
      ordinalPosition: 1,
      dataType: "INTEGER",
      udtName: "INTEGER",
      nullable: false,
      primaryKey: true,
    });

    const orders = ns.tables.find((t) => t.name === "orders")!;
    expect(orders.foreignKeys).toEqual([
      {
        name: "orders_user_id_fkey",
        columns: ["user_id"],
        references: { schema: "public", table: "users", columns: ["id"] },
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);
    expect(orders.indexes).toEqual([
      {
        name: "orders_user_id_idx",
        columns: ["user_id"],
        unique: false,
        method: "btree",
      },
    ]);
  });

  it("skips origin='pk' indexes (PK is captured via pragma_table_info.pk)", async () => {
    const runner = fakeRunner({
      objects: [{ name: "users", type: "table", sql: "" }],
      columns: [
        {
          table_name: "users",
          cid: 0,
          column_name: "id",
          type: "INTEGER",
          notnull: 1,
          dflt_value: null,
          pk: 1,
        },
      ],
      index_list: [
        { table_name: "users", index_name: "sqlite_autoindex_users_1", is_unique: 1, origin: "pk" },
      ],
      index_info: [
        {
          table_name: "users",
          index_name: "sqlite_autoindex_users_1",
          seqno: 0,
          cid: 0,
          column_name: "id",
        },
      ],
    });
    const result = await describeSqlite({ runner });
    const users = result.schema.schemas[0]!.tables[0]!;
    expect(users.indexes).toEqual([]);
    expect(users.uniqueConstraints).toEqual([]);
    expect(users.primaryKey).toEqual({ columns: ["id"] });
  });

  it("captures views with their CREATE VIEW SQL", async () => {
    const runner = fakeRunner({
      objects: [
        { name: "active_users", type: "view", sql: "CREATE VIEW active_users AS SELECT * FROM users" },
      ],
      columns: [
        {
          table_name: "active_users",
          cid: 0,
          column_name: "id",
          type: "INTEGER",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        },
      ],
    });
    const result = await describeSqlite({ runner });
    expect(result.schema.schemas[0]!.views).toHaveLength(1);
    expect(result.viewDefinitions["table:public.active_users"]).toContain("CREATE VIEW");
  });

  it("marks isEmpty when no tables or views are present", async () => {
    const result = await describeSqlite({ runner: fakeRunner({}) });
    expect(result.isEmpty).toBe(true);
    expect(result.schema.schemas).toEqual([]);
    expect(result.provider).toBe("sqlite");
  });
});
