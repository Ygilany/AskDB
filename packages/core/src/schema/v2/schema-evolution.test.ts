import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { normalizeTenantPolicy, parseTenantPolicyMarkdown } from "./tenant-policy-loader.js";
import type { V2SchemaJson } from "./index.js";
import { TenantGuardrailError } from "../../errors.js";
import { validateTenantGuardrails } from "../../sql/tenant-guardrail.js";
import type { TenantScope } from "./tenant-policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

const agencyScope: TenantScope = {
  access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
};

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

  it("strict mode blocks queries touching unknown tables", () => {
    const schemaJson = loadFixtureJson();
    schemaJson.tables.push({
      id: "table:public.invoices",
      name: "invoices",
      schema: "public",
      columns: [
        { id: "table:public.invoices#id", name: "id", type: "uuid", nullable: false, primaryKey: true },
      ],
    } as V2SchemaJson["tables"][number]);

    const { tableIds, columnIds } = buildSets(schemaJson);
    const parsed = loadFixturePolicyMd();
    const policy = normalizeTenantPolicy(parsed, tableIds, columnIds);
    expect(policy.enforcement).toBe("strict");

    const sql = "SELECT * FROM invoices WHERE amount > 100";
    expect(() => validateTenantGuardrails(sql, policy, agencyScope)).toThrow(
      TenantGuardrailError,
    );
  });

  it("warn mode returns warning for unknown tables", () => {
    const schemaJson = loadFixtureJson();
    schemaJson.tables.push({
      id: "table:public.invoices",
      name: "invoices",
      schema: "public",
      columns: [
        { id: "table:public.invoices#id", name: "id", type: "uuid", nullable: false, primaryKey: true },
      ],
    } as V2SchemaJson["tables"][number]);

    const { tableIds, columnIds } = buildSets(schemaJson);
    const parsed = loadFixturePolicyMd();
    const policy = normalizeTenantPolicy(parsed, tableIds, columnIds);
    const warnPolicy = { ...policy, enforcement: "warn" as const };

    const sql = "SELECT * FROM invoices WHERE amount > 100";
    const result = validateTenantGuardrails(sql, warnPolicy, agencyScope);
    expect(result.passed).toBe(false);
    expect(result.warnings.some((w) => w.rule === "UNKNOWN_TABLE_REFERENCED")).toBe(true);
  });
});

describe("schema evolution — table removed", () => {
  it("flags orphaned scoped table references", () => {
    const schemaJson = loadFixtureJson();
    schemaJson.tables = schemaJson.tables.filter(
      (t) => t.id !== "table:public.orders",
    );

    const { tableIds, columnIds } = buildSets(schemaJson);
    const parsed = loadFixturePolicyMd();
    const policy = normalizeTenantPolicy(parsed, tableIds, columnIds);

    const orphanWarnings = policy.warnings.filter(
      (w) => w.kind === "orphaned_scoped_table_id" && w.id === "table:public.orders",
    );
    expect(orphanWarnings.length).toBe(1);
  });

  it("flags orphaned root table references", () => {
    const schemaJson = loadFixtureJson();
    schemaJson.tables = schemaJson.tables.filter(
      (t) => t.id !== "table:public.agencies",
    );

    const { tableIds, columnIds } = buildSets(schemaJson);
    const parsed = loadFixturePolicyMd();
    const policy = normalizeTenantPolicy(parsed, tableIds, columnIds);

    const orphanWarnings = policy.warnings.filter(
      (w) => w.kind === "orphaned_root_id" && w.id === "table:public.agencies",
    );
    expect(orphanWarnings.length).toBe(1);
  });
});

describe("schema evolution — FK path changed", () => {
  it("flags orphaned FK when column is removed", () => {
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

    const fkWarnings = policy.warnings.filter(
      (w) =>
        w.kind === "orphaned_column_id" &&
        w.id === "table:public.orders#agency_id",
    );
    expect(fkWarnings.length).toBe(1);
  });
});
