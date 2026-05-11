import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "@askdb/core";
import {
  compactPostgresType,
  renderToSchemaV2,
  toV2SchemaJson,
  type SqlSchema,
} from "@askdb/introspect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describePostgres } from "./describe.js";
import {
  createSnapshotCatalogQueryRunner,
  loadCatalogSnapshot,
} from "./test-utils.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, "../../../../fixtures/introspect");

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-render-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function renderOrdersUsers(): Promise<{ outDir: string; bytes: string }> {
  const snapshot = loadCatalogSnapshot(
    resolve(FIXTURE_DIR, "orders-users.catalog.json"),
  );
  const result = await describePostgres({
    runner: createSnapshotCatalogQueryRunner(snapshot),
    schemaId: "orders-users",
  });
  const outDir = join(workDir, "orders-users.schema");
  const render = renderToSchemaV2(result.schema, {
    outDir,
    schemaId: "orders-users",
  });
  const bytes = readFileSync(render.schemaJsonPath, "utf8");
  return { outDir, bytes };
}

describe("renderToSchemaV2 — clean write", () => {
  it("reproduces the orders-users golden byte-for-byte", async () => {
    const { bytes } = await renderOrdersUsers();
    const golden = readFileSync(
      resolve(FIXTURE_DIR, "orders-users.expected-schema.json"),
      "utf8",
    );
    expect(bytes).toBe(golden);
  });

  it("writes a JSON file the Phase 5 v2 loader accepts", async () => {
    const { outDir } = await renderOrdersUsers();
    const schema = loadSchema(outDir);
    expect(schema.schemaId).toBe("orders-users");
    expect(schema.tables.map((t) => t.name).sort()).toEqual(["orders", "users"]);
    expect(schema.warnings).toHaveLength(0);
  });

  it("is deterministic — two render runs produce a byte-identical schema.json", async () => {
    const a = await renderOrdersUsers();
    // Clean out and re-render with a fresh snapshot run to make sure we are
    // not just reading a cached file.
    rmSync(a.outDir, { recursive: true, force: true });
    const b = await renderOrdersUsers();
    expect(b.bytes).toBe(a.bytes);
  });

  it("ends with a trailing newline (matches Phase 5 fixtures)", async () => {
    const { bytes } = await renderOrdersUsers();
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.endsWith("}\n")).toBe(true);
  });

  it("uses 2-space indentation", async () => {
    const { bytes } = await renderOrdersUsers();
    expect(bytes).toContain('\n  "version": 2');
    expect(bytes).toContain('\n    {\n      "id": "table:public.orders"');
  });

  it("creates the output directory if missing", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const result = await describePostgres({
      runner: createSnapshotCatalogQueryRunner(snapshot),
      schemaId: "orders-users",
    });
    const nestedDir = join(workDir, "deeply", "nested", "out.schema");
    const render = renderToSchemaV2(result.schema, {
      outDir: nestedDir,
      schemaId: "orders-users",
    });
    expect(render.schemaJsonPath).toBe(resolve(nestedDir, "schema.json"));
    expect(() => readFileSync(render.schemaJsonPath, "utf8")).not.toThrow();
  });

  it("re-rendering with no DB change produces zero schema.json diff", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const result = await describePostgres({
      runner: createSnapshotCatalogQueryRunner(snapshot),
      schemaId: "orders-users",
    });
    const outDir = join(workDir, "orders-users.schema");
    const first = renderToSchemaV2(result.schema, {
      outDir,
      schemaId: "orders-users",
    });
    const before = readFileSync(first.schemaJsonPath, "utf8");

    const second = renderToSchemaV2(result.schema, {
      outDir,
      schemaId: "orders-users",
      existingArtifactDir: outDir,
    });

    expect(second.warnings).toEqual([]);
    expect(readFileSync(second.schemaJsonPath, "utf8")).toBe(before);
  });
});

describe("renderToSchemaV2 — ID-anchored merge", () => {
  it("preserves existing sensitive flags and warns for new columns", async () => {
    const schema = await loadOrdersUsersSqlSchema();
    const outDir = join(workDir, "orders-users.schema");
    renderToSchemaV2(schema, { outDir, schemaId: "orders-users" });
    editPhysical(outDir, (physical) => {
      physical.tables.find((table) => table.id === "table:public.users")!.columns.find(
        (column) => column.id === "table:public.users#email",
      )!.sensitive = true;
    });

    const next = cloneSqlSchema(schema);
    const users = next.schemas[0]!.tables.find((table) => table.name === "users")!;
    users.columns.push({
      id: "table:public.users#phone",
      name: "phone",
      ordinalPosition: 4,
      dataType: "text",
      udtName: "text",
      nullable: true,
      primaryKey: false,
    });

    const render = renderToSchemaV2(next, {
      outDir,
      schemaId: "orders-users",
      existingArtifactDir: outDir,
    });
    const physical = readPhysical(outDir);
    const email = physical.tables
      .find((table) => table.id === "table:public.users")!
      .columns.find((column) => column.id === "table:public.users#email")!;

    expect(email.sensitive).toBe(true);
    expect(render.warnings).toEqual([
      {
        code: "new_column",
        id: "table:public.users#phone",
        tableId: "table:public.users",
      },
    ]);
  });

  it("updates structural column fields while preserving IDs and sensitive flags", async () => {
    const schema = await loadOrdersUsersSqlSchema();
    const outDir = join(workDir, "orders-users.schema");
    renderToSchemaV2(schema, { outDir, schemaId: "orders-users" });
    editPhysical(outDir, (physical) => {
      physical.tables.find((table) => table.id === "table:public.users")!.columns.find(
        (column) => column.id === "table:public.users#email",
      )!.sensitive = true;
    });

    const next = cloneSqlSchema(schema);
    const email = next.schemas[0]!.tables
      .find((table) => table.name === "users")!
      .columns.find((column) => column.name === "email")!;
    email.dataType = "character varying(255)";
    email.udtName = "varchar";
    email.nullable = true;

    const render = renderToSchemaV2(next, {
      outDir,
      schemaId: "orders-users",
      existingArtifactDir: outDir,
    });

    const physicalEmail = readPhysical(outDir).tables
      .find((table) => table.id === "table:public.users")!
      .columns.find((column) => column.id === "table:public.users#email")!;
    expect(render.warnings).toEqual([]);
    expect(physicalEmail).toMatchObject({
      id: "table:public.users#email",
      type: "varchar(255)",
      nullable: true,
      sensitive: true,
    });
  });

  it("drops removed columns, warns for markdown orphan IDs, and leaves tables/*.md untouched", async () => {
    const schema = await loadOrdersUsersSqlSchema();
    const outDir = join(workDir, "orders-users.schema");
    renderToSchemaV2(schema, { outDir, schemaId: "orders-users" });
    const tableDir = join(outDir, "tables");
    mkdirSync(tableDir, { recursive: true });
    const markdownPath = join(tableDir, "orders.md");
    const markdown = [
      "---",
      "id: table:public.orders",
      "name: orders",
      "schemaId: orders-users",
      "columns:",
      "  - id: table:public.orders#status",
      "    description: Workflow status",
      "---",
      "# Orders",
      "",
      "Operational order records.",
      "",
    ].join("\n");
    writeFileSync(markdownPath, markdown, "utf8");

    const next = cloneSqlSchema(schema);
    const orders = next.schemas[0]!.tables.find((table) => table.name === "orders")!;
    orders.columns = orders.columns.filter((column) => column.name !== "status");

    const render = renderToSchemaV2(next, {
      outDir,
      schemaId: "orders-users",
      existingArtifactDir: outDir,
    });

    const physicalOrders = readPhysical(outDir).tables.find(
      (table) => table.id === "table:public.orders",
    )!;
    expect(physicalOrders.columns.map((column) => column.name)).not.toContain(
      "status",
    );
    expect(readFileSync(markdownPath, "utf8")).toBe(markdown);
    expect(render.warnings).toEqual([
      {
        code: "orphan_id",
        id: "table:public.orders#status",
        file: "tables/orders.md",
      },
    ]);
  });
});

describe("toV2SchemaJson — pure form (no disk I/O)", () => {
  it("returns the same object renderToSchemaV2 writes", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const result = await describePostgres({
      runner: createSnapshotCatalogQueryRunner(snapshot),
      schemaId: "orders-users",
    });
    const v2 = toV2SchemaJson(result.schema, "orders-users");
    expect(v2.version).toBe(2);
    expect(v2.schemaId).toBe("orders-users");
    expect(v2.tables.map((t) => t.name)).toEqual(["orders", "users"]);
    const orders = v2.tables.find((t) => t.name === "orders")!;
    expect(orders.relationships).toEqual([
      {
        from: "table:public.orders#user_id",
        to: "table:public.users#id",
      },
    ]);
  });

  it("emits one relationship per FK column pair (multi-column FK)", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "multi-column-fk.catalog.json"),
    );
    const result = await describePostgres({
      runner: createSnapshotCatalogQueryRunner(snapshot),
      schemaId: "multi-fk",
    });
    const v2 = toV2SchemaJson(result.schema, "multi-fk");
    const inv = v2.tables.find((t) => t.name === "store_inventory")!;
    expect(inv.relationships).toBeDefined();
    // 2 FKs × 2 columns each = 4 relationships, in declared (conkey) order
    // and grouped by FK constraint name (alphabetical).
    expect(inv.relationships).toEqual([
      {
        from: "table:public.store_inventory#tenant_id",
        to: "table:public.products#tenant_id",
      },
      {
        from: "table:public.store_inventory#sku",
        to: "table:public.products#sku",
      },
      {
        from: "table:public.store_inventory#tenant_id",
        to: "table:public.stores#tenant_id",
      },
      {
        from: "table:public.store_inventory#store_code",
        to: "table:public.stores#store_code",
      },
    ]);
  });
});

describe("compactPostgresType", () => {
  it("compacts SQL standard names to pg short forms", () => {
    expect(compactPostgresType("timestamp with time zone", "timestamptz")).toBe(
      "timestamptz",
    );
    expect(compactPostgresType("time with time zone", "timetz")).toBe("timetz");
    expect(compactPostgresType("timestamp without time zone", "timestamp")).toBe(
      "timestamp",
    );
    expect(compactPostgresType("character varying(255)", "varchar")).toBe(
      "varchar(255)",
    );
    expect(compactPostgresType("character(8)", "bpchar")).toBe("char(8)");
  });

  it("passes through types it does not recognize", () => {
    expect(compactPostgresType("uuid", "uuid")).toBe("uuid");
    expect(compactPostgresType("text", "text")).toBe("text");
    expect(compactPostgresType("integer", "int4")).toBe("integer");
    expect(compactPostgresType("numeric(10,2)", "numeric")).toBe("numeric(10,2)");
    expect(compactPostgresType("jsonb", "jsonb")).toBe("jsonb");
  });
});

async function loadOrdersUsersSqlSchema(): Promise<SqlSchema> {
  const snapshot = loadCatalogSnapshot(
    resolve(FIXTURE_DIR, "orders-users.catalog.json"),
  );
  const result = await describePostgres({
    runner: createSnapshotCatalogQueryRunner(snapshot),
    schemaId: "orders-users",
  });
  return result.schema;
}

function cloneSqlSchema(schema: SqlSchema): SqlSchema {
  return JSON.parse(JSON.stringify(schema)) as SqlSchema;
}

function readPhysical(outDir: string): ReturnType<typeof toV2SchemaJson> {
  return JSON.parse(readFileSync(join(outDir, "schema.json"), "utf8")) as ReturnType<
    typeof toV2SchemaJson
  >;
}

function editPhysical(
  outDir: string,
  edit: (physical: ReturnType<typeof toV2SchemaJson>) => void,
): void {
  const physical = readPhysical(outDir);
  edit(physical);
  writeFileSync(join(outDir, "schema.json"), JSON.stringify(physical, null, 2) + "\n");
}
