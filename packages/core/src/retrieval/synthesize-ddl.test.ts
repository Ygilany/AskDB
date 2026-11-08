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
    // Each section keeps its heading, so the model can tell the sections apart (#894).
    expect(ddl).toContain("-- Tenant policy — Scope rules; Scope rules description here.");
    expect(ddl).toContain("-- Tenant policy — Hierarchy; Agencies are the top-level tenants.");
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
    chunk("relationship", "Relationship: public.orders.customer_id references public.customers.email", ["table:public.orders"]),
    // The mention appears only once the prompt joins the lines: "users . ssn".
    chunk("question", "# public.orders — example question\nWhich buyers match users\n.\nssn?", ["table:public.orders"]),
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
    expect(lines).toContain("-- Concept: Big order; An order over 100 dollars.");
    // From the schema: an alias, two descriptions, two column annotations. From the retriever: seven chunks.
    expect(mentionDroppedCount).toBe(12);
  });

  it("keeps them when sensitive names are listed tagged", () => {
    const { ddl, mentionDroppedCount } = synthesizeRetrievedDdl({ schema: loadSchema(mentionsDir), results });
    expect(ddl).toContain("-- Stores each customer's email and phone.");
    expect(ddl).toContain("-- - \"reachable\" means a customer with an `email` on file");
    expect(ddl).toContain("-- Concept: Account holder; Links: table:public.users#id");
    expect(mentionDroppedCount).toBe(0);
  });
});

describe("synthesizeRetrievedDdl — business context, column notes and headings (#894)", () => {
  // Chunks shaped as @askdb/rag builds them: a `Business context` chunk is a `table` chunk with id
  // `…<table-id>#biz` (`…#biz#bc:<n>` for part n of a long body), and a column chunk carries its
  // `Column notes` line as `Note: …`.
  const result = (id: string, type: RetrievedChunkType, text: string, refs: string[], sensitive = false): RetrievedResult => ({
    id,
    score: 0.5,
    payload: { id, type, text, schemaId: "s", refs, sensitive },
  });
  const tableName = (tableId: string) => tableId.slice("table:".length);
  const business = (tableId: string, body: string, opts: { part?: number; sensitive?: boolean } = {}) =>
    result(
      `chunk:s:${tableId}#biz${opts.part ? `#bc:${opts.part}` : ""}`,
      "table",
      `# ${tableName(tableId)} — business context\n${body}`,
      [tableId],
      opts.sensitive,
    );
  const columnWithNote = (columnId: string, note: string, sensitive = false) => {
    const [tableId, name] = columnId.split("#") as [string, string];
    return result(
      `chunk:s:${columnId}`,
      "column",
      `Column: ${tableName(tableId)}.${name} text (NOT NULL)\nId: ${columnId}\nNote: ${note}`,
      [tableId, columnId],
      sensitive,
    );
  };
  const plainTable = (tableId: string) => result(`chunk:s:${tableId}`, "table", `# ${tableName(tableId)}`, [tableId]);

  it("lists a retrieved business context under its table, after its common query language", () => {
    const { ddl } = synthesizeRetrievedDdl({
      schema: loadSchema(ordersDir),
      results: [
        business("table:public.orders", "Orders move through `pending → paid`.\n\nTotals are in cents."),
        result("chunk:s:table:public.orders#cql", "cql", "# public.orders — common query language\n- \"sales\" means paid orders", ["table:public.orders"]),
      ],
    });
    const lines = ddl.split("\n");
    const cql = lines.indexOf("-- common query language --");
    const block = lines.indexOf("-- business context --");
    expect(cql).toBeGreaterThan(lines.indexOf("TABLE public.orders -- aliases: purchases, sales, transactions"));
    expect(block).toBeGreaterThan(cql);
    expect(lines.slice(block + 1)).toEqual(["-- Orders move through `pending → paid`.", "-- Totals are in cents."]);
  });

  it("lists the parts of a long business context in body order, whatever order retrieval ranks them in", () => {
    const { ddl } = synthesizeRetrievedDdl({
      schema: loadSchema(ordersDir),
      results: [
        business("table:public.orders", "Second paragraph.", { part: 2 }),
        business("table:public.orders", "First paragraph.", { part: 1 }),
      ],
    });
    const lines = ddl.split("\n");
    const block = lines.indexOf("-- business context --");
    expect(lines.slice(block + 1)).toEqual(["-- First paragraph.", "-- Second paragraph."]);
  });

  it("adds no business context for a retrieved table chunk", () => {
    const { ddl } = synthesizeRetrievedDdl({ schema: loadSchema(ordersDir), results: [plainTable("table:public.orders")] });
    expect(ddl).toContain("TABLE public.orders");
    expect(ddl).not.toContain("business context");
  });

  it("appends a retrieved column note to its column's line", () => {
    const { ddl } = synthesizeRetrievedDdl({
      schema: loadSchema(ordersDir),
      results: [
        columnWithNote("table:public.orders#status", "refunds flip a paid order back to pending"),
        columnWithNote("table:public.orders#user_id", "null for guest checkouts"),
      ],
    });
    const lines = ddl.split("\n");
    expect(lines).toContain(
      "  - status text (NOT NULL) -- aliases: order_status; values: pending|paid|shipped|cancelled; Order lifecycle state. Most reporting filters on `paid`.; note: refunds flip a paid order back to pending",
    );
    expect(lines).toContain("  - user_id uuid (NOT NULL) -- note: null for guest checkouts");
  });

  it("keeps a concept's label and leaves an example question's heading out", () => {
    const { ddl } = synthesizeRetrievedDdl({
      schema: loadSchema(ordersDir),
      results: [
        result("chunk:s:concept:revenue", "concept", "# Concept: Revenue\nId: concept:revenue\nSynonyms: sales, top line", ["concept:revenue"]),
        result("chunk:s:table:public.orders#q:1", "question", "# public.orders [order] — example question\nHow much revenue did we make?", ["table:public.orders"]),
      ],
    });
    const lines = ddl.split("\n");
    expect(lines).toContain("-- Concept: Revenue; Id: concept:revenue; Synonyms: sales, top line");
    expect(lines).toContain("-- How much revenue did we make?");
  });

  describe("gates", () => {
    // sensitive-mentions: customers.email and .phone are sensitive columns; users is a sensitive table.
    const schema = loadSchema(mentionsDir);

    it("never lists a sensitive table's business context, with omission on or off", () => {
      // Unflagged and naming no sensitive column, as a custom retriever or an older index can send it.
      const results = [business("table:public.users", "Accounts are audited every year.")];
      for (const omit of [false, true]) {
        const { ddl } = synthesizeRetrievedDdl({ schema, results, omitSensitiveIdentifiersFromPrompt: omit });
        expect(ddl).toContain("TABLE public.users");
        expect(ddl).not.toContain("business context");
        expect(ddl).not.toContain("audited");
      }
    });

    it("with omission on, withholds a business context that names a sensitive column or is flagged sensitive", () => {
      const results = [
        business("table:public.customers", "Reach customers by email first."),
        business("table:public.orders", "Big orders get a manual review.", { sensitive: true }),
      ];
      const omitted = synthesizeRetrievedDdl({ schema, results, omitSensitiveIdentifiersFromPrompt: true });
      expect(omitted.ddl).not.toContain("business context");
      expect(omitted.ddl).not.toMatch(/email first|manual review/);

      const tagged = synthesizeRetrievedDdl({ schema, results });
      expect(tagged.ddl).toContain("-- Reach customers by email first.");
      expect(tagged.ddl).toContain("-- Big orders get a manual review.");
    });

    it("never lists the note of a column the prompt omits or tags sensitive", () => {
      // An opt-in index flags these chunks; the texts name no sensitive column.
      const results = [
        columnWithNote("table:public.customers#email", "the address we write to", true),
        columnWithNote("table:public.users#ssn", "nine digits, no dashes", true),
      ];
      for (const omit of [false, true]) {
        const { ddl } = synthesizeRetrievedDdl({ schema, results, omitSensitiveIdentifiersFromPrompt: omit });
        expect(ddl).not.toMatch(/write to|nine digits|note:/);
      }
      const tagged = synthesizeRetrievedDdl({ schema, results }).ddl.split("\n");
      expect(tagged).toContain("  - email text (NULL) (sensitive)");
    });

    it("with omission on, withholds a note that names a sensitive column", () => {
      const results = [columnWithNote("table:public.customers#region", "matches the area code of the phone")];
      const omitted = synthesizeRetrievedDdl({ schema, results, omitSensitiveIdentifiersFromPrompt: true }).ddl.split("\n");
      expect(omitted).toContain("  - region text (NULL) -- aliases: territory; values: north|south; Sales region of the account.");

      const tagged = synthesizeRetrievedDdl({ schema, results }).ddl.split("\n");
      expect(tagged).toContain(
        "  - region text (NULL) -- aliases: territory; values: north|south; Sales region of the account.; note: matches the area code of the phone",
      );
    });
  });
});
