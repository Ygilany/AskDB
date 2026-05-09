import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSchema } from "./loader.js";
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
  });

  it("includes common query language block", () => {
    const schema = loadSchema(v2Dir);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    expect(ddl).toContain("-- common query language --");
    expect(ddl).toContain("-- - \"sales\" usually means paid orders");
  });

  it("excludes sensitive column describable fields from DDL", () => {
    const schema = loadSchema(v2Dir);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    // email is sensitive — should be listed but no aliases/description
    expect(ddl).toContain("email");
    expect(ddl).toContain("(sensitive)");
    // No description or alias text for the email column
    const emailLine = ddl.split("\n").find((l) => l.includes("  - email"))!;
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
    const schema = loadSchema(v2SchemaJson);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    // No aliases annotation on TABLE line — just schema-qualified name
    expect(ddl).toContain("TABLE public.orders\n");
    expect(ddl).not.toContain("aliases:");
    expect(ddl).not.toContain("-- common query language");
  });

  it("still lists tables and columns with qualified names", () => {
    const schema = loadSchema(v2SchemaJson);
    const { ddl } = formatSchemaV2ForNlToSql(schema);
    expect(ddl).toContain("TABLE public.users");
    expect(ddl).toContain("TABLE public.orders");
    expect(ddl).toContain("  - email");
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
});
