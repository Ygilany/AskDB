import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SchemaParseError } from "../../errors.js";
import { parseConceptsMarkdown, parseTableMarkdown } from "./parser.js";
import { writeConceptsMarkdown, writeTableMarkdown } from "./writer.js";

const here = dirname(fileURLToPath(import.meta.url));
const tablesDir = join(here, "../../../../../fixtures/schemas/orders-users.schema/tables");
const ordersPath = join(tablesDir, "orders.md");
const usersPath = join(tablesDir, "users.md");
const conceptsPath = join(
  here,
  "../../../../../fixtures/schemas/orders-users.schema/concepts.md",
);

describe("parseTableMarkdown", () => {
  it("parses orders.md front-matter correctly", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);

    expect(parsed.frontmatter.id).toBe("table:orders");
    expect(parsed.frontmatter.name).toBe("orders");
    expect(parsed.frontmatter.schemaId).toBe("orders-users");
    expect(parsed.frontmatter.aliases).toEqual(["purchases", "sales", "transactions"]);
    expect(parsed.frontmatter.primaryEntity).toBe("order");
  });

  it("extracts column front-matter with descriptions, aliases, and enum", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);

    const statusCol = parsed.frontmatter.columns?.find((c) => c.id === "table:orders#status");
    expect(statusCol).toBeDefined();
    expect(statusCol!.enum).toEqual(["pending", "paid", "shipped", "cancelled"]);
    expect(statusCol!.description).toContain("lifecycle state");
  });

  it("extracts recognized H2 sections", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);

    expect(parsed.sections["Common query language"]).toContain("revenue");
    expect(parsed.sections["Example questions"]).toContain("revenue");
    expect(parsed.sections["Business context"]).toContain("cents");
  });

  it("preserves body verbatim", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);
    expect(parsed.body).toContain("# Table: orders");
  });

  it("rejects front-matter with unknown keys", () => {
    const bad = `---
id: table:orders
name: orders
schemaId: orders-users
unknownKey: should-fail
---
Body.
`;
    expect(() => parseTableMarkdown(bad, "fake.md")).toThrow(SchemaParseError);
  });

  it("rejects missing required fields (id)", () => {
    const bad = `---
name: orders
schemaId: orders-users
---
Body.
`;
    expect(() => parseTableMarkdown(bad, "fake.md")).toThrow(SchemaParseError);
  });
});

describe("parseConceptsMarkdown", () => {
  it("parses concepts front-matter", () => {
    const content = readFileSync(conceptsPath, "utf8");
    const parsed = parseConceptsMarkdown(content, conceptsPath);
    expect(parsed.frontmatter.concepts).toHaveLength(2);
    expect(parsed.frontmatter.concepts[0].id).toBe("concept:customer");
    expect(parsed.frontmatter.concepts[0].synonyms).toContain("buyer");
  });
});

describe("writeTableMarkdown — round-trip", () => {
  it("round-trips orders.md with no changes to body bytes", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);
    const written = writeTableMarkdown(parsed.frontmatter, parsed.body);
    const reparsed = parseTableMarkdown(written, ordersPath);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.body).toBe(parsed.body);
  });

  it("round-trips users.md", () => {
    const content = readFileSync(usersPath, "utf8");
    const parsed = parseTableMarkdown(content, usersPath);
    const written = writeTableMarkdown(parsed.frontmatter, parsed.body);
    const reparsed = parseTableMarkdown(written, usersPath);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
  });

  it("adds an alias and only modifies the front-matter section", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);
    const modified = {
      ...parsed.frontmatter,
      aliases: [...(parsed.frontmatter.aliases ?? []), "invoices"],
    };
    const written = writeTableMarkdown(modified, parsed.body);
    expect(written).toContain("invoices");

    const reparsed = parseTableMarkdown(written, ordersPath);
    expect(reparsed.frontmatter.aliases).toContain("invoices");
    expect(reparsed.body).toBe(parsed.body);
  });
});

describe("writeConceptsMarkdown — round-trip", () => {
  it("round-trips concepts.md", () => {
    const content = readFileSync(conceptsPath, "utf8");
    const parsed = parseConceptsMarkdown(content, conceptsPath);
    const written = writeConceptsMarkdown(parsed.frontmatter, parsed.body);
    const reparsed = parseConceptsMarkdown(written, conceptsPath);

    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.body).toBe(parsed.body);
  });
});
