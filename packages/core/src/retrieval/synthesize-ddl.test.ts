import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "../schema/v2/loader.js";
import type { RetrievedChunkType, RetrievedResult } from "./types.js";
import { synthesizeRetrievedDdl } from "./synthesize-ddl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");
const ordersDir = join(fixturesDir, "orders-users.schema");
const mentionsDir = join(fixturesDir, "sensitive-mentions.schema");

describe("synthesizeRetrievedDdl — tenant-policy chunks", () => {
  it("includes every tenant-policy chunk in synthesized DDL", () => {
    const schema = loadSchema(multiTenantDir);
    const results: RetrievedResult[] = [
      {
        id: "chunk:tenant-policy#hierarchy",
        score: 0.9,
        payload: {
          id: "chunk:tenant-policy#hierarchy",
          type: "tenant-policy",
          text: "# Tenant policy — Hierarchy\nAgencies are the top-level tenants.",
          schemaId: schema.schemaId,
          refs: [],
          sensitive: false,
        },
      },
      {
        id: "chunk:tenant-policy#scope-rules",
        score: 0.85,
        payload: {
          id: "chunk:tenant-policy#scope-rules",
          type: "tenant-policy",
          text: "# Tenant policy — Scope rules\nScope rules description here.",
          schemaId: schema.schemaId,
          refs: [],
          sensitive: false,
        },
      },
      {
        id: "chunk:table:public.orders",
        score: 0.8,
        payload: {
          id: "chunk:table:public.orders",
          type: "table",
          text: "# public.orders\nOrders table",
          schemaId: schema.schemaId,
          refs: ["table:public.orders"],
          sensitive: false,
        },
      },
    ];

    const { ddl } = synthesizeRetrievedDdl({ schema, results });
    expect(ddl).toContain("-- tenant policy context --");
    expect(ddl).toContain("Scope rules description here.");
    expect(ddl).toContain("Agencies are the top-level tenants.");
    expect(ddl).toContain("TABLE public.orders");
  });

  it("does not include tenant-policy section when no such chunks exist", () => {
    const schema = loadSchema(ordersDir);
    const results: RetrievedResult[] = [
      {
        id: "chunk:table:public.orders",
        score: 0.8,
        payload: {
          id: "chunk:table:public.orders",
          type: "table",
          text: "# public.orders\nOrders table",
          schemaId: schema.schemaId,
          refs: ["table:public.orders"],
          sensitive: false,
        },
      },
    ];

    const { ddl } = synthesizeRetrievedDdl({ schema, results });
    expect(ddl).not.toContain("tenant policy context");
  });
});

describe("synthesizeRetrievedDdl — text that names a sensitive column (#374)", () => {
  // customers.email and .phone are marked sensitive; users is a sensitive table, so users.ssn
  // and users.id count only qualified. Chunks come from a retriever core can't vouch for: an
  // opt-in index flags them `sensitive`, a custom retriever or an older index doesn't.
  const chunk = (type: RetrievedChunkType, text: string, refs: string[], sensitive = false): RetrievedResult => ({
    id: `chunk:${type}:${text}`,
    score: 0.5,
    payload: { id: `chunk:${type}:${text}`, type, text, schemaId: "sensitive-mentions", refs, sensitive },
  });
  const results = [
    // @askdb/rag left the description out of this chunk; the DDL reads it from the schema.
    chunk("table", "# public.customers\nAliases: clients", ["table:public.customers"]),
    chunk("table", "# public.orders\nAliases: purchases", ["table:public.orders"]),
    chunk("cql", "# public.customers — common query language\n- \"reachable\" means a customer with an `email` on file", ["table:public.customers"], true),
    chunk("cql", "# public.orders — common query language\n- \"big orders\" means `total > 10000`", ["table:public.orders"]),
    chunk("concept", "# Concept: Contactable\nCustomers with a phone on file.", []),
    // Flagged for its link alone: the text names no sensitive column by the mention rule.
    chunk("concept", "# Concept: Account holder\nLinks: table:public.users#id", ["table:public.users#id"], true),
    chunk("concept", "# Concept: Big order\nAn order over 100 dollars.", []),
    chunk("question", "# public.customers — example question\nWhich customers have no email?", ["table:public.customers"]),
    chunk("tenant-policy", "# Tenant policy — Rules\nNever expose users.ssn.", []),
  ];

  it("with omission on, withholds every chunk and schema text that names one, and every chunk flagged sensitive", () => {
    const { ddl, mentionDroppedCount } = synthesizeRetrievedDdl({
      schema: loadSchema(mentionsDir),
      results,
      omitSensitiveIdentifiersFromPrompt: true,
    });
    expect(ddl).not.toMatch(/email|phone|ssn|users#id/i);
    const lines = ddl.split("\n");
    expect(lines).toContain("TABLE public.customers -- aliases: clients");
    expect(lines).toContain("  - region text (NULL) -- aliases: territory; values: north|south; Sales region of the account.");
    expect(lines).toContain('-- - "big orders" means `total > 10000`');
    expect(lines).toContain("-- An order over 100 dollars.");
    // From the schema: an alias, two descriptions, two column annotations. From the retriever: five chunks.
    expect(mentionDroppedCount).toBe(10);
  });

  it("keeps them when sensitive names are listed tagged", () => {
    const { ddl, mentionDroppedCount } = synthesizeRetrievedDdl({ schema: loadSchema(mentionsDir), results });
    expect(ddl).toContain("-- Stores each customer's email and phone.");
    expect(ddl).toContain("-- - \"reachable\" means a customer with an `email` on file");
    expect(ddl).toContain("-- Links: table:public.users#id");
    expect(mentionDroppedCount).toBe(0);
  });
});
