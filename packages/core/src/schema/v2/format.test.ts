import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSchema, loadSchemaFromJson } from "./loader.js";
import { formatSchemaV2ForNlToSql } from "./format.js";

const here = dirname(fileURLToPath(import.meta.url));
const v2Dir = join(here, "../../../../../fixtures/schemas/orders-users.schema");
const v2SchemaJson = join(v2Dir, "schema.json");

describe("formatSchemaV2ForNlToSql — enriched fixture", () => {
  it("includes qualified table name and aliases in the TABLE header line", () => {
    const schema = loadSchema(v2Dir);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    expect(ddl).toContain("TABLE public.orders -- aliases: purchases, sales, transactions");
  });

  it("includes table description as a comment line", () => {
    const schema = loadSchema(v2Dir);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    expect(ddl).toContain("-- Customer purchase orders");
  });

  it("includes column aliases and description on column lines", () => {
    const schema = loadSchema(v2Dir);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    // status column should have its enum and description
    expect(ddl).toContain("pending|paid|shipped|cancelled");
    expect(ddl).toContain("lifecycle state");
    expect(ddl).toContain("aliases: order_status");
  });

  it("includes common query language block", () => {
    const schema = loadSchema(v2Dir);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    expect(ddl).toContain("-- common query language --");
    expect(ddl).toContain("-- - \"sales\" usually means paid orders");
  });

  it("excludes sensitive column describable fields from DDL", () => {
    const schema = loadSchema(v2Dir);
    // The loader strips these from sensitive columns; set them here so only the formatter's own exclusion is under test.
    const email = schema.tables
      .find((t) => t.name === "users")!
      .columns.find((c) => c.name === "email")!;
    email.description = "Login address.";
    email.aliases = ["mail"];
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    const emailLine = ddl.split("\n").find((l) => l.includes("  - email"))!;
    expect(emailLine).toMatch(/\(sensitive\)$/);
    expect(emailLine).not.toContain("--");
  });

  it("counts listed sensitive columns correctly", () => {
    const schema = loadSchema(v2Dir);
    const { stats } = formatSchemaV2ForNlToSql(schema);
    expect(stats.listedSensitiveColumnCount).toBe(1); // only email
  });
});

describe("formatSchemaV2ForNlToSql — schema.json only (bare baseline)", () => {
  it("produces DDL without any aliases or descriptions (bare baseline)", () => {
    const schema = loadSchemaFromJson(readFileSync(v2SchemaJson, "utf8"));
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    // No aliases annotation on TABLE line — just schema-qualified name
    expect(ddl).toContain("TABLE public.orders\n");
    expect(ddl).toContain("TABLE public.users");
    expect(ddl).not.toContain("aliases:");
    expect(ddl).not.toContain("-- common query language");
  });
});

describe("formatSchemaV2ForNlToSql — omitSensitiveIdentifiersFromPrompt", () => {
  it("omits sensitive columns when flag is set", () => {
    const schema = loadSchema(v2Dir);
    const { ddl, stats } = formatSchemaV2ForNlToSql(schema, {
      omitSensitiveIdentifiersFromPrompt: true,
    });
    expect(ddl).not.toContain("email");
    expect(stats.redactedColumnCount).toBe(1);
    expect(stats.listedSensitiveColumnCount).toBe(0);
  });

  it("stubs a schema.json-sensitive table: keeps its name, withholds columns and prose", () => {
    const physical = JSON.parse(readFileSync(v2SchemaJson, "utf8")) as {
      tables: Array<{ id: string; sensitive: boolean }>;
    };
    physical.tables.find((t) => t.id === "table:public.orders")!.sensitive = true;
    const schema = loadSchemaFromJson(
      JSON.stringify({
        bundled: true,
        physical,
        tables: { "orders.md": readFileSync(join(v2Dir, "tables", "orders.md"), "utf8") },
      }),
    );
    const { ddl, stats } = formatSchemaV2ForNlToSql(schema, {
      omitSensitiveIdentifiersFromPrompt: true,
    });
    expect(ddl).toContain(
      "TABLE public.orders\n  (sensitive table — column definitions withheld from model context)",
    );
    expect(ddl).not.toContain("total_amount");
    expect(ddl).not.toContain("purchases");
    expect(ddl).not.toContain("Customer purchase orders");
    expect(stats.sensitiveTableStubCount).toBe(1);
    // users.email plus all four orders columns.
    expect(stats.redactedColumnCount).toBe(5);
  });
});

describe("formatSchemaV2ForNlToSql — ignored tables", () => {
  it("excludes untracked tables from full-schema prompt DDL", () => {
    const schema = loadSchema(v2Dir);
    const orders = schema.tables.find((table) => table.id === "table:public.orders");
    expect(orders).toBeDefined();
    orders!.tracked = false;

    const { ddl, stats } = formatSchemaV2ForNlToSql(schema);

    expect(ddl).not.toContain("TABLE public.orders");
    expect(ddl).toContain("TABLE public.users");
    expect(stats.untrackedTableCount).toBe(1);
  });
});
