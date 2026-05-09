import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "@askdb/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describePostgres } from "../postgres/describe.js";
import {
  createSnapshotExecutor,
  loadCatalogSnapshot,
} from "../postgres/test-utils.js";
import type { SqlSchema } from "../types.js";
import {
  compactPostgresType,
  renderToSchemaV2,
  toV2SchemaJson,
} from "./render.js";

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
    executor: createSnapshotExecutor(snapshot),
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
      executor: createSnapshotExecutor(snapshot),
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

  it("rejects existingArtifactDir until milestone 6 lands the merge", () => {
    const empty: SqlSchema = { schemaId: "x", schemas: [] };
    expect(() =>
      renderToSchemaV2(empty, {
        outDir: workDir,
        schemaId: "x",
        existingArtifactDir: "/tmp/whatever",
      }),
    ).toThrow(/milestone 6/i);
  });
});

describe("toV2SchemaJson — pure form (no disk I/O)", () => {
  it("returns the same object renderToSchemaV2 writes", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const result = await describePostgres({
      executor: createSnapshotExecutor(snapshot),
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
      executor: createSnapshotExecutor(snapshot),
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
