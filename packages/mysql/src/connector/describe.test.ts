import { describe, expect, it } from "vitest";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { describeMysql, MYSQL_CATALOG_SQL } from "./describe.js";

type RowMap = Record<string, ReadonlyArray<Record<string, unknown>>>;

/**
 * Build a fake runner that dispatches on the exact catalog SQL the connector
 * issues. Each entry is the table-name suffix used by `MYSQL_CATALOG_SQL`.
 */
function fakeRunner(rows: RowMap): CatalogQueryRunner {
  const bySql = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  bySql.set(MYSQL_CATALOG_SQL.tables, rows.tables ?? []);
  bySql.set(MYSQL_CATALOG_SQL.columns, rows.columns ?? []);
  bySql.set(MYSQL_CATALOG_SQL.constraints, rows.constraints ?? []);
  bySql.set(MYSQL_CATALOG_SQL.foreign_keys, rows.foreign_keys ?? []);
  bySql.set(MYSQL_CATALOG_SQL.indexes, rows.indexes ?? []);
  bySql.set(MYSQL_CATALOG_SQL.views, rows.views ?? []);
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

describe("describeMysql", () => {
  it("folds basic tables + columns + PK + FK + indexes into an IntrospectionResult", async () => {
    const runner = fakeRunner({
      tables: [
        { table_name: "users", table_type: "BASE TABLE", table_comment: "" },
        { table_name: "orders", table_type: "BASE TABLE", table_comment: "" },
      ],
      columns: [
        {
          table_name: "users",
          column_name: "id",
          ordinal_position: 1,
          column_default: null,
          is_nullable: "NO",
          data_type: "int",
          column_type: "int unsigned",
          column_key: "PRI",
          extra: "auto_increment",
          column_comment: "",
        },
        {
          table_name: "users",
          column_name: "email",
          ordinal_position: 2,
          column_default: null,
          is_nullable: "NO",
          data_type: "varchar",
          column_type: "varchar(255)",
          column_key: "UNI",
          extra: "",
          column_comment: "",
        },
        {
          table_name: "orders",
          column_name: "id",
          ordinal_position: 1,
          column_default: null,
          is_nullable: "NO",
          data_type: "int",
          column_type: "int unsigned",
          column_key: "PRI",
          extra: "auto_increment",
          column_comment: "",
        },
        {
          table_name: "orders",
          column_name: "user_id",
          ordinal_position: 2,
          column_default: null,
          is_nullable: "NO",
          data_type: "int",
          column_type: "int unsigned",
          column_key: "MUL",
          extra: "",
          column_comment: "",
        },
      ],
      constraints: [
        {
          constraint_name: "PRIMARY",
          table_name: "users",
          column_name: "id",
          ordinal_position: 1,
          constraint_type: "PRIMARY KEY",
        },
        {
          constraint_name: "users_email_key",
          table_name: "users",
          column_name: "email",
          ordinal_position: 1,
          constraint_type: "UNIQUE",
        },
        {
          constraint_name: "PRIMARY",
          table_name: "orders",
          column_name: "id",
          ordinal_position: 1,
          constraint_type: "PRIMARY KEY",
        },
      ],
      foreign_keys: [
        {
          constraint_name: "orders_user_id_fkey",
          table_name: "orders",
          column_name: "user_id",
          referenced_table_name: "users",
          referenced_column_name: "id",
          ordinal_position: 1,
          update_rule: "CASCADE",
          delete_rule: "RESTRICT",
        },
      ],
      indexes: [
        {
          table_name: "orders",
          index_name: "orders_user_id_idx",
          column_name: "user_id",
          seq_in_index: 1,
          non_unique: 1,
          index_type: "BTREE",
        },
      ],
      views: [],
    });

    const result = await describeMysql({ runner, schemaId: "shop" });

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.provider).toBe("mysql");
    expect(result.schema.schemaId).toBe("shop");
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
      dataType: "int unsigned",
      udtName: "int",
      nullable: false,
      primaryKey: true,
    });
    expect(users.columns[1]).toMatchObject({
      dataType: "varchar(255)",
      udtName: "varchar",
      nullable: false,
      primaryKey: false,
    });

    const orders = ns.tables.find((t) => t.name === "orders")!;
    expect(orders.foreignKeys).toEqual([
      {
        name: "orders_user_id_fkey",
        columns: ["user_id"],
        references: { schema: "public", table: "users", columns: ["id"] },
        onDelete: "restrict",
        onUpdate: "cascade",
      },
    ]);
    expect(orders.indexes).toEqual([
      {
        name: "orders_user_id_idx",
        columns: ["user_id"],
        unique: false,
        method: "BTREE",
      },
    ]);
  });

  it("renders views with their definition into viewDefinitions", async () => {
    const runner = fakeRunner({
      tables: [{ table_name: "users_v", table_type: "VIEW", table_comment: "" }],
      columns: [
        {
          table_name: "users_v",
          column_name: "id",
          ordinal_position: 1,
          column_default: null,
          is_nullable: "NO",
          data_type: "int",
          column_type: "int unsigned",
          column_key: "",
          extra: "",
          column_comment: "",
        },
      ],
      views: [
        {
          table_name: "users_v",
          view_definition: "select `id` from `users`",
        },
      ],
    });
    const result = await describeMysql({ runner });

    expect(result.schema.schemas[0]!.views).toHaveLength(1);
    expect(result.viewDefinitions["table:public.users_v"]).toBe("select `id` from `users`");
  });

  it("marks isEmpty when no tables or views are present", async () => {
    const runner = fakeRunner({});
    const result = await describeMysql({ runner });
    expect(result.isEmpty).toBe(true);
    expect(result.schema.schemas).toEqual([]);
    expect(result.provider).toBe("mysql");
  });

  it("filters tables with glob patterns and emits ambiguous_filter warning for misses", async () => {
    const runner = fakeRunner({
      tables: [
        { table_name: "users", table_type: "BASE TABLE", table_comment: "" },
        { table_name: "orders", table_type: "BASE TABLE", table_comment: "" },
      ],
      columns: [
        {
          table_name: "users",
          column_name: "id",
          ordinal_position: 1,
          column_default: null,
          is_nullable: "NO",
          data_type: "int",
          column_type: "int",
          column_key: "PRI",
          extra: "",
          column_comment: "",
        },
        {
          table_name: "orders",
          column_name: "id",
          ordinal_position: 1,
          column_default: null,
          is_nullable: "NO",
          data_type: "int",
          column_type: "int",
          column_key: "PRI",
          extra: "",
          column_comment: "",
        },
      ],
    });

    const result = await describeMysql({
      runner,
      filters: { tables: ["public.users", "public.missing_*"] },
    });

    expect(result.schema.schemas[0]!.tables.map((t) => t.name)).toEqual(["users"]);
    expect(result.warnings).toEqual([{ code: "ambiguous_filter", filter: "public.missing_*" }]);
  });
});
