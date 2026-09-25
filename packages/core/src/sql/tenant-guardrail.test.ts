import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TenantGuardrailError } from "../errors.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope, NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import { MYSQL_DIALECT, POSTGRES_DIALECT, type DialectSpec } from "./dialect-spec.js";
import { validateTenantGuardrails } from "./tenant-guardrail.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

const schema = loadSchema(multiTenantDir);
const policy = schema.tenantPolicy!;

const agencyScope: TenantScope = {
  access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
};

const globalScope: TenantScope = {
  access: { kind: "global", reason: "super_admin" },
};

describe("validateTenantGuardrails — safe queries", () => {
  it("passes SQL with direct tenant predicate (P1)", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("passes SQL with varying column name (P2)", () => {
    const sql = "SELECT * FROM campaigns WHERE owning_agency = :tenant_agency_ids";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });

  it("passes SQL with inherited scope via JOIN (P3)", () => {
    const sql = `
      SELECT a.* FROM appointments a
      JOIN clients c ON a.client_id = c.id
      WHERE c.sub_agency_id IN (SELECT id FROM sub_agencies WHERE agency_id = :tenant_agency_ids)
    `;
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });

  it("passes SQL querying global tables without tenant predicate", () => {
    const sql = "SELECT * FROM lookup_states";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });

  it("passes SQL querying root tables", () => {
    const sql = "SELECT * FROM agencies WHERE id = :tenant_agency_ids";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });

  it("passes any SQL with global scope", () => {
    const sql = "SELECT * FROM orders";
    const result = validateTenantGuardrails(sql, policy, globalScope);
    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("passes polymorphic table with type discriminator and id", () => {
    const sql = "SELECT * FROM notes WHERE owner_type = 'agency' AND owner_id = :tenant_agency_ids";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });
});

describe("validateTenantGuardrails — unsafe queries (strict mode)", () => {
  it("rejects SQL missing tenant predicate on scoped table", () => {
    const sql = "SELECT * FROM orders WHERE status = 'paid'";
    expect(() => validateTenantGuardrails(sql, policy, agencyScope)).toThrow(
      TenantGuardrailError,
    );
  });

  it("rejects SQL missing tenant predicate on varying-name table", () => {
    const sql = "SELECT * FROM campaigns WHERE budget > 1000";
    expect(() => validateTenantGuardrails(sql, policy, agencyScope)).toThrow(
      TenantGuardrailError,
    );
  });

  it("rejects polymorphic table missing type discriminator", () => {
    const sql = "SELECT * FROM notes WHERE owner_id = '42'";
    expect(() => validateTenantGuardrails(sql, policy, agencyScope)).toThrow(
      TenantGuardrailError,
    );
  });

  it("rejects polymorphic table missing id column", () => {
    const sql = "SELECT * FROM notes WHERE owner_type = 'agency'";
    expect(() => validateTenantGuardrails(sql, policy, agencyScope)).toThrow(
      TenantGuardrailError,
    );
  });

  it("includes relevant warning details in error", () => {
    const sql = "SELECT * FROM orders WHERE status = 'paid'";
    try {
      validateTenantGuardrails(sql, policy, agencyScope);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as TenantGuardrailError;
      expect(err.warnings.length).toBeGreaterThan(0);
      expect(err.warnings[0]!.rule).toBe("MISSING_TENANT_PREDICATE");
      expect(err.warnings[0]!.tableId).toBe("table:public.orders");
    }
  });

  it("does not flag tables that aren't referenced in the SQL", () => {
    const sql = "SELECT * FROM lookup_states WHERE code = 'CA'";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });
});

describe("validateTenantGuardrails — warn mode", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };

  it("returns warnings instead of throwing in warn mode", () => {
    const sql = "SELECT * FROM orders WHERE status = 'paid'";
    const result = validateTenantGuardrails(sql, warnPolicy, agencyScope);
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]!.rule).toBe("MISSING_TENANT_PREDICATE");
  });

  it("still passes valid SQL in warn mode", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = validateTenantGuardrails(sql, warnPolicy, agencyScope);
    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("validateTenantGuardrails — unknown tables", () => {
  it("flags queries touching unknown tables in strict mode", () => {
    // We need a policy where a table in the schema is unknown.
    // The fixture has all tables classified, so let's modify the policy for this test.
    const policyWithUnknown: NormalizedTenantPolicy = {
      ...policy,
      coverage: [
        ...policy.coverage.filter((c) => c.tableId !== "table:public.lookup_states"),
        { tableId: "table:public.lookup_states", classification: "unknown" },
      ],
    };
    const sql = "SELECT * FROM lookup_states";
    expect(() =>
      validateTenantGuardrails(sql, policyWithUnknown, agencyScope),
    ).toThrow(TenantGuardrailError);
  });

  it("warns about unknown tables in warn mode", () => {
    const policyWithUnknown: NormalizedTenantPolicy = {
      ...policy,
      enforcement: "warn",
      coverage: [
        ...policy.coverage.filter((c) => c.tableId !== "table:public.lookup_states"),
        { tableId: "table:public.lookup_states", classification: "unknown" },
      ],
    };
    const sql = "SELECT * FROM lookup_states";
    const result = validateTenantGuardrails(sql, policyWithUnknown, agencyScope);
    expect(result.passed).toBe(false);
    expect(result.warnings.some((w) => w.rule === "UNKNOWN_TABLE_REFERENCED")).toBe(true);
  });
});

describe("validateTenantGuardrails — matches only in code regions", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);

  it.each([
    ["a string literal", "SELECT * FROM orders WHERE note = 'agency_id'"],
    ["a string literal with doubled quotes", "SELECT * FROM orders WHERE note = 'it''s agency_id'"],
    ["a dollar-quoted body", "SELECT * FROM orders WHERE note = $q$agency_id$q$"],
    ["a line comment", "SELECT * FROM orders -- filter by agency_id\nWHERE status = 'paid'"],
    ["a block comment", "SELECT * FROM orders /* agency_id */ WHERE status = 'paid'"],
    ["a quoted placeholder", "SELECT * FROM orders WHERE note = ':tenant_agency_ids'"],
  ])("a tenant column named only inside %s is not a predicate", (_label, sql) => {
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a real predicate next to a literal mentioning the column still passes", () => {
    expect(rules("SELECT * FROM orders WHERE agency_id IN ('42') AND note = 'agency_id'")).toEqual([]);
  });

  it("an apostrophe inside a comment does not hide the rest of the statement", () => {
    expect(rules("-- don't forget\nSELECT * FROM orders WHERE status = 'paid'")).toEqual([
      "MISSING_TENANT_PREDICATE",
    ]);
  });

  it("quoted identifiers still count: the table is checked and the column matches", () => {
    expect(rules('SELECT * FROM "orders" WHERE status = \'paid\'')).toEqual([
      "MISSING_TENANT_PREDICATE",
    ]);
    expect(
      rules('SELECT * FROM "public"."orders" o WHERE o."agency_id" = \'42\'', POSTGRES_DIALECT),
    ).toEqual([]);
    expect(rules("SELECT * FROM `orders` WHERE `agency_id` = '42'", MYSQL_DIALECT)).toEqual([]);
    expect(rules("SELECT * FROM [orders] WHERE [agency_id] = '42'")).toEqual([]);
  });

  it("a table name that only appears inside a literal is not a table reference", () => {
    expect(rules("SELECT 'orders' AS label FROM lookup_states")).toEqual([]);
  });

  it("the placeholder path is live: a tenant placeholder satisfies a scoped table", () => {
    // Before, `\b:tenant_…` could never match, so only the column name counted.
    expect(rules("SELECT * FROM orders WHERE owner_ref IN (:tenant_agency_ids)")).toEqual([]);
    expect(rules("SELECT * FROM orders WHERE owner_ref IN (:tenant_agency_ids_old)")).toEqual([
      "MISSING_TENANT_PREDICATE",
    ]);
  });

  // Regions are read the way the target engine reads them. Without a dialect the
  // statement must pass under both the standard-SQL and the MySQL reading.
  it.each([
    ["mysql", "a double-quoted string", MYSQL_DIALECT, 'SELECT * FROM orders WHERE status = "agency_id"'],
    ["mysql", "a backslash-escaped string", MYSQL_DIALECT, "SELECT * FROM orders WHERE status = 'it\\'s agency_id'"],
    ["mysql", "a # comment", MYSQL_DIALECT, "SELECT * FROM orders # agency_id\nWHERE status = 'paid'"],
    ["no dialect", "a double-quoted name", undefined, "SELECT * FROM orders WHERE \"agency_id\" = '42'"],
    ["no dialect", "an upper-case placeholder", undefined, "SELECT * FROM orders WHERE owner_ref IN (:TENANT_AGENCY_IDS)"],
  ])("%s: tenant scope named only in %s is not a predicate", (_d, _label, dialect, sql) => {
    expect(rules(sql, dialect)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  // Known limitations — this is a lint, not a parser. Pinned so a sounder
  // implementation (plan 050) visibly changes them.
  it("known limitation: a selected (not filtered) tenant column still passes", () => {
    expect(rules("SELECT agency_id FROM orders")).toEqual([]);
  });

  it("known limitation: an OR-widened predicate still passes", () => {
    expect(rules("SELECT * FROM orders WHERE agency_id IN ('42') OR 1=1")).toEqual([]);
  });
});
