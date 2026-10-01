import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { normalizeTenantPolicy, parseTenantPolicyMarkdown } from "./tenant-policy-loader.js";
import type { V2SchemaJson } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

function buildSets(schemaJson: V2SchemaJson) {
  const tableIds = new Set<string>();
  const columnIds = new Set<string>();
  for (const t of schemaJson.tables) {
    tableIds.add(t.id);
    for (const c of t.columns) {
      columnIds.add(c.id);
    }
  }
  return { tableIds, columnIds };
}

function loadFixtureJson(): V2SchemaJson {
  return JSON.parse(readFileSync(join(multiTenantDir, "schema.json"), "utf8"));
}

function loadFixturePolicyMd() {
  const md = readFileSync(join(multiTenantDir, "tenant-policy.md"), "utf8");
  return parseTenantPolicyMarkdown(md);
}

describe("schema evolution — new table added", () => {
  it("classifies new table as unknown in coverage report", () => {
    const schemaJson = loadFixtureJson();
    schemaJson.tables.push({
      id: "table:public.invoices",
      name: "invoices",
      schema: "public",
      columns: [
        { id: "table:public.invoices#id", name: "id", type: "uuid", nullable: false, primaryKey: true },
        { id: "table:public.invoices#agency_id", name: "agency_id", type: "uuid", nullable: false },
        { id: "table:public.invoices#amount", name: "amount", type: "numeric", nullable: false },
      ],
    } as V2SchemaJson["tables"][number]);

    const { tableIds, columnIds } = buildSets(schemaJson);
    const parsed = loadFixturePolicyMd();
    const normalized = normalizeTenantPolicy(parsed, tableIds, columnIds);

    const invoiceEntry = normalized.coverage.find(
      (c) => c.tableId === "table:public.invoices",
    );
    expect(invoiceEntry).toBeDefined();
    expect(invoiceEntry!.classification).toBe("unknown");
  });
});

describe("schema evolution — scope column removed", () => {
  it("flags an orphaned column id when a scope column is removed", () => {
    const schemaJson = loadFixtureJson();
    const ordersTable = schemaJson.tables.find(
      (t) => t.id === "table:public.orders",
    )!;
    ordersTable.columns = ordersTable.columns.filter(
      (c) => c.id !== "table:public.orders#agency_id",
    );

    const { tableIds, columnIds } = buildSets(schemaJson);
    const parsed = loadFixturePolicyMd();
    const policy = normalizeTenantPolicy(parsed, tableIds, columnIds);

    const orphanWarnings = policy.warnings.filter(
      (w) =>
        w.kind === "orphaned_column_id" &&
        w.id === "table:public.orders#agency_id",
    );
    expect(orphanWarnings.length).toBe(1);
  });
});
