import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TenantGuardrailError } from "../errors.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope, NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import {
  COCKROACHDB_DIALECT,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  type DialectSpec,
} from "./dialect-spec.js";
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
    expect(rules("SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) AND note = 'agency_id'")).toEqual([]);
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
      rules('SELECT * FROM "public"."orders" o WHERE o."agency_id" = :tenant_agency_ids', POSTGRES_DIALECT),
    ).toEqual([]);
    expect(rules("SELECT * FROM `orders` WHERE `agency_id` = :tenant_agency_ids", MYSQL_DIALECT)).toEqual([]);
    expect(rules("SELECT * FROM [orders] WHERE [agency_id] = :tenant_agency_ids")).toEqual([]);
  });

  it("a table name that only appears inside a literal is not a table reference", () => {
    expect(rules("SELECT 'orders' AS label FROM lookup_states")).toEqual([]);
  });

  it("only the root's exact placeholder counts: a longer name is another token", () => {
    expect(rules("SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids)")).toEqual([]);
    expect(rules("SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids_old)")).toEqual([
      "MISSING_TENANT_PREDICATE",
    ]);
  });

  // Regions are read the way the target engine reads them. Without a dialect the
  // statement must pass under the standard-SQL, Postgres, and MySQL readings.
  it.each([
    ["mysql", "a double-quoted string", MYSQL_DIALECT, 'SELECT * FROM orders WHERE status = "agency_id"'],
    ["mysql", "a backslash-escaped string", MYSQL_DIALECT, "SELECT * FROM orders WHERE status = 'it\\'s agency_id'"],
    ["mysql", "a # comment", MYSQL_DIALECT, "SELECT * FROM orders # agency_id\nWHERE status = 'paid'"],
    ["no dialect", "a double-quoted name", undefined, "SELECT * FROM orders WHERE \"agency_id\" = '42'"],
    ["no dialect", "an upper-case placeholder", undefined, "SELECT * FROM orders WHERE owner_ref IN (:TENANT_AGENCY_IDS)"],
    ["postgres", "an E'…' escape string", POSTGRES_DIALECT, "SELECT * FROM orders WHERE note = E'it\\'s agency_id'"],
    ["cockroachdb", "an e'…' escape string", COCKROACHDB_DIALECT, "SELECT * FROM orders WHERE note = e'it\\'s agency_id'"],
    // Postgres reads `#` as XOR and the rest as one E-string; the standard reading
    // ends the string at `\'` and the MySQL reading comments out the first line.
    ["no dialect", "an E'…' escape string", undefined, "SELECT * FROM orders WHERE 2 # 3 = 1 OR note = E'\\'\nAND agency_id = 1 -- '"],
  ])("%s: tenant scope named only in %s is not a predicate", (_d, _label, dialect, sql) => {
    expect(rules(sql, dialect)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("E'…' strings: a real predicate still counts, and an identifier ending in e is no prefix", () => {
    const scoped = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND note = E'it\\'s x'";
    expect(rules(scoped, POSTGRES_DIALECT)).toEqual([]);
    expect(rules(scoped)).toEqual([]);
    // `date'…'` is a typed literal whose string ends at `\'`; the UNION is code.
    expect(
      rules("SELECT id FROM lookup_states WHERE d = date'2020\\' UNION SELECT id FROM orders --'", POSTGRES_DIALECT),
    ).toEqual(["MISSING_TENANT_PREDICATE"]);
  });
});

/**
 * #315: strict mode returned SQL whose tenant filter didn't filter, because a bare
 * mention of the tenant column or placeholder counted as a predicate. The consumer
 * lab ran each shape on five engines and got other tenants' rows back. A tenant
 * predicate is now the column compared with its root's placeholder, ANDed into a
 * WHERE/ON/HAVING clause, and a query on the scope's root table needs one too.
 */
describe("validateTenantGuardrails — a tenant predicate must actually filter (#315)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);

  it.each([
    ["the tenant column only selected", "SELECT agency_id, status FROM orders"],
    ["a literal tenant ID", "SELECT * FROM orders WHERE agency_id = 1"],
    ["a quoted literal tenant ID", "SELECT * FROM orders WHERE agency_id IN ('42')"],
    ["the placeholder OR-ed away", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids OR 1 = 1"],
    ["an OR before the predicate", "SELECT * FROM orders WHERE status = 'open' OR agency_id = :tenant_agency_ids"],
    ["AND binding tighter than OR", "SELECT * FROM orders WHERE 1 = 1 OR status = 'x' AND agency_id = :tenant_agency_ids"],
    ["an OR around the parenthesized predicate", "SELECT * FROM orders WHERE (agency_id = :tenant_agency_ids AND status = 'x') OR 1 = 1"],
    ["NOT in front of the predicate", "SELECT * FROM orders WHERE NOT agency_id = :tenant_agency_ids"],
    ["NOT around the predicate's group", "SELECT * FROM orders WHERE NOT (agency_id = :tenant_agency_ids)"],
    ["XOR", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids XOR 1 = 1"],
    ["the predicate compared again", "SELECT * FROM orders WHERE (agency_id = :tenant_agency_ids) = FALSE"],
    ["the predicate in the select list", "SELECT agency_id = :tenant_agency_ids AS mine FROM orders"],
    ["the predicate inside a CASE", "SELECT * FROM orders WHERE CASE WHEN agency_id = :tenant_agency_ids THEN 1 ELSE 1 END = 1"],
    ["the predicate as a function argument", "SELECT * FROM orders WHERE COALESCE(agency_id = :tenant_agency_ids, TRUE)"],
    ["another table's column compared with the placeholder", "SELECT * FROM orders WHERE status = :tenant_agency_ids"],
    ["an OR after a function named like a clause keyword", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND LEFT(status, 1) = 'o' OR 1 = 1"],
    ["the predicate in a LEFT JOIN's ON", "SELECT o.* FROM orders o LEFT JOIN lookup_states d ON o.agency_id = :tenant_agency_ids"],
    ["the predicate in a FULL OUTER JOIN's ON", "SELECT o.* FROM orders o FULL OUTER JOIN lookup_states d ON d.code = o.state AND o.agency_id = :tenant_agency_ids"],
    ["the predicate in a scalar subquery in the select list", "SELECT (SELECT 1 WHERE agency_id = :tenant_agency_ids) AS x, o.* FROM orders o"],
    ["the predicate inside EXISTS, OR-ed away", "SELECT * FROM orders WHERE EXISTS (SELECT 1 WHERE agency_id = :tenant_agency_ids) OR 1 = 1"],
    ["the predicate inside an uncorrelated EXISTS", "SELECT * FROM orders WHERE EXISTS (SELECT 1 FROM orders o2 WHERE o2.agency_id = :tenant_agency_ids)"],
    ["a UNION branch with a literal ID", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM orders WHERE agency_id = 7"],
  ])("rejects %s", (_label, sql) => {
    expect(rules(sql)).toContain("MISSING_TENANT_PREDICATE");
  });

  it("rejects MySQL's || as OR, but not Postgres's || as concatenation", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids || 1 = 1";
    expect(rules(sql, MYSQL_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]); // the MySQL reading, without a dialect
    expect(rules("SELECT * FROM orders WHERE status || 'x' = 'openx' AND agency_id = :tenant_agency_ids", POSTGRES_DIALECT)).toEqual([]);
  });

  it("rejects the scope's root table queried without its tenant ID predicate", () => {
    expect(rules("SELECT name FROM agencies")).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules("SELECT name FROM agencies WHERE id = 7")).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules("SELECT name FROM agencies WHERE id = :tenant_agency_ids")).toEqual([]);
  });

  it.each([
    ["an equality", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids"],
    ["an IN list", "SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids)"],
    ["= ANY", "SELECT * FROM orders WHERE agency_id = ANY(:tenant_agency_ids)"],
    ["the placeholder on the left", "SELECT * FROM orders WHERE :tenant_agency_ids = o.agency_id"],
    ["a qualified column", "SELECT o.* FROM public.orders o WHERE public.o.agency_id = :tenant_agency_ids"],
    ["other conjuncts on both sides", "SELECT * FROM orders WHERE status = 'open' AND agency_id = :tenant_agency_ids AND total > 5"],
    ["an OR inside parentheses", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND (status = 'a' OR status = 'b')"],
    ["a parenthesized AND group", "SELECT * FROM orders WHERE (agency_id = :tenant_agency_ids AND status = 'a') AND total > 1"],
    ["BETWEEN beside it", "SELECT * FROM orders WHERE total BETWEEN 1 AND 5 AND agency_id = :tenant_agency_ids"],
    ["a JOIN ON condition", "SELECT o.id FROM orders o JOIN agencies a ON a.id = o.agency_id AND o.agency_id = :tenant_agency_ids WHERE a.id = :tenant_agency_ids"],
    ["a subquery's own WHERE", "SELECT * FROM (SELECT * FROM orders WHERE agency_id = :tenant_agency_ids) t WHERE t.total > 5"],
    ["a CTE", "WITH mine AS (SELECT * FROM orders WHERE agency_id = :tenant_agency_ids) SELECT count(*) FROM mine"],
    ["HAVING", "SELECT agency_id, count(*) FROM orders GROUP BY agency_id HAVING agency_id = :tenant_agency_ids"],
    ["a clause after it", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY id LIMIT 5"],
    ["a trailing semicolon", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids;"],
    ["a function named like a clause keyword beside it", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND LEFT(status, 1) = 'o'"],
    ["an inner JOIN's ON", "SELECT o.* FROM orders o INNER JOIN lookup_states d ON d.code = o.state AND o.agency_id = :tenant_agency_ids"],
    ["a derived table after a comma in FROM", "SELECT * FROM lookup_states s, (SELECT * FROM orders WHERE agency_id = :tenant_agency_ids) o"],
    ["every UNION branch scoped", "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids UNION SELECT id FROM orders WHERE agency_id IN (:tenant_agency_ids)"],
    ["a UNION branch that doesn't touch the table", "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids UNION SELECT id FROM lookup_states"],
  ])("accepts %s", (_label, sql) => {
    expect(rules(sql)).toEqual([]);
  });
});
