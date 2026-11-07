import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TenantGuardrailError } from "../errors.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope, NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import {
  COCKROACHDB_DIALECT,
  MARIADB_DIALECT,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
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

/** A dialect id that is no built-in engine, so the SQL may be read as Postgres; optionally with `backslashEscapes`. */
const customEngine = (backslashEscapes?: boolean) =>
  ({ ...POSTGRES_DIALECT, id: "custom-engine", backslashEscapes }) as unknown as DialectSpec;

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

  it("passes SQL querying global tables without tenant predicate", () => {
    const sql = "SELECT * FROM lookup_states";
    const result = validateTenantGuardrails(sql, policy, agencyScope);
    expect(result.passed).toBe(true);
  });

  it("passes any SQL with global scope", () => {
    const sql = "SELECT * FROM orders";
    const result = validateTenantGuardrails(sql, policy, globalScope);
    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("validateTenantGuardrails — unsafe queries (strict mode)", () => {
  it("rejects SQL missing tenant predicate on varying-name table", () => {
    const sql = "SELECT * FROM campaigns WHERE budget > 1000";
    expect(() => validateTenantGuardrails(sql, policy, agencyScope)).toThrow(
      TenantGuardrailError,
    );
  });

  it("rejects polymorphic table missing type discriminator", () => {
    const sql = "SELECT * FROM notes WHERE owner_id = :tenant_agency_ids";
    try {
      validateTenantGuardrails(sql, policy, agencyScope);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as TenantGuardrailError;
      expect(err).toBeInstanceOf(TenantGuardrailError);
      expect(err.warnings.map((w) => w.rule)).toEqual(["MISSING_TYPE_DISCRIMINATOR"]);
    }
  });

  it("rejects polymorphic table missing id column", () => {
    const sql = "SELECT * FROM notes WHERE owner_type = 'agency'";
    try {
      validateTenantGuardrails(sql, policy, agencyScope);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as TenantGuardrailError;
      expect(err).toBeInstanceOf(TenantGuardrailError);
      expect(err.warnings.map((w) => [w.rule, w.tableId])).toEqual([
        ["MISSING_TENANT_PREDICATE", "table:public.notes"],
      ]);
    }
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

describe("validateTenantGuardrails — a reserved-word table quoted the way the prompt lists it (#451)", () => {
  // `order` is reserved on every engine, so the prompt lists it quoted.
  const orderPolicy: NormalizedTenantPolicy = {
    ...policy,
    enforcement: "warn",
    scopedTables: [
      {
        id: "table:billing.order",
        scopeThrough: [{ root: "table:public.agencies", column: "table:billing.order#agency_id" }],
      },
    ],
    polymorphicTables: [],
    globalTables: [],
    coverage: [],
  };
  const rules = (sql: string, dialect: DialectSpec) =>
    validateTenantGuardrails(sql, orderPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);

  it.each([
    ["postgres", POSTGRES_DIALECT, 'billing."order"'],
    ["mysql", MYSQL_DIALECT, "`billing`.`order`"],
    ["sqlserver", SQLSERVER_DIALECT, "[billing].[order]"],
    ["sqlite", SQLITE_DIALECT, '"order"'],
  ])("%s: checks %s for its tenant predicate", (_d, dialect, table) => {
    const scoped = `SELECT o.order_id FROM ${table} o WHERE o.agency_id = :tenant_agency_ids ORDER BY o.order_id`;
    expect(rules(scoped, dialect)).toEqual([]);
    expect(rules(`SELECT o.order_id FROM ${table} o ORDER BY o.order_id`, dialect)).toEqual([
      "MISSING_TENANT_PREDICATE",
    ]);
  });

  it("still checks a qualified name quoted whole", () => {
    expect(rules("SELECT * FROM [billing.order]", SQLSERVER_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
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
    ["a UNION branch with a literal ID inside a derived table", "SELECT * FROM (SELECT * FROM orders WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM orders WHERE agency_id = 7) x"],
    ["the predicate inside an OUTER APPLY", "SELECT o.* FROM orders o OUTER APPLY (SELECT 1 AS one WHERE o.agency_id = :tenant_agency_ids) x"],
    ["the predicate in a hinted LEFT HASH JOIN's ON", "SELECT o.* FROM orders o LEFT HASH JOIN lookup_states d ON d.code = o.state AND o.agency_id = :tenant_agency_ids"],
    ["a quoted function named like a clause keyword", 'SELECT * FROM orders WHERE "where"(agency_id = :tenant_agency_ids)'],
    ["no predicate before a trailing semicolon", "SELECT * FROM orders;"],
    ["a literal tenant ID before a spaced trailing semicolon", "SELECT * FROM orders WHERE agency_id = 1 ;"],
    ["the placeholder OR-ed away before a trailing semicolon", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids OR 1 = 1;"],
  ])("rejects %s", (_label, sql) => {
    expect(rules(sql)).toContain("MISSING_TENANT_PREDICATE");
  });

  it("rejects MySQL's || as OR, but not Postgres's || as concatenation", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids || 1 = 1";
    expect(rules(sql, MYSQL_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]); // the MySQL reading, without a dialect
    expect(rules("SELECT * FROM orders WHERE status || 'x' = 'openx' AND agency_id = :tenant_agency_ids", POSTGRES_DIALECT)).toEqual([]);
  });

  it("a quoted identifier is never a keyword, but still names its column", () => {
    expect(rules('SELECT * FROM orders WHERE "agency_id" = :tenant_agency_ids', POSTGRES_DIALECT)).toEqual([]);
    expect(rules('SELECT * FROM orders WHERE "where"(agency_id = :tenant_agency_ids)', POSTGRES_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
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
    ["a CROSS APPLY's filter", "SELECT o.* FROM lookup_states d CROSS APPLY (SELECT * FROM orders WHERE agency_id = :tenant_agency_ids) o"],
    ["a qualifier naming the scoped table itself", "SELECT * FROM orders WHERE orders.agency_id = :tenant_agency_ids"],
    ["a filter on a derived table's output", "SELECT * FROM (SELECT * FROM orders) t WHERE t.agency_id = :tenant_agency_ids"],
    ["ORDER BY, which is not a table named order", "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY id"],
    ["the root joined for a label, filtered on the scoped table's tenant column", "SELECT o.id, a.name FROM orders o JOIN agencies a ON a.id = o.agency_id WHERE o.agency_id IN (:tenant_agency_ids)"],
  ])("accepts %s", (_label, sql) => {
    expect(rules(sql)).toEqual([]);
  });
});

describe("validateTenantGuardrails — down a hierarchy, the predicate must be on a column that carries the root's IDs", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string) => validateTenantGuardrails(sql, warnPolicy, agencyScope).warnings.map((w) => w.rule);
  const joined = "SELECT a.* FROM appointments a JOIN clients c ON a.client_id = c.id";

  it.each([
    ["the appointment's own id", `${joined} WHERE a.id = :tenant_agency_ids`],
    ["a column that carries no tenant IDs", `${joined} WHERE a.status = :tenant_agency_ids`],
  ])("rejects %s compared with the scope's placeholder", (_label, sql) => {
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });
});

describe("validateTenantGuardrails — a join path accepts only the placeholders of its root and that root's ancestors", () => {
  // A `vendors` root outside the agency → sub-agency → client hierarchy.
  const vendorPolicy: NormalizedTenantPolicy = {
    ...policy,
    enforcement: "warn",
    roots: [...policy.roots, { id: "table:public.vendors", tenantIdColumn: "table:public.vendors#id", label: "Vendor" }],
  };
  const vendorScope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.vendors", ids: ["9"] } };
  const clientScope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.clients", ids: ["3"] } };
  const flagged = (sql: string, scope: TenantScope) =>
    validateTenantGuardrails(sql, vendorPolicy, scope).warnings.map((w) => `${w.rule} ${w.tableId}`);
  const joined = "SELECT a.* FROM appointments a JOIN clients c ON a.client_id = c.id";

  it("rejects an unrelated root's placeholder, even one the scope binds", () => {
    expect(flagged(`${joined} CROSS JOIN vendors v WHERE v.id = :tenant_vendor_ids`, vendorScope)).toEqual([
      "MISSING_TENANT_PREDICATE table:public.appointments",
    ]);
  });

  it.each([
    ["the path's own root", clientScope, `${joined} WHERE c.id = :tenant_client_ids`],
    ["an ancestor two levels up", agencyScope, `${joined} WHERE c.sub_agency_id IN (SELECT id FROM sub_agencies WHERE agency_id = :tenant_agency_ids)`],
  ])("accepts %s", (_label, scope, sql) => {
    expect(flagged(sql, scope)).toEqual([]);
  });
});

describe("validateTenantGuardrails — a polymorphic table's discriminator must name the root whose placeholder filters it", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);

  it.each([
    ["the type column only selected", "SELECT owner_type, body FROM notes WHERE owner_id = :tenant_agency_ids"],
    ["a mismatched discriminator", "SELECT * FROM notes WHERE owner_type = 'client' AND owner_id = :tenant_agency_ids"],
    ["a discriminator OR-ed away", "SELECT * FROM notes WHERE (owner_type = 'agency' OR 1 = 1) AND owner_id = :tenant_agency_ids"],
    ["a discriminator in the select list", "SELECT owner_type = 'agency' AS mine, body FROM notes WHERE owner_id = :tenant_agency_ids"],
    ["a discriminator in another UNION branch", "SELECT id FROM notes WHERE owner_type = 'agency' AND owner_id = :tenant_agency_ids UNION SELECT id FROM notes WHERE owner_id = :tenant_agency_ids"],
    ["a longer literal", "SELECT * FROM notes WHERE owner_type = 'agency''s' AND owner_id = :tenant_agency_ids"],
  ])("rejects %s", (_label, sql) => {
    expect(rules(sql)).toContain("MISSING_TYPE_DISCRIMINATOR");
  });

  it.each([
    ["the discriminator first", "SELECT * FROM notes WHERE owner_type = 'agency' AND owner_id = :tenant_agency_ids"],
    ["the discriminator after the id predicate", "SELECT * FROM notes WHERE owner_id = :tenant_agency_ids AND owner_type = 'agency'"],
    ["qualified columns", "SELECT n.* FROM notes n WHERE n.owner_type = 'agency' AND n.owner_id IN (:tenant_agency_ids)"],
    ["another root's key and placeholder", "SELECT * FROM notes WHERE owner_type = 'client' AND owner_id = :tenant_client_ids"],
  ])("accepts %s", (_label, sql) => {
    expect(rules(sql)).toEqual([]);
    expect(rules(sql, MYSQL_DIALECT)).toEqual([]);
  });
});

describe("validateTenantGuardrails — MySQL comments are read the way MySQL reads them", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);

  it("`--` not followed by whitespace is code on MySQL, so an OR after it counts", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids--1 OR 1=1";
    expect(rules(sql, MYSQL_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("`-- ` followed by whitespace is still a comment on MySQL", () => {
    expect(rules("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids -- mine\n", MYSQL_DIALECT)).toEqual([]);
    expect(rules("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids --\tor 1 = 1", MYSQL_DIALECT)).toEqual([]);
  });

  it("a `/*! … */` executable comment is code on MySQL, but a comment on Postgres", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids /*!50000 OR 1 = 1 */";
    expect(rules(sql, MYSQL_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules(sql, POSTGRES_DIALECT)).toEqual([]);
  });

  // #698: the statement's first keyword is read with the same lexer, so a body MySQL runs
  // can't hide a non-query in front of a scoped query.
  it("a `/*! … */` executable comment can't hide a non-query in front of a query", () => {
    const sql = "/*! DO SLEEP(1) */ SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(rules(sql, MYSQL_DIALECT)).toEqual(["NOT_SELECT_OR_WITH"]);
    expect(rules(sql)).toEqual(["NOT_SELECT_OR_WITH"]);
    expect(rules(sql, POSTGRES_DIALECT)).toEqual([]);
  });

  it("a predicate only inside a `/*! … */` executable comment doesn't count: an older server skips it", () => {
    const sql = "SELECT * FROM orders WHERE status = 'paid' /*!99999 AND agency_id = :tenant_agency_ids */";
    expect(rules(sql, MYSQL_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(rules("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids /*!50000 AND status = 'paid' */", MYSQL_DIALECT)).toEqual([]);
  });
});

describe("validateTenantGuardrails — parenthesized set-operation operands are query blocks", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string) => validateTenantGuardrails(sql, warnPolicy, agencyScope).warnings.map((w) => w.rule);
  const scoped = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";

  it.each([
    ["a parenthesized statement", `(${scoped})`],
    ["parenthesized UNION ALL operands", `(${scoped}) UNION ALL (${scoped})`],
    ["a parenthesized operand after a bare one", `${scoped} UNION (${scoped})`],
    ["INTERSECT DISTINCT and EXCEPT ALL", `(${scoped}) INTERSECT DISTINCT (${scoped}) EXCEPT ALL (${scoped})`],
    ["doubly parenthesized operands", `((${scoped})) UNION ((${scoped}))`],
    ["parenthesized operands in a derived table", `SELECT * FROM ((${scoped}) UNION (${scoped})) x`],
  ])("accepts %s", (_label, sql) => {
    expect(rules(sql)).toEqual([]);
  });

  it.each([
    ["a parenthesized operand with a literal ID", `(${scoped}) UNION ALL (SELECT * FROM orders WHERE agency_id = 7)`],
    ["a parenthesized operand inside EXISTS", `SELECT * FROM orders WHERE EXISTS ((${scoped}))`],
    ["a parenthesized operand inside a scalar subquery", `SELECT (SELECT 1 UNION (${scoped})) AS x, o.* FROM orders o`],
  ])("rejects %s", (_label, sql) => {
    expect(rules(sql)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });
});

// #698 review: a server can start a statement without a `;` (T-SQL), and a comment or a
// string setting can hide where one starts, so the rule reads every way a server splits them.
describe("validateTenantGuardrails — every statement is a query, however the server splits them (#698)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);
  const scoped = "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids";

  it.each([POSTGRES_DIALECT, MYSQL_DIALECT, SQLSERVER_DIALECT, SQLITE_DIALECT])("refuses DO and CALL under $id", (dialect) => {
    expect(rules("DO SLEEP(0)", dialect)).toEqual(["NOT_SELECT_OR_WITH"]);
    expect(rules("CALL refresh_orders()", dialect)).toEqual(["NOT_SELECT_OR_WITH"]);
  });

  it("doesn't run under a global scope, which reads every row by design", () => {
    expect(validateTenantGuardrails("DO SLEEP(0)", warnPolicy, globalScope).warnings).toEqual([]);
  });

  // T-SQL needs no `;` between statements: SQL Server runs `SELECT 1 EXEC(...)` as two.
  it.each([
    `${scoped} EXEC('SELECT * FROM orders')`,
    `${scoped} EXEC refresh_orders`,
    `WITH o AS (${scoped}) SELECT id FROM o DECLARE @x int`,
  ])("refuses a T-SQL statement that follows a query with no `;`: %s", (sql) => {
    expect(rules(sql, SQLSERVER_DIALECT)).toContain("NOT_SELECT_OR_WITH");
    expect(rules(sql)).toContain("NOT_SELECT_OR_WITH");
  });

  // A word T-SQL denies starts a statement only after a complete expression; inside one (a
  // MySQL `IF()`, a column or alias named `open`, `FOR UPDATE`, a subquery) it doesn't.
  it.each([
    "SELECT id, IF(id > 5, 'a', 'b') AS size FROM orders WHERE agency_id = :tenant_agency_ids",
    "SELECT id, open FROM orders WHERE agency_id = :tenant_agency_ids",
    "SELECT o.close AS open FROM orders o WHERE o.agency_id = :tenant_agency_ids",
    "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND id IN (SELECT open FROM t)",
    "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids FOR UPDATE",
  ])("passes a query with a T-SQL statement word inside an expression: %s", (sql) => {
    for (const dialect of [undefined, POSTGRES_DIALECT, MYSQL_DIALECT, SQLSERVER_DIALECT, SQLITE_DIALECT]) {
      expect(rules(sql, dialect), dialect?.id ?? "custom").toEqual([]);
    }
  });

  // A value such as NULL is a complete expression, so a verb after it starts a statement.
  it("refuses a T-SQL verb after a keyword that ends an expression", () => {
    expect(rules(`${scoped} AND note IS NULL EXEC refresh_orders`, SQLSERVER_DIALECT)).toContain("NOT_SELECT_OR_WITH");
  });

  // MySQL skips a `/*!NNNNN … */` body on a server older than NNNNN, so the `;` and the
  // statement after it are code under that reading.
  it("refuses a statement that a versioned MySQL comment hides", () => {
    const sql = `${scoped} /*!99999 'x */ ; DO SLEEP(0) -- '*/`;
    expect(rules(sql, MYSQL_DIALECT)).toContain("NOT_SELECT_OR_WITH");
    expect(rules(sql)).toContain("NOT_SELECT_OR_WITH");
  });

  // Under NO_BACKSLASH_ESCAPES, `'a\'` ends the literal and `--1` isn't a comment, so the
  // `;` starts a statement. A custom dialect's server may run either string setting.
  it("refuses, for a custom dialect, a statement only one string setting splits off", () => {
    const sql = `${scoped} AND note = 'a\\' --1 ; PREPARE s FROM 'SELECT 1'`;
    expect(rules(sql)).toContain("NOT_SELECT_OR_WITH");
    expect(rules(sql, { ...MYSQL_DIALECT, backslashEscapes: false })).toContain("NOT_SELECT_OR_WITH");
    expect(rules(sql, MYSQL_DIALECT)).not.toContain("NOT_SELECT_OR_WITH");
  });

  // Standard strings end `'a\'` at the second quote, so `; DO …` is a statement; with
  // backslash escapes (MySQL's default) the whole tail is one literal.
  it("reads a `;` inside a literal the way each server does", () => {
    const sql = `SELECT 'a\\'; DO SLEEP(1); --'`;
    expect(rules(sql, POSTGRES_DIALECT)).toEqual(["NOT_SELECT_OR_WITH"]);
    expect(rules(sql)).toEqual(["NOT_SELECT_OR_WITH"]);
    expect(rules(sql, MYSQL_DIALECT)).toEqual([]);
    for (const dialect of [undefined, POSTGRES_DIALECT, MYSQL_DIALECT, SQLSERVER_DIALECT, SQLITE_DIALECT]) {
      expect(rules(`SELECT 'x;y' AS note, id FROM orders WHERE agency_id = :tenant_agency_ids`, dialect)).toEqual([]);
    }
  });

  // `[a;b]` is a quoted name on SQL Server but a `;` between two tokens on Postgres or
  // MySQL; a custom dialect's statement must be a query under every reading, so it's refused.
  it("refuses `[a;b]` for a custom dialect, and accepts it on SQL Server", () => {
    const sql = "SELECT [a;b] FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(rules(sql)).toEqual(["NOT_SELECT_OR_WITH"]);
    expect(rules(sql, SQLSERVER_DIALECT)).toEqual([]);
  });
});

// #702: the per-table checks blank string literals and see only the statement's own tables, so
// a call that runs a query or reads a table named in a string, runs SQL over another
// connection, or rewrites a setting row-level security reads is out of their sight.
describe("validateTenantGuardrails — a call the tenant check can't read through is refused (#702)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const rules = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => w.rule);
  const everyDialect = [undefined, POSTGRES_DIALECT, MYSQL_DIALECT, SQLSERVER_DIALECT, SQLITE_DIALECT];
  const scoped = "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids";

  it.each([
    ["a query passed as a string", "SELECT query_to_xml('SELECT * FROM orders', true, false, '') AS x"],
    ["a table named in a string", "SELECT table_to_xml('orders', true, false, '') AS x"],
    ["SQL over another connection", "SELECT * FROM dblink('dbname=app', 'SELECT id FROM orders') AS t(id int)"],
    ["a linked-server query", "SELECT * FROM OPENQUERY(self, 'SELECT id FROM orders')"],
    ["a setting row-level security reads", "SELECT set_config('app.agency_ids', '1,2,3', true) AS s"],
  ])("refuses %s under every dialect", (_label, sql) => {
    for (const dialect of everyDialect) {
      expect(rules(sql, dialect), dialect?.id ?? "custom").toEqual(["UNCHECKABLE_FUNCTION"]);
    }
  });

  // `docs/contracts/tenant-policy.md` lists every function the rule refuses. They're typed out
  // here, so a misspelled or dropped entry in the check's own list fails a test.
  it.each([
    "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema", "cursor_to_xml", "ts_stat", "ts_rewrite",
    "crosstab", "crosstab2", "crosstab3", "crosstab4",
    "table_to_xml", "table_to_xml_and_xmlschema", "schema_to_xml", "schema_to_xml_and_xmlschema",
    "database_to_xml", "database_to_xml_and_xmlschema", "connectby",
    "dblink", "dblink_exec", "dblink_connect", "dblink_connect_u", "dblink_open", "dblink_send_query",
    "dblink_fetch", "dblink_get_result", "dblink_build_sql_insert", "dblink_build_sql_update", "xpath_table",
    "openquery", "openrowset", "opendatasource",
    "set_config",
  ])("refuses a call to %s, as the contract lists", (name) => {
    expect(rules(`SELECT ${name}('x') AS v`)).toEqual(["UNCHECKABLE_FUNCTION"]);
  });

  // Postgres resolves each of these to `query_to_xml`. It doesn't care how the name is
  // qualified or cased, or what comment sits before the `(`.
  it.each([
    ["schema-qualified", "SELECT pg_catalog.query_to_xml('SELECT * FROM orders', true, false, '')"],
    ["quoted", `SELECT pg_catalog."query_to_xml"('SELECT * FROM orders', true, false, '')`],
    ["upper case", "SELECT QUERY_TO_XML('SELECT * FROM orders', true, false, '')"],
    ["with a comment before its parenthesis", "SELECT query_to_xml /* x */ ('SELECT * FROM orders', true, false, '')"],
    // The lexer reads `:set_config` as a placeholder; Postgres reads `:` and then the call.
    ["after a colon in an array slice (set_config)", "SELECT (ARRAY[1, 2])[1:set_config('a', 'b', true)::int] AS v"],
    ["after a colon in an array slice (crosstab)", "SELECT (ARRAY[1, 2])[1:crosstab('x')] AS v"],
  ])("refuses a function name written %s", (_label, sql) => {
    expect(rules(sql, POSTGRES_DIALECT)).toEqual(["UNCHECKABLE_FUNCTION"]);
    expect(rules(sql)).toEqual(["UNCHECKABLE_FUNCTION"]);
  });

  // Under standard strings `'a\'` ends at the second quote, so the call is code. Under
  // MySQL's backslash escapes, it sits inside the literal. A custom dialect's server may run
  // either setting.
  it("refuses a call that only one string setting shows", () => {
    const sql = `${scoped} AND note = 'a\\' AND query_to_xml('x', true, false, '') IS NOT NULL --'`;
    expect(rules(sql, POSTGRES_DIALECT)).toContain("UNCHECKABLE_FUNCTION");
    expect(rules(sql)).toContain("UNCHECKABLE_FUNCTION");
    expect(rules(sql, MYSQL_DIALECT)).not.toContain("UNCHECKABLE_FUNCTION");
  });

  // A listed name counts in any code position, not only right before `(`: Postgres reaches a
  // function in forms with no `(` after its name (#702 review, round 3). So a column, an alias
  // or a placeholder named like a listed function is refused too, a false positive the rule
  // accepts so that no spelling of a call gets past it.
  it.each([
    ["a column", `SELECT crosstab FROM orders WHERE agency_id = :tenant_agency_ids`],
    ["an alias", `SELECT note AS set_config FROM orders WHERE agency_id = :tenant_agency_ids`],
    ["a qualified name", `SELECT o.ts_stat FROM orders o WHERE o.agency_id = :tenant_agency_ids`],
    ["a placeholder", `${scoped} AND note = :set_config`],
  ])("refuses a listed name used as %s", (_label, sql) => {
    for (const dialect of everyDialect) {
      expect(rules(sql, dialect), dialect?.id ?? "custom").toEqual(["UNCHECKABLE_FUNCTION"]);
    }
  });

  // MySQL reads `"…"` as a string, and with ANSI_QUOTES as a name, so a listed name in one counts.
  it("refuses a listed name in double quotes under MySQL", () => {
    expect(rules(`SELECT "query_to_xml"('x') AS v`, MYSQL_DIALECT)).toEqual(["UNCHECKABLE_FUNCTION"]);
  });

  // Text inside a single-quoted literal isn't code, so a listed name there doesn't count.
  it("passes a listed name inside a string", () => {
    for (const dialect of everyDialect) {
      expect(rules(`${scoped} AND note = 'query_to_xml(1)'`, dialect), dialect?.id ?? "custom").toEqual([]);
    }
  });
});

describe("validateTenantGuardrails — Unicode-escaped names (#704, #692)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const customDialect = customEngine();

  // Postgres reads U&"\006Frders" as orders: on Postgres 17 it returned both tenants' rows.
  it.each([
    ["a scoped table", `SELECT id FROM U&"\\006Frders"`],
    ["a scoped table with UESCAPE", `SELECT id FROM U&"!006Frders" UESCAPE '!'`],
    ["a function call", `SELECT * FROM U&"\\0071uery_to_xml"('SELECT * FROM orders', true, false, '')`],
    ["a name right after a slice's `:`", `SELECT (ARRAY[1,2,3])[1:U&"\\006Frders"] AS x`],
  ])("reports %s under every reading that includes Postgres", (_label, sql) => {
    for (const dialect of [POSTGRES_DIALECT, COCKROACHDB_DIALECT, undefined, customDialect]) {
      expect(findings(sql, dialect), String(dialect?.id)).toContain("UNICODE_ESCAPED_IDENTIFIER:");
    }
  });

  it("refuses it under strict enforcement", () => {
    expect(() => validateTenantGuardrails(`SELECT id FROM U&"\\006Frders"`, policy, agencyScope)).toThrow(TenantGuardrailError);
  });

  it("leaves engines without U& names alone", () => {
    // MySQL reads "\006Frders" as a string, and `u & 'x'` with a space is an operator on Postgres.
    expect(findings(`SELECT u&"x" AS a FROM agencies WHERE id = :tenant_agency_ids`, MYSQL_DIALECT)).toEqual([]);
    for (const operator of [`u & "x"`, `u& "x"`, `u &"x"`]) {
      expect(findings(`SELECT ${operator} AS a FROM agencies WHERE id = :tenant_agency_ids`, POSTGRES_DIALECT)).toEqual([]);
    }
  });

  it("reads an unknown dialect with backslash escapes both ways", () => {
    // With escapes on, 'a\'' is one string and the U& name after it is code; with them off,
    // 'a\' ends early and the name sits inside the next string. The setting adds the escapes-on
    // reading to the plain one, so the name is reported (postgresReadingProfiles, #703).
    const sql = String.raw`SELECT 'a\'' AS z, U&"\006Frders" AS y FROM agencies WHERE id = :tenant_agency_ids`;
    expect(findings(sql, customEngine(true))).toContain("UNICODE_ESCAPED_IDENTIFIER:");
    expect(findings(sql, customEngine(false))).not.toContain("UNICODE_ESCAPED_IDENTIFIER:");
    // And the plain reading still runs with the setting on: here only it sees the name as code.
    expect(findings(String.raw`SELECT 'x\' AS a, U&"\006Frders" AS y`, customEngine(true))).toContain("UNICODE_ESCAPED_IDENTIFIER:");
  });
});

describe("validateTenantGuardrails — string continued after E'…' (#703)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const customDialect = customEngine();
  // Postgres reads `a'` and then an unscoped read of orders; the check saw three strings.
  const bypass = "SELECT E'a'\n'\\'' AS x, o.* FROM orders o --'";

  it.each([
    ["an unscoped read after the pair", bypass],
    ["a /* */ comment in the gap", "SELECT E'a' /* note */\n'\\'' AS x, o.* FROM orders o --'"],
    ["a JSON_OBJECT key's `:` before the E", "SELECT JSON_OBJECT('k':E'a'\n'\\'' || (SELECT count(*) FROM orders o)::text --'\n) AS x FROM agencies WHERE id = :tenant_agency_ids"],
  ])("reports %s under every reading that includes Postgres", (_label, sql) => {
    const customWithEscapes = customEngine(true);
    for (const dialect of [POSTGRES_DIALECT, COCKROACHDB_DIALECT, undefined, customDialect, customWithEscapes]) {
      expect(findings(sql, dialect), String(dialect?.id)).toContain("STRING_CONTINUATION:");
    }
  });

  it("refuses it under strict enforcement", () => {
    expect(() => validateTenantGuardrails(bypass, policy, agencyScope, { dialect: POSTGRES_DIALECT })).toThrow(TenantGuardrailError);
  });

  it("reads an unknown dialect with backslash escapes both ways", () => {
    // With escapes on, 'a\'' is one string and the E'…' pair after it is code; with them off,
    // 'a\' ends early and the pair sits inside the next string. Only one reading sees the pair.
    const sql = String.raw`SELECT 'a\'' AS z, E'b'` + "\n'c' AS y";
    expect(findings(sql, customEngine(true))).toContain("STRING_CONTINUATION:");
    expect(findings(sql, customEngine(false))).not.toContain("STRING_CONTINUATION:");
    // And the plain reading still runs with the setting on: here only it sees the pair as code.
    expect(findings(String.raw`SELECT 'x\' AS a, E'b'` + "\n'c' AS y", customEngine(true))).toContain("STRING_CONTINUATION:");
  });

  it("names the string's position, not its text", () => {
    const [warning] = validateTenantGuardrails("SELECT E'Jane Doe'\n'x' AS a", warnPolicy, agencyScope, {
      dialect: POSTGRES_DIALECT,
    }).warnings;
    expect(warning?.message).toContain("offset 7");
    expect(warning?.message).not.toContain("Jane");
  });

  it("leaves strings that keep the same reading alone", () => {
    const scoped = "FROM agencies WHERE id = :tenant_agency_ids";
    expect(findings(`SELECT 'a'\n'b' AS x ${scoped}`, POSTGRES_DIALECT)).toEqual([]);
    expect(findings(`SELECT E'a' || 'b' AS x ${scoped}`, POSTGRES_DIALECT)).toEqual([]);
    // MySQL reads E as a column and has no escape-string prefix.
    expect(findings(`SELECT E 'a'\n, 'b' AS x ${scoped}`, MYSQL_DIALECT)).toEqual([]);
  });
});

describe("validateTenantGuardrails — CockroachDB b'…' byte strings (#730)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const customDialect = customEngine();
  const customWithEscapes = customEngine(true);
  // CockroachDB reads b'…' with backslash escapes: the bytes `'`, then an unscoped read of orders.
  // The check saw one string.
  const bypass = String.raw`SELECT b'\'' AS x, o.* FROM orders o --'`;

  it.each([
    ["an unscoped read after a b'…' string", bypass],
    // CockroachDB keeps the escape mode across a continuation.
    ["an unscoped read after a continued b'…' string", "SELECT b'a'\n'\\'' AS x, o.* FROM orders o --'"],
    ["a b'…' string after a slice's `:`", String.raw`SELECT (ARRAY[1,2])[1:b'\''] AS x, o.* FROM orders o --'`],
  ])("reports %s under every reading that includes Postgres", (_label, sql) => {
    for (const dialect of [COCKROACHDB_DIALECT, POSTGRES_DIALECT, undefined, customDialect, customWithEscapes]) {
      expect(findings(sql, dialect), String(dialect?.id)).toContain("ESCAPED_BYTE_STRING:");
    }
  });

  it("refuses it under strict enforcement", () => {
    expect(() => validateTenantGuardrails(bypass, policy, agencyScope, { dialect: COCKROACHDB_DIALECT })).toThrow(TenantGuardrailError);
  });

  it("names the string's position, not its text", () => {
    const [warning] = validateTenantGuardrails(String.raw`SELECT b'Jane\x20Doe' AS a`, warnPolicy, agencyScope, {
      dialect: COCKROACHDB_DIALECT,
    }).warnings;
    expect(warning?.message).toContain("offset 7");
    expect(warning?.message).not.toContain("Jane");
  });

  it("leaves byte and bit strings that keep the same reading alone", () => {
    const scoped = "FROM agencies WHERE id = :tenant_agency_ids";
    for (const literal of ["b'abc'", "b'it''s'", "B'01'\n'10'", "x'0a'", "b'0101'"]) {
      expect(findings(`SELECT ${literal} AS x ${scoped}`, COCKROACHDB_DIALECT), literal).toEqual([]);
    }
    // MySQL's b'…' is a bit-value literal, read without escapes.
    expect(findings(`SELECT b'0101' AS x ${scoped}`, MYSQL_DIALECT)).toEqual([]);
  });
});

describe("validateTenantGuardrails — a MySQL dialect that leaves backslashEscapes unset", () => {
  // MySQL's default reads `\'` as an escaped quote, so the server sees one string from 'a to the
  // last quote and then `OR 1=1`: no tenant predicate applies.
  const sql = String.raw`SELECT * FROM orders WHERE status = 'a\' AND agency_id = :tenant_agency_ids AND status = ' OR 1=1 OR status = ''`;

  it.each([
    ["a spec with the field unset", { ...MYSQL_DIALECT, backslashEscapes: undefined } as DialectSpec],
    ["an id alone", { id: "mysql" } as Pick<DialectSpec, "id" | "backslashEscapes">],
    ["a MariaDB id alone", { id: "mariadb" } as Pick<DialectSpec, "id" | "backslashEscapes">],
  ])("reads strings with escapes on, as the server does: %s", (_label, dialect) => {
    expect(() => validateTenantGuardrails(sql, policy, agencyScope, { dialect })).toThrow(TenantGuardrailError);
  });

  it("keeps reading the built-in dialect and an explicit false as before", () => {
    expect(() => validateTenantGuardrails(sql, policy, agencyScope, { dialect: MYSQL_DIALECT })).toThrow(TenantGuardrailError);
    // With escapes off, 'a\' ends early and the predicate is code, as the server reads it then.
    const off = validateTenantGuardrails(sql, { ...policy, enforcement: "warn" }, agencyScope, { dialect: { ...MYSQL_DIALECT, backslashEscapes: false } });
    expect(off.warnings.map((w) => w.rule)).not.toContain("MISSING_TENANT_PREDICATE");
  });
});

describe("validateTenantGuardrails — `$` in names, and dollar quotes only where the engine has them", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);

  // Every engine but SQL Server reads `x$$y` as one name, so the UNION reads every tenant's orders.
  const dollarsInName =
    "SELECT id AS x$$y FROM agencies WHERE id = :tenant_agency_ids UNION ALL SELECT agency_id FROM orders ORDER BY x$$y";
  it.each([
    ["postgres", POSTGRES_DIALECT],
    ["cockroachdb", COCKROACHDB_DIALECT],
    ["mysql", MYSQL_DIALECT],
    ["mariadb", MARIADB_DIALECT],
    ["sqlite", SQLITE_DIALECT],
    ["a custom engine", customEngine()],
    ["no dialect", undefined],
  ])("%s: a $$ inside a name opens no string", (_label, dialect) => {
    expect(findings(dollarsInName, dialect)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  // Only Postgres and CockroachDB have dollar quotes; MariaDB reads `$a$` as a name.
  const dollarName =
    "SELECT id AS $a$ FROM agencies WHERE id = :tenant_agency_ids UNION ALL SELECT agency_id FROM orders ORDER BY $a$";
  it.each([
    ["mysql", MYSQL_DIALECT],
    ["mariadb", MARIADB_DIALECT],
    ["sqlite", SQLITE_DIALECT],
    ["sqlserver", SQLSERVER_DIALECT],
    ["a custom engine", customEngine()],
    ["no dialect", undefined],
  ])("%s: $a$ … $a$ is code where the engine may have no dollar quotes", (_label, dialect) => {
    expect(findings(dollarName, dialect)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  it("postgres and cockroachdb: $a$ … $a$ is still a string", () => {
    expect(findings(dollarName, POSTGRES_DIALECT)).toEqual([]);
    expect(findings(dollarName, COCKROACHDB_DIALECT)).toEqual([]);
    expect(findings("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND note = $q$ OR 1=1 $q$", POSTGRES_DIALECT)).toEqual([]);
  });

  // A dollar tag can hold non-ASCII letters, as Postgres and the shared lexer read it. The scanner
  // must read `$é$ … $é$` as a string too, or an OR it hides stays beside the predicate as code.
  const nonAsciiTag = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND $é$'$é$ = '' OR 1=1 OR 'x' = 'x'";
  it.each([
    ["postgres", POSTGRES_DIALECT],
    ["cockroachdb", COCKROACHDB_DIALECT],
    ["no dialect", undefined],
  ])("%s: a non-ASCII dollar tag is a string, so the OR it exposes defeats the predicate", (_label, dialect) => {
    expect(findings(nonAsciiTag, dialect)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  it("postgres: a non-ASCII dollar-quoted string a real predicate sits beside still passes", () => {
    expect(findings("SELECT $é$ a $é$ AS n, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids", POSTGRES_DIALECT)).toEqual([]);
  });
});

describe("validateTenantGuardrails — a carriage return ends a `--` comment on Postgres and SQL Server only", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);

  // Postgres and SQL Server end the comment at the CR, so the UNION reads every tenant's orders.
  const unionAfterCr = "SELECT id FROM agencies WHERE id = :tenant_agency_ids --\rUNION ALL SELECT agency_id FROM orders";
  it.each([
    ["postgres", POSTGRES_DIALECT],
    ["cockroachdb, read both ways like postgres", COCKROACHDB_DIALECT],
    ["sqlserver", SQLSERVER_DIALECT],
    ["a custom engine", customEngine()],
    ["no dialect", undefined],
  ])("%s: a UNION after the CR is code", (_label, dialect) => {
    expect(findings(unionAfterCr, dialect)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  it("mysql, mariadb and sqlite: the comment runs to the end of the line, as they read it", () => {
    for (const dialect of [MYSQL_DIALECT, MARIADB_DIALECT, SQLITE_DIALECT]) expect(findings(unionAfterCr, dialect), dialect.id).toEqual([]);
  });

  // MySQL, MariaDB, SQLite and CockroachDB end the comment only at `\n`, so the predicate is commented out.
  const predicateAfterCr = "SELECT * FROM orders WHERE 1=1 -- x\rAND agency_id = :tenant_agency_ids";
  it.each([
    ["mysql", MYSQL_DIALECT],
    ["mariadb", MARIADB_DIALECT],
    ["sqlite", SQLITE_DIALECT],
    ["cockroachdb", COCKROACHDB_DIALECT],
    ["postgres, which a host may point at CockroachDB", POSTGRES_DIALECT],
    ["a custom engine", customEngine()],
    ["no dialect", undefined],
  ])("%s: a predicate after the CR doesn't count", (_label, dialect) => {
    expect(findings(predicateAfterCr, dialect)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  it("sqlserver: a predicate after the CR counts, as SQL Server reads it", () => {
    expect(findings(predicateAfterCr, SQLSERVER_DIALECT)).toEqual([]);
  });

  it("a statement on the line after the comment is a statement where only `\\n` ends it, not part of a string", () => {
    const sql = "SELECT id FROM agencies WHERE id = :tenant_agency_ids -- \r'\n; DO SLEEP(1) -- '";
    for (const dialect of [MYSQL_DIALECT, SQLITE_DIALECT, POSTGRES_DIALECT, COCKROACHDB_DIALECT, undefined]) {
      expect(findings(sql, dialect), String(dialect?.id)).toContain("NOT_SELECT_OR_WITH:");
    }
  });
});

describe("validateTenantGuardrails — a table named after a word only some engines reserve", () => {
  // The engine reads each unquoted name as the table, so the query needs that table's predicate.
  const scopedAs = (name: string): NormalizedTenantPolicy => ({
    ...policy,
    enforcement: "warn",
    scopedTables: [{ id: `table:app.${name}`, scopeThrough: [{ root: "table:public.agencies", column: `table:app.${name}#agency_id` }] }],
    polymorphicTables: [],
    globalTables: [],
    coverage: [],
  });
  const findings = (name: string, sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, scopedAs(name), agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);

  it.each([
    ["user", "mysql", MYSQL_DIALECT],
    ["lock", "postgres", POSTGRES_DIALECT],
    ["qualify", "postgres", POSTGRES_DIALECT],
    ["by", "postgres", POSTGRES_DIALECT],
    ["limit", "sqlserver", SQLSERVER_DIALECT],
    ["window", "sqlite", SQLITE_DIALECT],
    ["user", "no dialect", undefined],
  ])("%s on %s: an unquoted name in FROM is the table", (name, _d, dialect) => {
    expect(findings(name, `SELECT * FROM ${name} t`, dialect)).toEqual([`MISSING_TENANT_PREDICATE:table:app.${name}`]);
    expect(findings(name, `SELECT * FROM ${name} t WHERE t.agency_id = :tenant_agency_ids`, dialect)).toEqual([]);
  });

  it("ORDER BY and GROUP BY are keywords, not a table named order, group or by", () => {
    for (const name of ["order", "group", "by"]) {
      expect(findings(name, "SELECT id FROM lookup_states GROUP BY id ORDER BY id", POSTGRES_DIALECT), name).toEqual([]);
      expect(findings(name, `SELECT id FROM "${name}" GROUP BY id ORDER BY id`, POSTGRES_DIALECT), name).toEqual([`MISSING_TENANT_PREDICATE:table:app.${name}`]);
    }
  });
});

describe("validateTenantGuardrails — ORDER BY and GROUP BY don't name a table called order or group (#828)", () => {
  // As the multi-engine fixture leaves `billing.order`: any query naming these tables is refused.
  const keywordTables: NormalizedTenantPolicy = {
    ...policy,
    enforcement: "warn",
    coverage: [
      ...policy.coverage,
      { tableId: "table:billing.order", classification: "unknown" },
      { tableId: "table:app.group", classification: "unknown" },
    ],
  };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, keywordTables, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const dialects: Array<[string, DialectSpec | undefined]> = [
    ["postgres", POSTGRES_DIALECT],
    ["mysql", MYSQL_DIALECT],
    ["sqlserver", SQLSERVER_DIALECT],
    ["sqlite", SQLITE_DIALECT],
    ["no dialect", undefined],
  ];

  it.each(dialects)("%s: a sorted, grouped query passes", (_label, dialect) => {
    for (const sql of [
      "SELECT status, count(*) FROM orders WHERE agency_id = :tenant_agency_ids GROUP BY status ORDER BY status",
      "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER /* newest */ BY id",
      "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids order\nby id",
    ]) {
      expect(findings(sql, dialect), sql).toEqual([]);
    }
  });

  it.each([
    ["FROM, quoted", POSTGRES_DIALECT, 'SELECT * FROM billing."order" ORDER BY id', "billing.order"],
    ["JOIN, quoted", POSTGRES_DIALECT, 'SELECT * FROM orders o JOIN "order" b ON b.id = o.id WHERE o.agency_id = :tenant_agency_ids ORDER BY o.id', "billing.order"],
    ["FROM, backticks", MYSQL_DIALECT, "SELECT * FROM `order` ORDER BY id", "billing.order"],
    ["FROM, brackets", SQLSERVER_DIALECT, "SELECT * FROM [order] ORDER BY id", "billing.order"],
    ["a quoted qualifier in ORDER BY", POSTGRES_DIALECT, 'SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY "order".id', "billing.order"],
    ["GROUP BY on the table named group", POSTGRES_DIALECT, 'SELECT g.id FROM app."group" g GROUP BY g.id', "app.group"],
    // Postgres reads both as the table `order` with the alias `by`.
    ["a quoted name, then an alias by", POSTGRES_DIALECT, 'SELECT * FROM "order" by WHERE by.id > 0', "billing.order"],
    ["a qualified name, then an alias by", POSTGRES_DIALECT, "SELECT * FROM billing.order by WHERE by.id > 0", "billing.order"],
    // No built-in engine accepts `order` unquoted as a table, and the check still counts it.
    ["FROM, unquoted", POSTGRES_DIALECT, "SELECT * FROM order o ORDER BY id", "billing.order"],
  ])("%s still names the table", (_label, dialect, sql, table) => {
    expect(findings(sql, dialect)).toEqual([`UNKNOWN_TABLE_REFERENCED:table:${table}`]);
  });
});

describe("validateTenantGuardrails — a name or number ends where SQL Server ends it (#623)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const scoped = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND ";

  // SQL Server reads each tail as `… OR 1=1`, so the tenant predicate is no longer a conjunct.
  const gluedOr: Array<[string, string]> = [
    ["U+00A0, which SQL Server reads as whitespace", "1=1\u00a0OR 1=1"],
    ["U+200B, which SQL Server reads as whitespace", "1=1\u200bOR 1=1"],
    ["U+0085, which SQL Server reads as whitespace", "1=1\u0085OR 1=1"],
    ["`0x`, an empty binary literal", "1=0xOR 1=1"],
    ["`1E`, a float with no exponent digits", "1=1EOR 1=1"],
  ];

  it.each(gluedOr)("sqlserver: an OR after %s is read", (_label, tail) => {
    expect(findings(scoped + tail, SQLSERVER_DIALECT)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  it.each(gluedOr)("a custom engine or no dialect, which may be SQL Server: an OR after %s is read", (_label, tail) => {
    expect(findings(scoped + tail, customEngine())).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
    expect(findings(scoped + tail)).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
  });

  it("a strict policy refuses it", () => {
    expect(() => validateTenantGuardrails(scoped + "1=0xOR 1=1", policy, agencyScope, { dialect: SQLSERVER_DIALECT }))
      .toThrow(TenantGuardrailError);
  });

  it("the same tails with an ASCII space are refused, as before", () => {
    for (const tail of ["1=1 OR 1=1", "1=0x OR 1=1", "1=1E OR 1=1"]) {
      expect(findings(scoped + tail, SQLSERVER_DIALECT), tail).toEqual(["MISSING_TENANT_PREDICATE:table:public.orders"]);
    }
  });

  it("a scoped query that uses these forms without an OR still passes", () => {
    for (const sql of [
      `${scoped}flags = 0x AND rate = 1E`,
      "SELECT *\u00a0FROM orders\u00a0WHERE agency_id\u00a0=\u00a0:tenant_agency_ids",
      "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids\u200bAND\u0085status = 'open'",
    ]) {
      expect(findings(sql, SQLSERVER_DIALECT), sql).toEqual([]);
    }
  });
});

describe("validateTenantGuardrails — a keyword written right after a number or $N parameter (GHSA-rhwf-7742-8hwj)", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec, p: NormalizedTenantPolicy = warnPolicy) =>
    validateTenantGuardrails(sql, p, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const scoped = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND ";
  const orders = ["MISSING_TENANT_PREDICATE:table:public.orders"];

  // MySQL and MariaDB end a number after its decimal point or exponent and read the word after it.
  it.each(["1=1.0OR 1=1", "1=1e1OR 1=1", "1=.5OR 1=1", "1=1.XOR 1=1"])("mysql and mariadb: an OR after the number in %s is read", (tail) => {
    for (const dialect of [MYSQL_DIALECT, MARIADB_DIALECT]) expect(findings(scoped + tail, dialect), dialect.id).toEqual(orders);
  });

  // PostgreSQL 14 and earlier end a number at its last digit and read the word after it.
  it.each(["1=1OR 1=1", "1=1.0OR 1=1", "1=1e1OR 1=1"])("postgres: an OR after the number in %s is read", (tail) => {
    expect(findings(scoped + tail, POSTGRES_DIALECT)).toEqual(orders);
  });

  // PostgreSQL 14 and CockroachDB end a `$N` parameter at its last digit and read the word after it,
  // so the tenant check refuses a parameter written against a word wherever the SQL may be read as Postgres.
  it.each([
    ["postgres", POSTGRES_DIALECT],
    ["cockroachdb", COCKROACHDB_DIALECT],
    ["a custom engine", customEngine()],
    ["no dialect", undefined],
  ])("%s: a $N parameter written against a word is refused", (_label, dialect) => {
    expect(findings(scoped + "0 < $1OR TRUE", dialect)).toContain("NOT_SELECT_OR_WITH:");
    expect(findings("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND id = $1UNION SELECT * FROM orders", dialect)).toContain("NOT_SELECT_OR_WITH:");
  });

  it("mysql and mariadb: `$1OR` is one name there, so no parameter refusal", () => {
    for (const dialect of [MYSQL_DIALECT, MARIADB_DIALECT]) expect(findings(scoped + "0 < $1OR TRUE", dialect), dialect.id).not.toContain("NOT_SELECT_OR_WITH:");
  });

  it("the same tails with an ASCII space are refused, as before", () => {
    for (const tail of ["1=1.0 OR 1=1", "1=1 OR 1=1", "0 < $1 OR TRUE"]) {
      expect(findings(scoped + tail, MYSQL_DIALECT), tail).toEqual(orders);
      expect(findings(scoped + tail), tail).toEqual(orders);
    }
  });

  it("a scoped query with numbers and parameters that hide no keyword still passes", () => {
    for (const sql of [
      `${scoped}total > 1.5 AND total < 1e3 AND status = 'open'`,
      `${scoped}total > $1 AND x$1y = 1`,
      "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY 1",
    ]) {
      for (const dialect of [MYSQL_DIALECT, POSTGRES_DIALECT, undefined]) expect(findings(sql, dialect), `${dialect?.id}: ${sql}`).toEqual([]);
    }
  });

  it("mysql: a name that starts with digits is one name, as MySQL reads it", () => {
    // MySQL reads `3d_models` as one name, and `1OR` too (a syntax error where a value goes).
    const digitTable: NormalizedTenantPolicy = {
      ...warnPolicy,
      scopedTables: [{ id: "table:app.3d_models", scopeThrough: [{ root: "table:public.agencies", column: "table:app.3d_models#agency_id" }] }],
      polymorphicTables: [],
      globalTables: [],
      coverage: [],
    };
    expect(findings("SELECT * FROM 3d_models", MYSQL_DIALECT, digitTable)).toEqual(["MISSING_TENANT_PREDICATE:table:app.3d_models"]);
    expect(findings("SELECT * FROM 3d_models WHERE agency_id = :tenant_agency_ids", MYSQL_DIALECT, digitTable)).toEqual([]);
  });
});

describe("validateTenantGuardrails — `]]` in a bracketed name, and nested block comments", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec) =>
    validateTenantGuardrails(sql, warnPolicy, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  const missing = ["MISSING_TENANT_PREDICATE:table:public.orders"];

  // SQL Server reads `]]` inside `[…]` as an escaped `]`, so `[o]] WHERE … AND [x]` is one alias, and on
  // SQL Server 2022 the statement returned every row.
  it.each([["sqlserver", SQLSERVER_DIALECT], ["a custom id", customEngine()], ["no dialect", undefined]] as const)(
    "refuses a `]]` alias that runs over the predicate under %s",
    (_label, dialect) => {
      expect(findings("SELECT * FROM orders AS [o]] WHERE agency_id = :tenant_agency_ids AND [x]", dialect)).toEqual(missing);
    },
  );

  // SQL Server, Postgres and CockroachDB nest block comments, so the predicate is inside one: each returned every row.
  it.each([
    ["sqlserver", SQLSERVER_DIALECT],
    ["postgres", POSTGRES_DIALECT],
    ["cockroachdb", COCKROACHDB_DIALECT],
    ["a custom id", customEngine()],
    ["no dialect", undefined],
  ] as const)(
    "refuses a predicate inside a nested block comment under %s",
    (_label, dialect) => {
      expect(findings("SELECT * FROM orders WHERE 1=1 /* /* */ AND agency_id = :tenant_agency_ids AND 1=1 -- */", dialect)).toEqual(missing);
    },
  );

  it("a strict policy refuses both", () => {
    for (const sql of [
      "SELECT * FROM orders AS [o]] WHERE agency_id = :tenant_agency_ids AND [x]",
      "SELECT * FROM orders WHERE 1=1 /* /* */ AND agency_id = :tenant_agency_ids AND 1=1 -- */",
    ]) {
      expect(() => validateTenantGuardrails(sql, policy, agencyScope, { dialect: SQLSERVER_DIALECT }), sql).toThrow(TenantGuardrailError);
    }
  });

  it.each([["sqlserver", SQLSERVER_DIALECT], ["postgres", POSTGRES_DIALECT], ["no dialect", undefined]] as const)(
    "keeps bracketed names and closed comments under %s",
    (_label, dialect) => {
      for (const sql of [
        "SELECT [agency_id] FROM [orders] WHERE [agency_id] = :tenant_agency_ids",
        "SELECT [a]]b] FROM orders WHERE agency_id = :tenant_agency_ids",
        "SELECT * FROM orders /* a /* b */ c */ WHERE agency_id = :tenant_agency_ids",
        "SELECT * FROM orders /* note */ WHERE agency_id = :tenant_agency_ids",
      ]) {
        expect(findings(sql, dialect), sql).toEqual([]);
      }
    },
  );

  it("reads a comment MySQL doesn't nest the way MySQL does", () => {
    // MySQL ends the comment at the first `*/`, so the predicate is code there.
    expect(findings("SELECT * FROM orders WHERE 1=1 /* /* */ AND agency_id = :tenant_agency_ids", MYSQL_DIALECT)).toEqual([]);
  });
});

describe("validateTenantGuardrails — a name outside printable ASCII that the schema doesn't spell", () => {
  const warnPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const findings = (sql: string, dialect?: DialectSpec, p: NormalizedTenantPolicy = warnPolicy) =>
    validateTenantGuardrails(sql, p, agencyScope, { dialect }).warnings.map((w) => `${w.rule}:${w.tableId}`);
  /** `orders` in fullwidth letters. */
  const orders = "ｏｒｄｅｒｓ";
  const folding = [["sqlserver", SQLSERVER_DIALECT], ["a custom id", customEngine()], ["no dialect", undefined]] as const;

  // SQL Server resolves a name through the database collation, which ignores some characters and reads
  // others as ASCII letters: on SQL Server 2022 each of these spellings of people.client read all 25
  // clients across 7 agencies, so the table they name is the scoped one.
  const quoted: Array<[string, string]> = [
    ["fullwidth letters", `SELECT * FROM [${orders}]`],
    ["fullwidth letters in double quotes", `SELECT * FROM "${orders}"`],
    ["a zero-width joiner", "SELECT * FROM [ord‍ers]"],
    ["U+FEFF", "SELECT * FROM public.[ord﻿ers]"],
    ["a word joiner", "SELECT * FROM [ord⁠ers]"],
    ["small capitals", "SELECT * FROM [oʀdeʀs]"],
    ["an emoji", "SELECT * FROM [ord\u{1f600}ers]"],
    ["the root table in fullwidth letters", "SELECT * FROM [ａｇｅｎｃｉｅｓ]"],
  ];

  it.each(folding)("refuses a quoted name the collation may fold under %s", (_label, dialect) => {
    for (const [label, sql] of quoted) expect(findings(sql, dialect), label).toContain("UNICODE_ESCAPED_IDENTIFIER:");
  });

  it.each(folding)("refuses an unquoted name outside printable ASCII under %s", (_label, dialect) => {
    expect(findings(`SELECT * FROM ${orders}`, dialect)).toContain("UNICODE_ESCAPED_IDENTIFIER:");
  });

  it("a strict policy refuses it", () => {
    expect(() => validateTenantGuardrails(`SELECT * FROM [${orders}]`, policy, agencyScope, { dialect: SQLSERVER_DIALECT }))
      .toThrow(TenantGuardrailError);
  });

  it.each([
    ["postgres", POSTGRES_DIALECT],
    ["cockroachdb", COCKROACHDB_DIALECT],
    ["mysql", MYSQL_DIALECT],
    ["mariadb", MARIADB_DIALECT],
    ["sqlite", SQLITE_DIALECT],
  ] as const)("leaves %s alone, which compares such a name as written", (_label, dialect) => {
    expect(findings(`SELECT * FROM [${orders}]`, dialect)).toEqual([]);
    expect(findings('SELECT * FROM "ord‍ers"', dialect)).toEqual([]);
  });

  it.each(folding)("accepts a non-ASCII name the schema spells exactly under %s, and refuses another spelling of it", (_label, dialect) => {
    const withTable: NormalizedTenantPolicy = {
      ...warnPolicy,
      coverage: [...warnPolicy.coverage, { tableId: "table:public.Größe", classification: "global" }],
    };
    expect(findings("SELECT * FROM [Größe]", dialect, withTable)).toEqual([]);
    expect(findings("SELECT * FROM [GRÖSSE]", dialect, withTable)).toContain("UNICODE_ESCAPED_IDENTIFIER:");
  });

  it.each(folding)("reads non-ASCII text in strings and comments as text under %s", (_label, dialect) => {
    expect(findings("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND status = N'ｏｐｅｎ'", dialect)).toEqual([]);
    expect(findings("SELECT * FROM orders /* ｎｏｔｅ */ WHERE agency_id = :tenant_agency_ids", dialect)).toEqual([]);
  });

  it.each(folding)("keeps ASCII quoted names under %s", (_label, dialect) => {
    expect(findings("SELECT [agency_id] FROM [orders] WHERE [agency_id] = :tenant_agency_ids", dialect)).toEqual([]);
  });
});
