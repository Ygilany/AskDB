import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "../schema/v2/loader.js";
import type { RetrievedResult } from "./types.js";
import { synthesizeRetrievedDdl } from "./synthesize-ddl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");
const ordersDir = join(fixturesDir, "orders-users.schema");

describe("synthesizeRetrievedDdl — tenant-policy chunks", () => {
  it("includes tenant-policy chunks in synthesized DDL", () => {
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

  it("includes multiple tenant-policy chunks", () => {
    const schema = loadSchema(multiTenantDir);
    const results: RetrievedResult[] = [
      {
        id: "chunk:tenant-policy#hierarchy",
        score: 0.9,
        payload: {
          id: "chunk:tenant-policy#hierarchy",
          type: "tenant-policy",
          text: "# Tenant policy — Hierarchy\nHierarchy description here.",
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
    ];

    const { ddl } = synthesizeRetrievedDdl({ schema, results });
    expect(ddl).toContain("Hierarchy description here.");
    expect(ddl).toContain("Scope rules description here.");
  });
});
