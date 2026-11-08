import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSchema, loadSchemaFromJson } from "./loader.js";
import { formatSchemaV2ForNlToSql } from "./format.js";
import type { NormalizedSchemaV2, NormalizedV2Column, NormalizedV2Table } from "./normalized.js";

const here = dirname(fileURLToPath(import.meta.url));
const v2Dir = join(here, "../../../../../fixtures/schemas/orders-users.schema");
const v2SchemaJson = join(v2Dir, "schema.json");
const mentionsDir = join(here, "../../../../../fixtures/schemas/sensitive-mentions.schema");

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

  // customers.email and .phone are marked sensitive; users is a sensitive table, so users.ssn
  // counts only qualified. Every text below sits on a non-sensitive table or column (#374).
  it("withholds every table and column text that names a sensitive column", () => {
    const { ddl, stats } = formatSchemaV2ForNlToSql(loadSchema(mentionsDir), {
      omitSensitiveIdentifiersFromPrompt: true,
    });
    expect(ddl).not.toMatch(/email|phone|ssn/i);
    const lines = ddl.split("\n");
    // Each alias on its own: "people by email" goes, "clients" stays.
    expect(lines).toContain("TABLE public.customers -- aliases: clients");
    // A column's whole annotation goes when any part of it names one: enum values `email`, a description naming `phone`.
    expect(lines).toContain("  - contact_pref text (NULL)");
    expect(lines).toContain("  - status text (NOT NULL)");
    expect(lines).toContain("  - region text (NULL) -- aliases: territory; values: north|south; Sales region of the account.");
    // Text naming none stays, including another table's common query language.
    expect(lines).toContain('-- - "big orders" means `total > 10000`');
    // An alias, two descriptions, two column annotations and one common query language block.
    expect(stats.mentionDroppedCount).toBe(6);
  });

  it("keeps that text when sensitive names are listed tagged", () => {
    const { ddl, stats } = formatSchemaV2ForNlToSql(loadSchema(mentionsDir));
    expect(ddl).toContain("  - email text (NULL) (sensitive)");
    expect(ddl).toContain("-- Stores each customer's email and phone.");
    expect(ddl).toContain("-- Join to users.ssn to verify buyers.");
    expect(stats.mentionDroppedCount).toBe(0);
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

describe("formatSchemaV2ForNlToSql — foreign keys and concepts (#898)", () => {
  const col = (table: string, name: string, extra: Partial<NormalizedV2Column> = {}): NormalizedV2Column => ({
    id: `table:public.${table}#${name}`,
    name,
    type: "integer",
    nullable: false,
    primaryKey: name === "id",
    sensitive: false,
    ...extra,
  });
  const tbl = (name: string, columns: NormalizedV2Column[], extra: Partial<NormalizedV2Table> = {}): NormalizedV2Table => ({
    id: `table:public.${name}`,
    name,
    schema: "public",
    sensitive: false,
    columns,
    ...extra,
  });
  const fk = (from: string, to: string) => ({ from: `table:public.${from}`, to: `table:public.${to}` });
  // customers.ssn is a sensitive column, vault a sensitive table, archive untracked.
  const schemaWith = (concepts?: NormalizedSchemaV2["concepts"]): NormalizedSchemaV2 => ({
    schemaId: "fk",
    warnings: [],
    concepts,
    tables: [
      // Listed again on the target table: still printed once, under the table that owns the column.
      tbl("customers", [col("customers", "id"), col("customers", "ssn", { sensitive: true })], {
        relationships: [fk("orders#customer_id", "customers#id")],
      }),
      tbl("vault", [col("vault", "id", { sensitive: true, sensitiveFromTable: true })], { sensitive: true }),
      tbl("archive", [col("archive", "id")], { tracked: false }),
      tbl(
        "orders",
        [
          col("orders", "id"),
          col("orders", "customer_id"),
          col("orders", "vault_id"),
          col("orders", "tax_ref"),
          col("orders", "secret_ref", { sensitive: true }),
          col("orders", "archive_id"),
        ],
        {
          relationships: [
            fk("orders#customer_id", "customers#id"),
            fk("orders#vault_id", "vault#id"),
            fk("orders#tax_ref", "customers#ssn"),
            fk("orders#secret_ref", "customers#id"),
            fk("orders#archive_id", "archive#id"),
            fk("orders#missing", "customers#id"),
          ],
        },
      ),
    ],
  });
  const fkLines = (ddl: string) => ddl.split("\n").filter((line) => line.startsWith("  FK "));

  it("prints a foreign key after its table's columns, before its common query language", () => {
    const lines = formatSchemaV2ForNlToSql(loadSchema(v2Dir)).ddl.split("\n");
    const orders = lines.indexOf("TABLE public.orders -- aliases: purchases, sales, transactions");
    const key = lines.indexOf("  FK (user_id) -> public.users (id)");
    expect(key).toBeGreaterThan(lines.findIndex((line, i) => i > orders && line.startsWith("  - total_amount ")));
    expect(key).toBeLessThan(lines.findIndex((line, i) => i > orders && line === "-- common query language --"));
  });

  it("names a foreign key's tables and columns the way the prompt lists them", () => {
    const schema = loadSchema(v2Dir);
    expect(fkLines(formatSchemaV2ForNlToSql(schema, { unqualifiedNamespace: "public" }).ddl)).toEqual(["  FK (user_id) -> users (id)"]);
    expect(fkLines(formatSchemaV2ForNlToSql(schema, { quoteIdentifier: (name) => `"${name}"` }).ddl)).toEqual([
      '  FK ("user_id") -> "public"."users" ("id")',
    ]);
  });

  it("lists sensitive columns' foreign keys when sensitive names are listed tagged, never an untracked or unresolved one", () => {
    const { ddl } = formatSchemaV2ForNlToSql(schemaWith());
    expect(fkLines(ddl)).toEqual([
      "  FK (customer_id) -> public.customers (id)",
      "  FK (vault_id) -> public.vault (id)",
      "  FK (tax_ref) -> public.customers (ssn)",
      "  FK (secret_ref) -> public.customers (id)",
    ]);
    expect(ddl).not.toContain("archive (id)");
  });

  it("with omission on, leaves out every foreign key with a sensitive column or table on either side", () => {
    const { ddl } = formatSchemaV2ForNlToSql(schemaWith(), { omitSensitiveIdentifiersFromPrompt: true });
    expect(fkLines(ddl)).toEqual(["  FK (customer_id) -> public.customers (id)"]);
    expect(ddl).not.toMatch(/ssn|secret_ref|public\.vault \(|public\.archive/);
  });

  const concepts: NormalizedSchemaV2["concepts"] = [
    { id: "concept:buyer", label: "Buyer", synonyms: ["client"], links: ["table:public.customers"], description: "A customer with an order." },
    { id: "concept:identity", label: "Identity", links: ["table:public.customers#ssn"], description: "How we verify a customer." },
    { id: "concept:vaulted", label: "Vaulted", links: ["table:public.vault"] },
    { id: "concept:taxed", label: "Taxed", description: "Orders whose ssn was checked." },
    { id: "concept:old", label: "Old order", links: ["table:public.archive"] },
    { id: "concept:mixed", label: "Mixed", links: ["table:public.archive", "table:public.orders#customer_id"] },
    { id: "concept:loose", label: "Loose", links: ["table:public.nowhere"] },
  ];
  const conceptBlock = (ddl: string) => {
    const lines = ddl.split("\n");
    const start = lines.indexOf("-- concepts --");
    return start === -1 ? [] : lines.slice(start);
  };

  it("lists the schema's concepts after the tables", () => {
    const { ddl } = formatSchemaV2ForNlToSql(loadSchema(v2Dir));
    expect(conceptBlock(ddl)).toEqual([
      "-- concepts --",
      "-- Customer; synonyms: user, client, buyer, account holder; links: public.users; A person who has signed up and placed at least one order.",
      "-- Revenue; synonyms: sales, gross sales, top line; links: public.orders.total_amount; Sum of `orders.total_amount` where `status = 'paid'`, expressed in cents.",
    ]);
  });

  it("drops untracked links and a concept that only links untracked tables; keeps the rest tagged", () => {
    const { ddl } = formatSchemaV2ForNlToSql(schemaWith(concepts));
    expect(conceptBlock(ddl)).toEqual([
      "-- concepts --",
      "-- Buyer; synonyms: client; links: public.customers; A customer with an order.",
      "-- Identity; links: public.customers.ssn; How we verify a customer.",
      "-- Vaulted; links: public.vault",
      "-- Taxed; Orders whose ssn was checked.",
      "-- Mixed; links: public.orders.customer_id",
      "-- Loose",
    ]);
  });

  it("with omission on, withholds a concept that names or links a sensitive column or table", () => {
    const omitted = formatSchemaV2ForNlToSql(schemaWith(concepts), { omitSensitiveIdentifiersFromPrompt: true });
    expect(conceptBlock(omitted.ddl)).toEqual([
      "-- concepts --",
      "-- Buyer; synonyms: client; links: public.customers; A customer with an order.",
      "-- Mixed; links: public.orders.customer_id",
      "-- Loose",
    ]);
    const withoutConcepts = formatSchemaV2ForNlToSql(schemaWith(), { omitSensitiveIdentifiersFromPrompt: true });
    expect(omitted.stats.mentionDroppedCount).toBe(withoutConcepts.stats.mentionDroppedCount + 3);
  });

  it("adds no concepts block for a schema without concepts", () => {
    expect(formatSchemaV2ForNlToSql(schemaWith([])).ddl).not.toContain("-- concepts --");
    expect(formatSchemaV2ForNlToSql(schemaWith()).ddl).not.toContain("-- concepts --");
  });
});
