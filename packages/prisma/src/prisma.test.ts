import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toV2SchemaJson } from "@askdb/introspect";
import { describe, expect, it } from "vitest";
import { createPrismaConnector, describePrismaSchema } from "./index.js";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../test-fixtures",
);

describe("describePrismaSchema", () => {
  it("describes a relational Prisma schema without a database connection", async () => {
    const result = await describePrismaSchema({
      schemaPath: resolve(FIXTURE_DIR, "simple/schema.prisma"),
      schemaId: "simple",
    });

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.viewDefinitions).toEqual({});
    expect(result.schema.schemas.map((ns) => ns.name)).toEqual(["public"]);

    const publicNs = result.schema.schemas[0]!;
    expect(publicNs.enums).toEqual([
      {
        schema: "public",
        name: "OrderStatus",
        values: ["pending", "paid", "shipped"],
      },
    ]);
    expect(publicNs.tables.map((table) => table.name)).toEqual(["Order", "User"]);

    const order = publicNs.tables.find((table) => table.name === "Order")!;
    expect(order.id).toBe("table:public.Order");
    expect(order.columns.map((column) => column.name)).toEqual([
      "id",
      "userId",
      "status",
      "total",
    ]);
    expect(order.columns[0]).toMatchObject({
      id: "table:public.Order#id",
      dataType: "Uuid",
      udtName: "String",
      nullable: false,
      primaryKey: true,
      defaultExpression: "uuid(4)",
    });
    expect(order.foreignKeys).toEqual([
      {
        name: "Order_userId_fkey",
        columns: ["userId"],
        references: {
          schema: "public",
          table: "User",
          columns: ["id"],
        },
        onDelete: "cascade",
      },
    ]);
    expect(order.uniqueConstraints).toEqual([
      {
        name: "orders_user_status_unique",
        columns: ["userId", "status"],
      },
    ]);
  });

  it("uses mapped physical table, column, enum, and index names", async () => {
    const result = await describePrismaSchema({
      schemaPath: resolve(FIXTURE_DIR, "mapped/schema.prisma"),
      schemaId: "mapped",
    });

    expect(result.warnings).toEqual([
      {
        code: "unsupported_type",
        column: "public.posts.metadata",
        type: "jsonb",
      },
    ]);

    const publicNs = result.schema.schemas[0]!;
    expect(publicNs.enums).toEqual([
      {
        schema: "public",
        name: "ticket_status",
        values: ["OPEN", "CLOSED"],
      },
    ]);
    expect(publicNs.tables.map((table) => table.name)).toEqual(["accounts", "posts"]);

    const accounts = publicNs.tables.find((table) => table.name === "accounts")!;
    expect(accounts.columns.map((column) => column.name)).toEqual([
      "account_id",
      "email",
    ]);

    const posts = publicNs.tables.find((table) => table.name === "posts")!;
    expect(posts.columns.map((column) => column.name)).toEqual([
      "id",
      "account_id",
      "title",
      "tags",
      "metadata",
      "status",
    ]);
    expect(posts.columns.find((column) => column.name === "tags")).toMatchObject({
      dataType: "String[]",
    });
    expect(posts.indexes).toEqual([
      {
        name: "posts_title_idx",
        columns: ["title"],
        unique: false,
        method: "normal",
      },
    ]);
    expect(posts.foreignKeys[0]).toMatchObject({
      columns: ["account_id"],
      references: { table: "accounts", columns: ["account_id"] },
      onUpdate: "restrict",
    });
  });

  it("supports schema directories and Prisma multiSchema metadata", async () => {
    const result = await describePrismaSchema({
      schemaPath: resolve(FIXTURE_DIR, "multifile"),
      schemaId: "shop",
    });

    expect(result.warnings).toEqual([]);
    expect(result.schema.schemas.map((ns) => ns.name)).toEqual(["shop"]);
    const shop = result.schema.schemas[0]!;
    expect(shop.tables.map((table) => table.name)).toEqual(["products", "tenants"]);

    const products = shop.tables.find((table) => table.name === "products")!;
    expect(products.primaryKey).toEqual({ columns: ["tenant_id", "sku"] });
    expect(products.foreignKeys).toEqual([
      {
        name: "products_tenant_id_tenant_code_fkey",
        columns: ["tenant_id", "tenant_code"],
        references: {
          schema: "shop",
          table: "tenants",
          columns: ["tenant_id", "code"],
        },
      },
    ]);
  });

  it("applies table filters and reports unmatched filters", async () => {
    const matched = await describePrismaSchema({
      schemaPath: resolve(FIXTURE_DIR, "simple/schema.prisma"),
      filters: { tables: ["public.User"] },
    });
    expect(matched.schema.schemas[0]!.tables.map((table) => table.name)).toEqual([
      "User",
    ]);
    expect(matched.warnings).toEqual([]);

    const empty = await describePrismaSchema({
      schemaPath: resolve(FIXTURE_DIR, "simple/schema.prisma"),
      filters: { tables: ["public.DoesNotExist"] },
    });
    expect(empty.isEmpty).toBe(true);
    expect(empty.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.DoesNotExist" },
    ]);
  });

  it("rejects MongoDB Prisma schemas", async () => {
    await expect(
      describePrismaSchema({
        schemaPath: resolve(FIXTURE_DIR, "mongo/schema.prisma"),
      }),
    ).rejects.toThrow(/unsupported Prisma datasource provider 'mongodb'/);
  });

  it("wires through the Connector contract and renders deterministic Schema v2 JSON", async () => {
    const connector = createPrismaConnector();
    const result = await connector.describe({
      schemaPath: resolve(FIXTURE_DIR, "simple/schema.prisma"),
      schemaId: "simple",
    });

    expect(JSON.stringify(result.schema)).toBe(JSON.stringify(result.schema));
    expect(toV2SchemaJson(result.schema, "simple")).toMatchSnapshot();
  });
});
