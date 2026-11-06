import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { SchemaParseError } from "../../errors.js";
import { parseConceptsMarkdown, parseTableMarkdown } from "./parser.js";
import { parseTenantPolicyMarkdown } from "./tenant-policy-loader.js";
import { writeConceptsMarkdown, writeTableMarkdown, writeTenantPolicyMarkdown } from "./writer.js";

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

    expect(parsed.frontmatter.id).toBe("table:public.orders");
    expect(parsed.frontmatter.name).toBe("orders");
    expect(parsed.frontmatter.schemaId).toBe("orders-users");
    expect(parsed.frontmatter.aliases).toEqual(["purchases", "sales", "transactions"]);
    expect(parsed.frontmatter.primaryEntity).toBe("order");
  });

  it("extracts column front-matter with descriptions, aliases, and enum", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);

    const statusCol = parsed.frontmatter.columns?.find((c) => c.id === "table:public.orders#status");
    expect(statusCol).toBeDefined();
    expect(statusCol!.enum).toEqual(["pending", "paid", "shipped", "cancelled"]);
    expect(statusCol!.aliases).toEqual(["order_status"]);
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
    const afterFrontmatter = content.slice(content.indexOf("\n---\n", 3) + "\n---\n".length);
    expect(parsed.body).toBe(afterFrontmatter);
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
    expect(() => parseTableMarkdown(bad, "fake.md")).toThrow(/^Invalid table front-matter in fake\.md: /);
  });

  it("accepts to-ignore aliases and normalizes them to tracked=false", () => {
    const camel = `---
id: table:orders
name: orders
schemaId: orders-users
toIgnore: true
---
Body.
`;
    const kebab = `---
id: table:orders
name: orders
schemaId: orders-users
to-ignore: true
---
Body.
`;

    expect(parseTableMarkdown(camel, "fake.md").frontmatter).toMatchObject({
      tracked: false,
    });
    expect(parseTableMarkdown(kebab, "fake.md").frontmatter).toMatchObject({
      tracked: false,
    });
  });

  it("rejects conflicting tracked and to-ignore aliases", () => {
    const bad = `---
id: table:orders
name: orders
schemaId: orders-users
tracked: true
to-ignore: true
---
Body.
`;
    expect(() => parseTableMarkdown(bad, "fake.md")).toThrow(SchemaParseError);
    expect(() => parseTableMarkdown(bad, "fake.md")).toThrow(/conflicts/);
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

  it("rejects front-matter with unknown keys, naming the concepts file", () => {
    const bad = "---\nconcepts: []\nunknownKey: should-fail\n---\nBody.\n";
    expect(() => parseConceptsMarkdown(bad, "fake.md")).toThrow(SchemaParseError);
    expect(() => parseConceptsMarkdown(bad, "fake.md")).toThrow(/^Invalid concepts front-matter in fake\.md: /);
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

  it("persists tracked=false in table front-matter", () => {
    const content = readFileSync(ordersPath, "utf8");
    const parsed = parseTableMarkdown(content, ordersPath);
    const written = writeTableMarkdown(
      { ...parsed.frontmatter, tracked: false },
      parsed.body,
    );
    const reparsed = parseTableMarkdown(written, ordersPath);

    expect(written).toContain("tracked: false");
    expect(reparsed.frontmatter.tracked).toBe(false);
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

describe("front-matter parsing keeps no state between calls (#742)", () => {
  it.each([
    ["table", parseTableMarkdown],
    ["concepts", parseConceptsMarkdown],
  ] as const)("reports malformed %s YAML on every parse, not only the first", (kind, parse) => {
    const bad = `---\nnote: [unclosed ${kind}\n---\nBody.\n`;
    const malformed = new RegExp(`^Malformed ${kind} front-matter YAML in x\\.md: `);
    expect(() => parse(bad, "x.md")).toThrow(malformed);
    expect(() => parse(bad, "x.md")).toThrow(malformed);
  });

  it("leaves nothing in gray-matter's cache after parsing or writing", () => {
    // gray-matter caches every input it parses without options, for the life of the process.
    const gm = matter as unknown as { cache: Record<string, unknown>; clearCache(): void };
    gm.clearCache();
    const orders = parseTableMarkdown(readFileSync(ordersPath, "utf8"), ordersPath);
    const concepts = parseConceptsMarkdown(readFileSync(conceptsPath, "utf8"), conceptsPath);
    const policyPath = join(here, "../../../../../fixtures/schemas/agency-multi-tenant.schema/tenant-policy.md");
    const policy = parseTenantPolicyMarkdown(readFileSync(policyPath, "utf8"), policyPath);
    writeTableMarkdown(orders.frontmatter, orders.body);
    writeConceptsMarkdown(concepts.frontmatter, concepts.body);
    writeTenantPolicyMarkdown(policy.frontmatter, policy.body);
    expect(Object.keys(gm.cache)).toEqual([]);
  });
});
