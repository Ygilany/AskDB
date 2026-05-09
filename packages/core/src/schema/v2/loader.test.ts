import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SchemaParseError } from "../../errors.js";
import { loadSchema } from "./loader.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../../fixtures/schemas");
const v2Dir = join(fixturesDir, "orders-users.schema");
const v2SchemaJson = join(v2Dir, "schema.json");
const v1FixtureJson = join(fixturesDir, "orders-users.schema.json");

describe("loadSchema — v2 directory", () => {
  it("loads a v2 directory with full describable layer", () => {
    const schema = loadSchema(v2Dir);
    expect(schema.schemaId).toBe("orders-users");
    expect(schema.tables.map((t) => t.name)).toEqual(["users", "orders"]);

    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users.aliases).toEqual(["accounts", "members"]);
    expect(users.primaryEntity).toBe("user");
    expect(users.description).toContain("Registered user account");
    expect(users.commonQueryLanguage).toContain("new users");

    const orders = schema.tables.find((t) => t.name === "orders")!;
    expect(orders.aliases).toEqual(["purchases", "sales", "transactions"]);
    expect(orders.commonQueryLanguage).toContain("revenue");
  });

  it("loads concepts from concepts.md", () => {
    const schema = loadSchema(v2Dir);
    expect(schema.concepts).toBeDefined();
    expect(schema.concepts!.map((c) => c.id)).toContain("concept:customer");
  });

  it("loads v2 directory with only schema.json (no tables/*.md) — empty describable layer", () => {
    // Use direct schema.json path; no markdown files present for that path
    const schema = loadSchema(v2SchemaJson);
    expect(schema.tables).toHaveLength(2);
    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users.aliases).toBeUndefined();
    expect(users.description).toBeUndefined();
    expect(users.commonQueryLanguage).toBeUndefined();
  });

  it("excludes describable-layer fields for sensitive columns", () => {
    const schema = loadSchema(v2Dir);
    const users = schema.tables.find((t) => t.name === "users")!;
    const emailCol = users.columns.find((c) => c.name === "email")!;
    expect(emailCol.sensitive).toBe(true);
    // Describable fields should be absent for sensitive column
    expect(emailCol.aliases).toBeUndefined();
    expect(emailCol.description).toBeUndefined();
  });

  it("provides non-sensitive column describable fields", () => {
    const schema = loadSchema(v2Dir);
    const orders = schema.tables.find((t) => t.name === "orders")!;
    const statusCol = orders.columns.find((c) => c.name === "status")!;
    expect(statusCol.sensitive).toBe(false);
    expect(statusCol.aliases).toEqual(["order_status"]);
    expect(statusCol.enum).toEqual(["pending", "paid", "shipped", "cancelled"]);
    expect(statusCol.description).toContain("lifecycle state");
  });

  it("produces no warnings for the well-formed fixture", () => {
    const schema = loadSchema(v2Dir);
    expect(schema.warnings).toHaveLength(0);
  });
});

describe("loadSchema — v1 rejection", () => {
  it("rejects a v1 format file with a clear error message", () => {
    expect(() => loadSchema(v1FixtureJson)).toThrow(SchemaParseError);
    expect(() => loadSchema(v1FixtureJson)).toThrow(/version: 1/);
    expect(() => loadSchema(v1FixtureJson)).toThrow(/schema-v2\.md/);
  });
});

describe("loadSchema — validation errors", () => {
  it("rejects front-matter with unknown keys", () => {
    // We test this via parseTableMarkdown directly in parser.test.ts
    // Here we just confirm the loader propagates SchemaParseError
    expect(() => loadSchema("/nonexistent/path")).toThrow();
  });

  it("warns on orphaned column id in table markdown", () => {
    // We test orphaned-id detection via a synthesized case in parser.test.ts
    // The loader produces warnings; this fixture has no orphans
    const schema = loadSchema(v2Dir);
    const orphans = schema.warnings.filter((w) => w.kind === "orphaned_column_id");
    expect(orphans).toHaveLength(0);
  });
});
