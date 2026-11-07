/**
 * bindPreparedQuery() as an enforcement point (ADR 0010, "Enforcing reuse: re-check at
 * rebind"): it re-runs the guardrails on the stored template under the bind-time schema,
 * scope and modes, and renders tenant IDs from the bind-time scope.
 */
import type { LanguageModel } from "ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ask,
  bindPreparedQuery,
  expandTenantScope,
  QueryParameterError,
  SensitiveReferenceError,
  SqlValidationError,
  TenantGuardrailError,
  TenantScopeError,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  validateSelectSql,
  type BuiltInDialectId,
  type DialectSpec,
  type NormalizedSchema,
  type NormalizedSchemaV2,
  type PreparedQuery,
  type TenantScope,
} from "../index.js";
import { loadSchema } from "../schema/v2/loader.js";

const here = dirname(fileURLToPath(import.meta.url));
const multiTenantDir = join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema");

const fakeModel = {} as LanguageModel;
const agencies = "table:public.agencies";
const subAgencies = "table:public.sub_agencies";
const clients = "table:public.clients";

/** The fixture's policy is `enforcement: strict`. */
const strictSchema = loadSchema(multiTenantDir);
const warnSchema: NormalizedSchemaV2 = {
  ...strictSchema,
  tenantPolicy: { ...strictSchema.tenantPolicy!, enforcement: "warn" },
};
const { tenantPolicy: _policy, ...noPolicySchema } = strictSchema;

const agencyIds = (...ids: string[]): TenantScope => ({ access: { kind: "ids", tenantRoot: agencies, ids } });
const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };

const status = { name: "status_name", placeholder: ":status_name", type: "string", cardinality: "one", source: "question" } as const;
const tenantDecl = (name: string) =>
  ({ name, placeholder: `:${name}`, type: "string", cardinality: "many", source: "tenant" }) as const;

function template(namedSql: string, dialect: BuiltInDialectId = "postgres"): PreparedQuery {
  const parameters: PreparedQuery["parameters"] = [];
  if (namedSql.includes(":status_name")) parameters.push(status);
  for (const m of new Set(namedSql.match(/:tenant_[a-z_]+_ids/g) ?? [])) parameters.push(tenantDecl(m.slice(1)));
  return { version: 1, dialect, dialectRules: "builtin", namedSql, parameters };
}

/** A three-block model reply: the bound SQL, its `sql-unbound` template, and the manifest. */
function reply(sql: string, unbound: string, value = "shipped"): string {
  return [
    "```sql",
    sql,
    "```",
    "```sql-unbound",
    unbound,
    "```",
    "```json",
    JSON.stringify({ parameters: [{ name: "status_name", type: "string", cardinality: "one", value }] }),
    "```",
  ].join("\n");
}

async function askForTemplate(options: {
  sql: string;
  unbound: string;
  schema: NormalizedSchemaV2 | NormalizedSchema;
  tenantScope?: TenantScope;
  dialect?: BuiltInDialectId | DialectSpec;
}): Promise<PreparedQuery> {
  const result = await ask({
    question: "orders by status",
    schema: options.schema,
    model: fakeModel,
    dialect: options.dialect ?? "postgres",
    ...(options.tenantScope ? { tenantScope: options.tenantScope } : {}),
    deps: { generateText: vi.fn(async () => ({ text: reply(options.sql, options.unbound) })) as never },
  });
  expect(result.preparedQuery).toBeDefined();
  return result.preparedQuery!;
}

const scopedOrders = "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status_name";

describe("bindPreparedQuery — guardrail context is required", () => {
  it("throws MISSING_GUARDRAIL_CONTEXT when called without the third argument", () => {
    const call = () =>
      (bindPreparedQuery as unknown as (p: PreparedQuery, v: object) => unknown)(template(scopedOrders), {
        status_name: "open",
      });
    expect(call).toThrow(QueryParameterError);
    expect(call).toThrow(expect.objectContaining({ reason: "MISSING_GUARDRAIL_CONTEXT" }));
  });
});

describe("bindPreparedQuery — tenant IDs come from the bind-time scope", () => {
  it("renders the scope's IDs into the tenant predicate, and a passing template's verdict is allow", () => {
    const bound = bindPreparedQuery(template(scopedOrders), { status_name: "open" }, {
      schema: strictSchema,
      tenantSqlMode: "sql-only",
      tenantScope: agencyIds("2"),
    });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = '2' AND status = 'open'");
    expect(bound.unboundSql).toBe("SELECT count(*) FROM orders WHERE agency_id = $2 AND status = $1");
    expect(bound.params).toEqual(["open", "2"]);
    expect(bound.verdict).toEqual({ outcome: "allow", findings: [] });
  });

  it("throws TENANT_VALUE_SUPPLIED for a :tenant_* key in values", () => {
    for (const key of ["tenant_agency_ids", ":tenant_agency_ids"]) {
      expect(() =>
        bindPreparedQuery(template(scopedOrders), { status_name: "open", [key]: ["99"] }, {
          schema: strictSchema,
          tenantScope: agencyIds("2"),
        }),
      ).toThrow(expect.objectContaining({ name: "QueryParameterError", reason: "TENANT_VALUE_SUPPLIED" }));
    }
  });

  it("throws SUBTREE_NOT_RESOLVABLE for an unexpanded subtree scope", () => {
    const error = catchError(() =>
      bindPreparedQuery(template(scopedOrders), { status_name: "open" }, {
        schema: strictSchema,
        tenantScope: { access: { kind: "subtree", tenantRoot: agencies, rootIds: ["1"], includeDescendants: true } },
      }),
    );
    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("SUBTREE_NOT_RESOLVABLE");
    expect((error as TenantScopeError).message).toContain("expandTenantScope()");
  });

  it("throws UNRESOLVED_TENANT_PLACEHOLDER for a template scoped through another root", () => {
    const error = catchError(() =>
      bindPreparedQuery(template(scopedOrders), { status_name: "open" }, {
        schema: strictSchema,
        tenantScope: { access: { kind: "ids", tenantRoot: clients, ids: ["5"] } },
      }),
    );
    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
  });

  // On main the binder threw INVALID_LIST_CONTEXT: ask() declares :tenant_* as a list
  // parameter, and `col = :list` isn't a list context. Tenant substitution rewrites it.
  it.each([
    {
      dialect: "postgres" as const,
      unboundSql: "SELECT count(*) FROM orders WHERE agency_id IN ($2, $3) AND status = $1",
      params: ["open", "7", "8"],
      paramsSql: "SELECT count(*) FROM orders WHERE agency_id IN ($1, $2) AND status = 'open'",
    },
    {
      dialect: "mysql" as const,
      unboundSql: "SELECT count(*) FROM orders WHERE agency_id IN (?, ?) AND status = ?",
      params: ["7", "8", "open"],
      paramsSql: "SELECT count(*) FROM orders WHERE agency_id IN (?, ?) AND status = 'open'",
    },
  ])("$dialect: an `agency_id = :tenant_agency_ids` template from ask() rebinds under two IDs", async (c) => {
    const prepared = await askForTemplate({
      sql: "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'shipped'",
      unbound: scopedOrders,
      schema: strictSchema,
      tenantScope: agencyIds("42"),
      dialect: c.dialect,
    });
    const bound = bindPreparedQuery(prepared, { status_name: "open" }, {
      schema: strictSchema,
      tenantSqlMode: "sql-only",
      tenantScope: agencyIds("7", "8"),
    });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id IN ('7', '8') AND status = 'open'");
    expect(bound.unboundSql).toBe(c.unboundSql);
    expect(bound.params).toEqual(c.params);
    expect(bound.bindings.map((b) => [b.name, b.indices])).toEqual([["status_name", [c.params.indexOf("open")]]]);

    // By default (sql-params) `sql` numbers its tenant markers from the first slot, and
    // `tenantParams` follows them; `unboundSql` + `params` don't depend on the mode.
    const byDefault = bindPreparedQuery(prepared, { status_name: "open" }, {
      schema: strictSchema,
      tenantScope: agencyIds("7", "8"),
    });
    expect(byDefault.sql).toBe(c.paramsSql);
    expect(byDefault.tenantParams).toEqual(["7", "8"]);
    expect(byDefault.unboundSql).toBe(c.unboundSql);
    expect(byDefault.params).toEqual(c.params);
  });

  // ask() used to mask :tenant_* as this token and unmask by regex; a business value equal
  // to it must never be rewritten into a placeholder.
  it("passes a business value equal to the old mask token through unchanged", () => {
    const token = "__askdb_tenant_agency_ids__";
    const bound = bindPreparedQuery(template(scopedOrders), { status_name: token }, {
      schema: strictSchema,
      tenantSqlMode: "sql-only",
      tenantScope: agencyIds("2"),
    });
    expect(bound.sql).toBe(`SELECT count(*) FROM orders WHERE agency_id = '2' AND status = '${token}'`);
    expect(bound.params).toEqual([token, "2"]);
  });

  // As in ask() (ADR 0024), a rebind's default is tenantSqlMode "sql-params": `sql` keeps the
  // business values inlined and holds tenant markers, run with `tenantParams`, so a tenant ID
  // that no literal can carry safely (#664: agência; #371: a backslash, `¥` under sjis) binds.
  it.each(["agência", "x\\' OR 1=1 -- ", "2¥' OR 1=1 -- "])("binds the tenant ID %j as a driver parameter by default", (id) => {
    const bound = bindPreparedQuery(template(scopedOrders), { status_name: "open" }, {
      schema: strictSchema,
      tenantScope: agencyIds(id),
    });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = $1 AND status = 'open'");
    expect(bound.tenantParams).toEqual([id]);
    expect(bound.params).toContain(id);
  });

  // A mode the rebind doesn't recognise is refused, as in ask(), never read as either mode.
  it("refuses a tenantSqlMode it doesn't recognise", () => {
    expect(() =>
      bindPreparedQuery(template(scopedOrders), { status_name: "open" }, {
        schema: strictSchema,
        tenantScope: agencyIds("2"),
        tenantSqlMode: "sql_only" as never,
      }),
    ).toThrow(expect.objectContaining({ name: "TenantScopeError", reason: "TENANT_SQL_MODE_REQUIRED" }));
  });

  // In "sql-only" mode the rebind inlines the IDs, and only printable ASCII without a
  // backslash reads the same under every server string setting and connection charset, so
  // it refuses any other ID, and names the mode that binds it.
  it.each(["agência", "x\\' OR 1=1 -- ", "2¥' OR 1=1 -- "])("in sql-only mode, throws UNESCAPABLE_TENANT_ID for the tenant ID %j", (id) => {
    expect(() =>
      bindPreparedQuery(template(scopedOrders), { status_name: "open" }, {
        schema: strictSchema,
        tenantScope: agencyIds(id),
        tenantSqlMode: "sql-only",
      }),
    ).toThrow(
      expect.objectContaining({
        name: "TenantScopeError",
        reason: "UNESCAPABLE_TENANT_ID",
        message: expect.stringContaining("'sql-params'"),
      }),
    );
  });
});

// The tenant rule reads `:status_nameOR` as one token; a renderer that substituted
// `:status_name` alone would leave `'open'OR 1=1`, an unscoped read the rule never saw.
describe("bindPreparedQuery — a placeholder glued to an identifier", () => {
  it.each([":status_nameOR 1=1", ":status_name$x", ":status_nameé"])("refuses `%s` instead of rendering part of it", (tail) => {
    const sql = `SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND status = ${tail}`;
    const error = catchError(() =>
      bindPreparedQuery(template(sql), { status_name: "open" }, { schema: strictSchema, tenantScope: agencyIds("5") }),
    );
    expect(error).toBeInstanceOf(QueryParameterError);
    expect((error as QueryParameterError).reason).toBe("UNRESOLVED_PLACEHOLDER");
  });
});

// #789: a stored template whose parameter declares a type or cardinality AskDB doesn't know is a
// broken template, not a bad value: QueryParameterError with INVALID_DECLARATION, checked before
// any value is read, never a raw TypeError from the renderer.
describe("bindPreparedQuery — a parameter declaration AskDB doesn't know", () => {
  const unscoped = "SELECT count(*) FROM orders WHERE status = :status_name";
  const declaring = (declaration: Record<string, unknown>): PreparedQuery => ({
    ...template(unscoped),
    parameters: [{ ...status, ...declaration } as unknown as PreparedQuery["parameters"][number]],
  });

  it.each([
    ["an unknown type", { type: "uuid" }, "type", "string, number, boolean, date or datetime"],
    ["an unknown cardinality", { cardinality: "several" }, "cardinality", "one or many"],
  ])("refuses %s with INVALID_DECLARATION, naming the parameter", (_case, declaration, field, expected) => {
    const error = catchError(() => bindPreparedQuery(declaring(declaration), { status_name: "open" }, { schema: noPolicySchema }));

    expect(error).toBeInstanceOf(QueryParameterError);
    expect((error as QueryParameterError).reason).toBe("INVALID_DECLARATION");
    expect((error as Error).message).toBe(
      `Parameter 'status_name' declares a ${field} AskDB doesn't support; expected ${expected}. Regenerate the template.`,
    );
  });

  it.each([
    ["a parameters field that isn't a list", { ...template(unscoped), parameters: undefined }, "The template's parameters aren't a list. Regenerate the template."],
    ["an entry that isn't a declaration", { ...template(unscoped), parameters: [status, null] }, "Parameter 2 in the template isn't a declaration. Regenerate the template."],
  ])("refuses %s with INVALID_DECLARATION, not a TypeError", (_case, prepared, message) => {
    const error = catchError(() => bindPreparedQuery(prepared as unknown as PreparedQuery, { status_name: "open" }, { schema: noPolicySchema }));

    expect(error).toBeInstanceOf(QueryParameterError);
    expect((error as QueryParameterError).reason).toBe("INVALID_DECLARATION");
    expect((error as Error).message).toBe(message);
  });

  it("reports the declaration before a missing value", () => {
    const error = catchError(() => bindPreparedQuery(declaring({ type: "uuid" }), {}, { schema: noPolicySchema }));

    expect((error as QueryParameterError).reason).toBe("INVALID_DECLARATION");
  });
});

describe("bindPreparedQuery — tenant placeholders nothing can render", () => {
  const unscoped = "SELECT count(*) FROM orders WHERE status = :status_name";

  it("throws UNRESOLVED_TENANT_PLACEHOLDER under a global scope; a template without one binds", () => {
    const error = catchError(() =>
      bindPreparedQuery(template(scopedOrders), { status_name: "open" }, { schema: strictSchema, tenantScope: globalScope }),
    );
    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");

    const bound = bindPreparedQuery(template(unscoped), { status_name: "open" }, {
      schema: strictSchema,
      tenantScope: globalScope,
    });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE status = 'open'");
  });

  // As in ask(): the tenant check doesn't count a placeholder nothing can render, so a
  // strict policy denies with its verdict; a template the decision lets through is still
  // refused before binding.
  it.each([":TENANT_AGENCY_IDS", ":tenant_agency_idsOR"])(
    "refuses %s: TenantGuardrailError under strict, UNRESOLVED_TENANT_PLACEHOLDER once a warn is accepted",
    (placeholder) => {
      const sql = scopedOrders.replace(":tenant_agency_ids", placeholder);
      const denied = catchError(() =>
        bindPreparedQuery(template(sql), { status_name: "open" }, { schema: strictSchema, tenantScope: agencyIds("2") }),
      );
      expect(denied).toBeInstanceOf(TenantGuardrailError);
      expect((denied as TenantGuardrailError).verdict?.outcome).toBe("deny");

      const accepted = catchError(() =>
        bindPreparedQuery(template(sql), { status_name: "open" }, {
          schema: warnSchema,
          tenantScope: agencyIds("2"),
          acceptWarnings: ["tenant"],
        }),
      );
      expect(accepted).toBeInstanceOf(TenantScopeError);
      expect((accepted as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
    },
  );

  it.each([
    { name: "a v1 schema", schema: { tables: [] } satisfies NormalizedSchema },
    { name: "a v2 schema without a tenant policy", schema: noPolicySchema },
  ])("throws UNRESOLVED_TENANT_PLACEHOLDER for a placeholder-bearing template bound with $name", ({ schema }) => {
    for (const sql of [scopedOrders, scopedOrders.replace(":tenant_agency_ids", ":TENANT_AGENCY_IDS")]) {
      const error = catchError(() => bindPreparedQuery(template(sql), { status_name: "open" }, { schema }));
      expect(error).toBeInstanceOf(TenantScopeError);
      expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
    }
  });
});

describe("bindPreparedQuery — the tenant check runs under the bind-time scope and policy", () => {
  const unscoped = "SELECT count(*) FROM orders WHERE status = :status_name";
  const unscopedReply = { sql: "SELECT count(*) FROM orders WHERE status = 'shipped'", unbound: unscoped };

  it("refuses a template produced under a global scope when rebound under an ids scope (strict)", async () => {
    const prepared = await askForTemplate({ ...unscopedReply, schema: strictSchema, tenantScope: globalScope });
    const error = catchError(() =>
      bindPreparedQuery(prepared, { status_name: "open" }, { schema: strictSchema, tenantScope: agencyIds("2") }),
    );
    expect(error).toBeInstanceOf(TenantGuardrailError);
    expect((error as TenantGuardrailError).warnings.map((w) => [w.rule, w.tableId])).toEqual([
      ["MISSING_TENANT_PREDICATE", "table:public.orders"],
    ]);
    expect((error as TenantGuardrailError).verdict?.outcome).toBe("deny");

    // acceptWarnings accepts a `warn`; it never unlocks a strict policy.
    const accepted = catchError(() =>
      bindPreparedQuery(prepared, { status_name: "open" }, {
        schema: strictSchema,
        tenantScope: agencyIds("2"),
        acceptWarnings: ["tenant"],
      }),
    );
    expect(accepted).toBeInstanceOf(TenantGuardrailError);
    expect((accepted as Error).message).toMatch(/strict mode/);
  });

  // The #186 requirement: a warning is not seen once and then reused forever.
  it("under warn, refuses a failing template unless acceptWarnings includes tenant", async () => {
    const prepared = await askForTemplate({ ...unscopedReply, schema: warnSchema, tenantScope: globalScope });
    const guardrails = { schema: warnSchema, tenantScope: agencyIds("2") };

    const error = catchError(() => bindPreparedQuery(prepared, { status_name: "open" }, guardrails));
    expect(error).toBeInstanceOf(TenantGuardrailError);
    expect((error as Error).message).toContain("acceptWarnings");

    const bound = bindPreparedQuery(prepared, { status_name: "open" }, { ...guardrails, acceptWarnings: ["tenant"] });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE status = 'open'");
    expect(bound.verdict.outcome).toBe("warn");
    expect(bound.verdict.findings).toEqual([
      expect.objectContaining({ check: "tenant", form: "template", rule: "MISSING_TENANT_PREDICATE" }),
    ]);
  });

  it("refuses a template stored before the policy started scoping a table it reads", () => {
    const policy = strictSchema.tenantPolicy!;
    const before: NormalizedSchemaV2 = {
      ...strictSchema,
      tenantPolicy: { ...policy, scopedTables: policy.scopedTables.filter((t) => t.id !== "table:public.orders") },
    };
    const stored = template(unscoped);
    const bound = bindPreparedQuery(stored, { status_name: "open" }, { schema: before, tenantScope: agencyIds("2") });
    expect(bound.verdict.outcome).toBe("allow");

    const error = catchError(() =>
      bindPreparedQuery(stored, { status_name: "open" }, { schema: strictSchema, tenantScope: agencyIds("2") }),
    );
    expect(error).toBeInstanceOf(TenantGuardrailError);
  });

  it("refuses an unfiltered read of a subtree level expandTenantScope() kept empty (strict)", async () => {
    const scope = await expandTenantScope(
      strictSchema.tenantPolicy!,
      { access: { kind: "subtree", tenantRoot: agencies, rootIds: ["1"], includeDescendants: true } },
      () => ({ [agencies]: ["1"], [subAgencies]: ["5"] }),
    );
    expect(scope.access).toEqual({
      kind: "multi_root",
      scopes: [
        { tenantRoot: agencies, ids: ["1"] },
        { tenantRoot: subAgencies, ids: ["5"] },
        { tenantRoot: clients, ids: [] },
      ],
    });

    const sql = "SELECT c.id FROM clients c WHERE c.sub_agency_id IN (:tenant_sub_agency_ids) AND c.name = :status_name";
    const error = catchError(() =>
      bindPreparedQuery(template(sql), { status_name: "x" }, { schema: strictSchema, tenantScope: scope }),
    );
    expect(error).toBeInstanceOf(TenantGuardrailError);
    expect((error as TenantGuardrailError).warnings.map((w) => [w.rule, w.tableId])).toEqual([
      ["MISSING_TENANT_PREDICATE", clients],
    ]);
  });
});

describe("bindPreparedQuery — the read-only and sensitive checks", () => {
  const sensitiveV1: NormalizedSchema = {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "integer", nullable: false, primaryKey: true },
          { name: "password", type: "text", nullable: false, primaryKey: false, sensitive: true },
        ],
      },
    ],
  };
  const readsPassword = template("SELECT password FROM users WHERE id = :status_name");

  it("binds a template that reads a sensitive column by default and reports it; strict refuses it", () => {
    const bound = bindPreparedQuery(readsPassword, { status_name: "1" }, { schema: sensitiveV1 });
    expect(bound.sql).toBe("SELECT password FROM users WHERE id = '1'");
    expect(bound.verdict.outcome).toBe("warn");
    expect(bound.verdict.findings).toEqual([
      expect.objectContaining({
        check: "sensitive",
        rule: "SENSITIVE_COLUMN_REFERENCED",
        reference: expect.objectContaining({ table: "users", column: "password" }),
      }),
    ]);

    const error = catchError(() =>
      bindPreparedQuery(readsPassword, { status_name: "1" }, { schema: sensitiveV1, sensitiveGuardrailMode: "strict" }),
    );
    expect(error).toBeInstanceOf(SensitiveReferenceError);
    expect((error as SensitiveReferenceError).rule).toBe("SENSITIVE_COLUMN_REFERENCED");
  });

  it("skips the sensitive check with sensitiveGuardrailMode off", () => {
    const bound = bindPreparedQuery(readsPassword, { status_name: "1" }, { schema: sensitiveV1, sensitiveGuardrailMode: "off" });
    expect(bound.verdict).toEqual({ outcome: "allow", findings: [] });
  });

  // A mode spelled any other way (a host reading it from its own config) must not turn a
  // finding into `allow`, which the verdict documents as "no findings".
  it.each(["Strict", "STRICT", "strict "])("refuses a sensitive read under an unrecognized mode %j", (mode) => {
    const error = catchError(() =>
      bindPreparedQuery(readsPassword, { status_name: "1" }, { schema: sensitiveV1, sensitiveGuardrailMode: mode as never }),
    );
    expect(error).toBeInstanceOf(SensitiveReferenceError);
  });

  it("refuses a non-SELECT template whatever the modes", () => {
    const error = catchError(() =>
      bindPreparedQuery(template("DELETE FROM orders WHERE status = :status_name"), { status_name: "open" }, {
        schema: warnSchema,
        tenantScope: agencyIds("2"),
        sensitiveGuardrailMode: "off",
        acceptWarnings: ["tenant"],
      }),
    );
    expect(error).toBeInstanceOf(SqlValidationError);
    expect((error as SqlValidationError).rule).toBe("SQL_NOT_SELECT_OR_WITH");
    expect((error as SqlValidationError).verdict?.findings.map((f) => f.check)).toContain("read-only");
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

// ask() checks and renders under the host's spec; a rebind that fell back to the built-in
// spec would drop the host's rules (#660). So it takes the host's spec, or refuses.
describe("bindPreparedQuery — the host's DialectSpec (#660)", () => {
  const hostPostgres: DialectSpec = { ...POSTGRES_DIALECT, backslashEscapes: true };
  const shippedSql = "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'shipped'";
  const guardrails = { schema: strictSchema, tenantScope: agencyIds("4"), tenantSqlMode: "sql-only" as const };

  // Any spec object other than the exported constant carries the host's rules: an unchanged
  // spread too, and a second copy of @askdb/core (ESM beside CJS), whose constants are other objects.
  it.each<[string, DialectSpec]>([
    ["a spread that sets backslashEscapes", hostPostgres],
    ["an unchanged spread, as a second copy of @askdb/core gives", { ...POSTGRES_DIALECT }],
  ])("refuses to rebind a template ask() made under %s without that spec", async (_label, dialect) => {
    const prepared = await askForTemplate({ sql: shippedSql, unbound: scopedOrders, ...guardrails, dialect });
    expect(prepared.dialectRules).toBe("host");
    expect(() => bindPreparedQuery(prepared, { status_name: "\\' OR 1=1 --" }, guardrails)).toThrow(
      expect.objectContaining({ name: "QueryParameterError", reason: "DIALECT_SPEC_REQUIRED" }),
    );
  });

  // The exported constant is the built-in spec itself, so its templates rebind without `dialect`.
  it("rebinds a template ask() made under the exported constant without the spec", async () => {
    const prepared = await askForTemplate({ sql: shippedSql, unbound: scopedOrders, ...guardrails, dialect: POSTGRES_DIALECT });
    expect(prepared.dialectRules).toBe("builtin");
    expect(bindPreparedQuery(prepared, { status_name: "open" }, guardrails).sql).toBe(
      "SELECT count(*) FROM orders WHERE agency_id = '4' AND status = 'open'",
    );
  });

  // #660's repro: under the built-in Postgres rules `\' OR 1=1 --` rendered as
  // `'\'' OR 1=1 --'`, which a backslash-escaping server ends early and runs the OR.
  it("renders a business value under the spec the host passes, so its own check accepts the SQL", async () => {
    const prepared = await askForTemplate({ sql: shippedSql, unbound: scopedOrders, ...guardrails, dialect: hostPostgres });
    const bound = bindPreparedQuery(prepared, { status_name: "\\' OR 1=1 --" }, { ...guardrails, dialect: hostPostgres });

    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = '4' AND status = '\\\\'' OR 1=1 --'");
    expect(() => validateSelectSql(hostPostgres, bound.sql)).not.toThrow();
  });

  // #660's second repro: the host blocks my_udf, but a template stored under the built-in
  // MySQL rules called it and rebound with verdict allow.
  it("refuses a function the host's spec blocks, in a template made under the built-in rules", async () => {
    const prepared = await askForTemplate({
      sql: "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND my_udf(status) = 'shipped'",
      unbound: "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND my_udf(status) = :status_name",
      ...guardrails,
      dialect: "mysql",
    });
    expect(prepared.dialectRules).toBe("builtin");
    const hostMysql: DialectSpec = { ...MYSQL_DIALECT, blockedFunctions: [...(MYSQL_DIALECT.blockedFunctions ?? []), "my_udf"] };

    expect(() => bindPreparedQuery(prepared, { status_name: "open" }, { ...guardrails, dialect: hostMysql })).toThrow(
      expect.objectContaining({ name: "SqlValidationError", message: expect.stringContaining("my_udf") }),
    );
  });

  it("refuses a spec whose id isn't the template's dialect", () => {
    expect(() =>
      bindPreparedQuery(template(scopedOrders), { status_name: "open" }, { ...guardrails, dialect: MYSQL_DIALECT }),
    ).toThrow(expect.objectContaining({ name: "QueryParameterError", reason: "DIALECT_UNSUPPORTED" }));
  });

  // A template stored before AskDB recorded dialectRules may have been made under a host's
  // spec; the rebind can't tell, so it asks rather than guess (ADR 0032).
  it("refuses a template stored without dialectRules until the host names its rules; a built-in id is enough", () => {
    const { dialectRules: _rules, ...stored } = template(scopedOrders);
    expect(() => bindPreparedQuery(stored, { status_name: "open" }, guardrails)).toThrow(
      expect.objectContaining({
        name: "QueryParameterError",
        reason: "DIALECT_SPEC_REQUIRED",
        message: expect.stringContaining("'postgres'"),
      }),
    );
    expect(bindPreparedQuery(stored, { status_name: "open" }, { ...guardrails, dialect: "postgres" }).sql).toBe(
      "SELECT count(*) FROM orders WHERE agency_id = '4' AND status = 'open'",
    );
  });

  // A value that is neither label, such as a typo in a template loaded from JSON, is refused
  // too, and the message names it rather than say the field is missing.
  it("names an unrecognised dialectRules value when it refuses the template", () => {
    const typo = { ...template(scopedOrders), dialectRules: "built-in" } as unknown as PreparedQuery;
    expect(() => bindPreparedQuery(typo, { status_name: "open" }, guardrails)).toThrow(
      expect.objectContaining({ reason: "DIALECT_SPEC_REQUIRED", message: expect.stringContaining("'built-in'") }),
    );
  });

  // ask() checks its own render against the model's SQL. Under the built-in rules, a value
  // with a backslash renders differently from the host's escaping, and ask() would drop the
  // reuse artifacts.
  it("keeps the reuse artifacts when a value renders differently under the host's spec", async () => {
    const result = await ask({
      question: "orders by status",
      schema: strictSchema,
      model: fakeModel,
      dialect: hostPostgres,
      tenantScope: agencyIds("4"),
      deps: {
        generateText: vi.fn(async () => ({
          text: reply("SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'a\\\\b'", scopedOrders, "a\\b"),
        })) as never,
      },
    });
    expect(result.preparedQuery?.dialectRules).toBe("host");
  });
});
