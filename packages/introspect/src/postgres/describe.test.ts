import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describePostgres, foldIntrospectionResult } from "./describe.js";
import { createPostgresConnector } from "./index.js";
import {
  createSnapshotExecutor,
  loadCatalogSnapshot,
} from "./test-utils.js";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/introspect",
);

function loadFixture(name: string) {
  return loadCatalogSnapshot(resolve(FIXTURE_DIR, name));
}

describe("describePostgres — orders-users snapshot", () => {
  it("produces the expected SqlSchema for the canonical fixture", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const executor = createSnapshotExecutor(snapshot);

    const result = await describePostgres({
      executor,
      schemaId: "orders-users",
    });

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.viewDefinitions).toEqual({});

    expect(result.schema.schemaId).toBe("orders-users");
    expect(result.schema.schemas.map((s) => s.name)).toEqual(["public"]);

    const publicNs = result.schema.schemas[0]!;
    expect(publicNs.tables.map((t) => t.name)).toEqual(["orders", "users"]);

    const orders = publicNs.tables.find((t) => t.name === "orders")!;
    expect(orders.id).toBe("table:public.orders");
    expect(orders.columns.map((c) => c.name)).toEqual([
      "id",
      "user_id",
      "status",
      "total_amount",
    ]);
    expect(orders.columns[0]).toMatchObject({
      id: "table:public.orders#id",
      dataType: "uuid",
      udtName: "uuid",
      nullable: false,
      primaryKey: true,
      defaultExpression: "gen_random_uuid()",
    });
    expect(orders.primaryKey).toEqual({ columns: ["id"] });
    expect(orders.foreignKeys).toEqual([
      {
        name: "orders_user_id_fkey",
        columns: ["user_id"],
        references: {
          schema: "public",
          table: "users",
          columns: ["id"],
        },
        onDelete: "no action",
        onUpdate: "no action",
      },
    ]);

    const users = publicNs.tables.find((t) => t.name === "users")!;
    expect(users.uniqueConstraints).toEqual([
      { name: "users_email_key", columns: ["email"] },
    ]);
    expect(users.columns.find((c) => c.name === "created_at")).toMatchObject({
      dataType: "timestamp with time zone",
      udtName: "timestamptz",
      defaultExpression: "now()",
    });
  });

  it("is deterministic — two runs produce a byte-identical SqlSchema JSON", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const executor = createSnapshotExecutor(snapshot);

    const a = await describePostgres({ executor, schemaId: "orders-users" });
    const b = await describePostgres({ executor, schemaId: "orders-users" });

    expect(JSON.stringify(a.schema)).toBe(JSON.stringify(b.schema));
  });
});

describe("describePostgres — multi-column FK regression guard", () => {
  it("preserves declared conkey/confkey order for composite FKs", async () => {
    const snapshot = loadFixture("multi-column-fk.catalog.json");
    const executor = createSnapshotExecutor(snapshot);

    const result = await describePostgres({
      executor,
      schemaId: "multi-fk",
    });

    const inv = result.schema.schemas[0]!.tables.find(
      (t) => t.name === "store_inventory",
    )!;

    // PK column order matches declared key_position (tenant_id, store_code, sku).
    expect(inv.primaryKey?.columns).toEqual([
      "tenant_id",
      "store_code",
      "sku",
    ]);

    // Two composite FKs — order alphabetized by constraint name in output.
    const productsFk = inv.foreignKeys.find(
      (fk) => fk.name === "store_inventory_product_fk",
    )!;
    const storesFk = inv.foreignKeys.find(
      (fk) => fk.name === "store_inventory_store_fk",
    )!;

    // products FK: (tenant_id, sku) → products(tenant_id, sku)
    expect(productsFk.columns).toEqual(["tenant_id", "sku"]);
    expect(productsFk.references.columns).toEqual(["tenant_id", "sku"]);
    expect(productsFk.onDelete).toBe("restrict");

    // stores FK: (tenant_id, store_code) → stores(tenant_id, store_code)
    expect(storesFk.columns).toEqual(["tenant_id", "store_code"]);
    expect(storesFk.references.columns).toEqual(["tenant_id", "store_code"]);
    expect(storesFk.onDelete).toBe("cascade");
  });
});

describe("describePostgres — enum sort order regression guard", () => {
  it("preserves pg_enum.enumsortorder, not alphabetical order", async () => {
    const snapshot = loadFixture("enum-sort-order.catalog.json");
    const executor = createSnapshotExecutor(snapshot);

    const result = await describePostgres({
      executor,
      schemaId: "enums",
    });

    const enums = result.schema.schemas[0]!.enums;
    expect(enums).toHaveLength(1);
    expect(enums[0]!.name).toBe("ticket_status");
    expect(enums[0]!.values).toEqual([
      "open",
      "in_progress",
      "blocked",
      "resolved",
      "closed",
    ]);
  });
});

describe("describePostgres — filters", () => {
  it("default include = ['public']; system schemas always excluded", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const executor = createSnapshotExecutor(snapshot);

    const result = await describePostgres({ executor });

    // The fixture only contains 'public' — the default filter is satisfied.
    expect(result.schema.schemas.map((s) => s.name)).toEqual(["public"]);
  });

  it("table glob filters out unmatched tables and emits ambiguous_filter on no match", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const executor = createSnapshotExecutor(snapshot);

    const matched = await describePostgres({
      executor,
      filters: { tables: ["public.users"] },
    });
    expect(matched.schema.schemas[0]!.tables.map((t) => t.name)).toEqual([
      "users",
    ]);
    expect(matched.warnings).toEqual([]);

    const empty = await describePostgres({
      executor,
      filters: { tables: ["public.does_not_exist"] },
    });
    expect(empty.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.does_not_exist" },
    ]);
  });
});

describe("foldIntrospectionResult - live executor compatibility", () => {
  it("normalizes Postgres text-array literals for index columns", () => {
    const result = foldIntrospectionResult({
      schemaId: "indexes",
      declaredFilters: [],
      tableFilter: () => true,
      schemasRows: [{ schema_name: "public" }],
      tablesRows: [
        {
          schema_name: "public",
          table_name: "users",
          relkind: "r",
          row_level_security: false,
          comment: null,
        },
      ],
      columnsRows: [
        {
          schema_name: "public",
          table_name: "users",
          column_name: "email",
          ordinal_position: 1,
          data_type: "text",
          udt_schema: "pg_catalog",
          udt_name: "text",
          is_nullable: false,
          default_expression: null,
          comment: null,
        },
        {
          schema_name: "public",
          table_name: "users",
          column_name: "created_at",
          ordinal_position: 2,
          data_type: "timestamp with time zone",
          udt_schema: "pg_catalog",
          udt_name: "timestamptz",
          is_nullable: false,
          default_expression: null,
          comment: null,
        },
      ],
      pkRows: [],
      fkRows: [],
      uniqueRows: [],
      checkRows: [],
      indexRows: [
        {
          schema_name: "public",
          table_name: "users",
          index_name: "users_email_created_at_idx",
          is_unique: false,
          method: "btree",
          columns: "{email,created_at}" as unknown as string[],
          expressions: null,
        },
      ],
      enumRows: [],
      sequenceRows: [],
      viewRows: [],
      commentRows: [],
    });

    expect(result.schema.schemas[0]!.tables[0]!.indexes[0]!.columns).toEqual([
      "email",
      "created_at",
    ]);
  });
});

describe("createPostgresConnector wiring", () => {
  it("describe() routes live mode through describePostgres", async () => {
    const snapshot = loadFixture("orders-users.catalog.json");
    const connector = createPostgresConnector();
    const result = await connector.describe({
      mode: "live",
      executor: createSnapshotExecutor(snapshot),
    });
    expect(result.schema.schemaId).toBe("introspected");
    expect(result.schema.schemas[0]!.tables).toHaveLength(2);
  });

  it("templates() returns the canonical bundle with all 12 templates", () => {
    const connector = createPostgresConnector();
    const bundle = connector.templates();
    expect(bundle.engine).toBe("postgres");
    expect(bundle.version).toBe(1);
    const names = bundle.templates.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "check_constraints",
        "columns",
        "comments",
        "enums",
        "foreign_keys",
        "indexes",
        "primary_keys",
        "schemas",
        "sequences",
        "tables",
        "unique_constraints",
        "views",
      ].sort(),
    );
    for (const tpl of bundle.templates) {
      expect(tpl.sql).toMatch(/ORDER BY/i);
    }
  });

  it("describe() rejects missing from-export bundles with a clear error", async () => {
    const connector = createPostgresConnector();
    await expect(
      connector.describe({ mode: "from-export", bundlePath: "/tmp/x" }),
    ).rejects.toThrow(/missing manifest\.json/i);
  });
});
