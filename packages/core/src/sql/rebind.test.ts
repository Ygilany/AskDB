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
  type BuiltInDialectId,
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
  return { version: 1, dialect, namedSql, parameters };
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
  dialect?: BuiltInDialectId;
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

  it("fills each root's placeholder from a multi_root scope", () => {
    const sql =
      "SELECT n.id FROM notes n WHERE n.owner_type = 'agency' AND n.owner_id = :tenant_agency_ids AND n.body = :status_name " +
      "UNION ALL SELECT n.id FROM notes n WHERE n.owner_type = 'client' AND n.owner_id = :tenant_client_ids";
    const bound = bindPreparedQuery(template(sql), { status_name: "open" }, {
      schema: strictSchema,
      tenantScope: {
        access: {
          kind: "multi_root",
          scopes: [
            { tenantRoot: agencies, ids: ["1"] },
            { tenantRoot: clients, ids: ["5", "6"] },
          ],
        },
      },
    });
    expect(bound.sql).toBe(
      "SELECT n.id FROM notes n WHERE n.owner_type = 'agency' AND n.owner_id = '1' AND n.body = 'open' " +
        "UNION ALL SELECT n.id FROM notes n WHERE n.owner_type = 'client' AND n.owner_id IN ('5', '6')",
    );
    expect(bound.params).toEqual(["open", "1", "5", "6"]);
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
    },
    {
      dialect: "mysql" as const,
      unboundSql: "SELECT count(*) FROM orders WHERE agency_id IN (?, ?) AND status = ?",
      params: ["7", "8", "open"],
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
      tenantScope: agencyIds("7", "8"),
    });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id IN ('7', '8') AND status = 'open'");
    expect(bound.unboundSql).toBe(c.unboundSql);
    expect(bound.params).toEqual(c.params);
    expect(bound.bindings.map((b) => [b.name, b.indices])).toEqual([["status_name", [c.params.indexOf("open")]]]);
  });

  // ask() used to mask :tenant_* as this token and unmask by regex; a business value equal
  // to it must never be rewritten into a placeholder.
  it("passes a business value equal to the old mask token through unchanged", () => {
    const token = "__askdb_tenant_agency_ids__";
    const bound = bindPreparedQuery(template(scopedOrders), { status_name: token }, {
      schema: strictSchema,
      tenantScope: agencyIds("2"),
    });
    expect(bound.sql).toBe(`SELECT count(*) FROM orders WHERE agency_id = '2' AND status = '${token}'`);
    expect(bound.params).toEqual([token, "2"]);
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
