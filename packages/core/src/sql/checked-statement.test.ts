/**
 * The renderer `ask()` and `bindPreparedQuery()` share for a checked template (ADR 0010).
 *
 * Contract: `renderTemplate` gives both forms of a template, the business values inlined
 * with the tenant placeholders still in place, and every value a driver marker with the
 * tenant IDs folded into `params`; `renderTenantSql` gives the bound form's tenant markers
 * (numbered from the first slot, IDs in `tenantParams`) or literals, by `tenantSqlMode`.
 * The matrix runs it for every marker style (`$N`, `?`, `@pN`), both list bindings, and
 * each scope kind that renders (`ids`, `multi_root`, `global`).
 *
 * Regression it catches: one caller's rendering drifting from the other's, as #664 and
 * 035725c9 had to be copied across; a marker numbered from the wrong slot; `?` params out
 * of source order when a tenant placeholder comes first.
 *
 * Why existing coverage misses it: ask()'s and the rebind's tests reach rendering through
 * the whole pipeline, sql-params only, on a few dialects each; neither has a `global` or
 * `multi_root` row per marker style, or Postgres with `listBinding: "expand"`.
 *
 * Seam: none. `checked-statement.ts` is the module both callers render through.
 *
 * Not covered: the `TENANT_PARAM_ALIGNMENT` refusal. No template reaches it (a fuzz over
 * every pair of built-in dialects found none), so it stays a defensive check, untested
 * as before.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import type { PreparedQuery } from "./bind.js";
import { renderTemplate, renderTenantSql, tenantRendering } from "./checked-statement.js";
import { MYSQL_DIALECT, POSTGRES_DIALECT, SQLSERVER_DIALECT, type DialectSpec } from "./dialect-spec.js";

const here = dirname(fileURLToPath(import.meta.url));
const policy = loadSchema(join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema")).tenantPolicy!;

const agencies = "table:public.agencies";
const clients = "table:public.clients";

const status = { name: "status", placeholder: ":status", type: "string", cardinality: "one", source: "question" } as const;
const regions = { name: "regions", placeholder: ":regions", type: "string", cardinality: "many", source: "question" } as const;
const tenantDecl = (name: string) =>
  ({ name, placeholder: `:${name}`, type: "string", cardinality: "many", source: "tenant" }) as const;
const values = { status: "open", regions: ["east", "west"] };

function template(namedSql: string, dialect: DialectSpec): PreparedQuery {
  const tenant = [...new Set(namedSql.match(/:tenant_[a-z_]+_ids/g) ?? [])].map((p) => tenantDecl(p.slice(1)));
  return { version: 1, dialect: dialect.id as "postgres", dialectRules: "builtin", namedSql, parameters: [status, regions, ...tenant] };
}

const scopes = {
  ids: {
    scope: { access: { kind: "ids", tenantRoot: agencies, ids: ["7", "8"] } } satisfies TenantScope,
    namedSql: "SELECT id FROM orders WHERE status = :status AND agency_id = :tenant_agency_ids AND region IN (:regions)",
    businessSql: "SELECT id FROM orders WHERE status = 'open' AND agency_id = :tenant_agency_ids AND region IN ('east', 'west')",
    sqlOnly: "SELECT id FROM orders WHERE status = 'open' AND agency_id IN ('7', '8') AND region IN ('east', 'west')",
    tenantParams: ["7", "8"],
    tenantBindings: [[":tenant_agency_ids", ["7", "8"]]],
  },
  // The tenant placeholder comes first, so `?` params interleave in source order.
  multi_root: {
    scope: {
      access: { kind: "multi_root", scopes: [{ tenantRoot: agencies, ids: ["1"] }, { tenantRoot: clients, ids: ["5", "6"] }] },
    } satisfies TenantScope,
    namedSql:
      "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status AND client_id IN (:tenant_client_ids) AND region IN (:regions)",
    businessSql:
      "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'open' AND client_id IN (:tenant_client_ids) AND region IN ('east', 'west')",
    sqlOnly: "SELECT id FROM orders WHERE agency_id = '1' AND status = 'open' AND client_id IN ('5', '6') AND region IN ('east', 'west')",
    tenantParams: ["1", "5", "6"],
    tenantBindings: [
      [":tenant_agency_ids", ["1"]],
      [":tenant_client_ids", ["5", "6"]],
    ],
  },
  global: {
    scope: { access: { kind: "global", reason: "support" } } satisfies TenantScope,
    namedSql: "SELECT id FROM orders WHERE status = :status AND region IN (:regions)",
    businessSql: "SELECT id FROM orders WHERE status = 'open' AND region IN ('east', 'west')",
    sqlOnly: "SELECT id FROM orders WHERE status = 'open' AND region IN ('east', 'west')",
    tenantParams: undefined,
    tenantBindings: [],
  },
} as const;

type Row = {
  dialect: DialectSpec;
  label: string;
  scope: keyof typeof scopes;
  unboundSql: string;
  params: unknown[];
  bindings: [string, number[]][];
  /** `sql` in sql-params mode. */
  sqlParams: string;
};

const postgresExpand: DialectSpec = { ...POSTGRES_DIALECT, listBinding: "expand" };

const rows: Row[] = [
  // ids
  {
    dialect: POSTGRES_DIALECT,
    label: "postgres ($N, array)",
    scope: "ids",
    unboundSql: "SELECT id FROM orders WHERE status = $1 AND agency_id IN ($3, $4) AND region = ANY($2)",
    params: ["open", ["east", "west"], "7", "8"],
    bindings: [["status", [0]], ["regions", [1]]],
    sqlParams: "SELECT id FROM orders WHERE status = 'open' AND agency_id IN ($1, $2) AND region IN ('east', 'west')",
  },
  {
    dialect: postgresExpand,
    label: "postgres ($N, expand)",
    scope: "ids",
    unboundSql: "SELECT id FROM orders WHERE status = $1 AND agency_id IN ($4, $5) AND region IN ($2, $3)",
    params: ["open", "east", "west", "7", "8"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams: "SELECT id FROM orders WHERE status = 'open' AND agency_id IN ($1, $2) AND region IN ('east', 'west')",
  },
  {
    dialect: MYSQL_DIALECT,
    label: "mysql (?)",
    scope: "ids",
    unboundSql: "SELECT id FROM orders WHERE status = ? AND agency_id IN (?, ?) AND region IN (?, ?)",
    params: ["open", "7", "8", "east", "west"],
    bindings: [["status", [0]], ["regions", [3, 4]]],
    sqlParams: "SELECT id FROM orders WHERE status = 'open' AND agency_id IN (?, ?) AND region IN ('east', 'west')",
  },
  {
    dialect: SQLSERVER_DIALECT,
    label: "sqlserver (@pN)",
    scope: "ids",
    unboundSql: "SELECT id FROM orders WHERE status = @p0 AND agency_id IN (@p3, @p4) AND region IN (@p1, @p2)",
    params: ["open", "east", "west", "7", "8"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams: "SELECT id FROM orders WHERE status = 'open' AND agency_id IN (@p0, @p1) AND region IN ('east', 'west')",
  },
  // multi_root
  {
    dialect: POSTGRES_DIALECT,
    label: "postgres ($N, array)",
    scope: "multi_root",
    unboundSql: "SELECT id FROM orders WHERE agency_id = $3 AND status = $1 AND client_id IN ($4, $5) AND region = ANY($2)",
    params: ["open", ["east", "west"], "1", "5", "6"],
    bindings: [["status", [0]], ["regions", [1]]],
    sqlParams:
      "SELECT id FROM orders WHERE agency_id = $1 AND status = 'open' AND client_id IN ($2, $3) AND region IN ('east', 'west')",
  },
  {
    dialect: postgresExpand,
    label: "postgres ($N, expand)",
    scope: "multi_root",
    unboundSql: "SELECT id FROM orders WHERE agency_id = $4 AND status = $1 AND client_id IN ($5, $6) AND region IN ($2, $3)",
    params: ["open", "east", "west", "1", "5", "6"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams:
      "SELECT id FROM orders WHERE agency_id = $1 AND status = 'open' AND client_id IN ($2, $3) AND region IN ('east', 'west')",
  },
  {
    dialect: MYSQL_DIALECT,
    label: "mysql (?)",
    scope: "multi_root",
    unboundSql: "SELECT id FROM orders WHERE agency_id = ? AND status = ? AND client_id IN (?, ?) AND region IN (?, ?)",
    params: ["1", "open", "5", "6", "east", "west"],
    bindings: [["status", [1]], ["regions", [4, 5]]],
    sqlParams: "SELECT id FROM orders WHERE agency_id = ? AND status = 'open' AND client_id IN (?, ?) AND region IN ('east', 'west')",
  },
  {
    dialect: SQLSERVER_DIALECT,
    label: "sqlserver (@pN)",
    scope: "multi_root",
    unboundSql:
      "SELECT id FROM orders WHERE agency_id = @p3 AND status = @p0 AND client_id IN (@p4, @p5) AND region IN (@p1, @p2)",
    params: ["open", "east", "west", "1", "5", "6"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams:
      "SELECT id FROM orders WHERE agency_id = @p0 AND status = 'open' AND client_id IN (@p1, @p2) AND region IN ('east', 'west')",
  },
  // global: no tenant placeholder, so both modes leave the bound form as rendered.
  {
    dialect: POSTGRES_DIALECT,
    label: "postgres ($N, array)",
    scope: "global",
    unboundSql: "SELECT id FROM orders WHERE status = $1 AND region = ANY($2)",
    params: ["open", ["east", "west"]],
    bindings: [["status", [0]], ["regions", [1]]],
    sqlParams: scopes.global.businessSql,
  },
  {
    dialect: postgresExpand,
    label: "postgres ($N, expand)",
    scope: "global",
    unboundSql: "SELECT id FROM orders WHERE status = $1 AND region IN ($2, $3)",
    params: ["open", "east", "west"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams: scopes.global.businessSql,
  },
  {
    dialect: MYSQL_DIALECT,
    label: "mysql (?)",
    scope: "global",
    unboundSql: "SELECT id FROM orders WHERE status = ? AND region IN (?, ?)",
    params: ["open", "east", "west"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams: scopes.global.businessSql,
  },
  {
    dialect: SQLSERVER_DIALECT,
    label: "sqlserver (@pN)",
    scope: "global",
    unboundSql: "SELECT id FROM orders WHERE status = @p0 AND region IN (@p1, @p2)",
    params: ["open", "east", "west"],
    bindings: [["status", [0]], ["regions", [1, 2]]],
    sqlParams: scopes.global.businessSql,
  },
];

describe("renderTemplate and renderTenantSql", () => {
  it.each(rows)("$label, $scope scope: both forms, params and tenantParams", (row) => {
    const c = scopes[row.scope];
    const prepared = template(c.namedSql, row.dialect);

    for (const mode of ["sql-params", "sql-only"] as const) {
      const tenant = tenantRendering(policy, c.scope, mode, "test")!;
      const rendered = renderTemplate(prepared, values, row.dialect, tenant);
      // The template's forms don't depend on the mode: unboundSql always binds the tenant IDs.
      expect(rendered.businessSql).toBe(c.businessSql);
      expect(rendered.unboundSql).toBe(row.unboundSql);
      expect(rendered.params).toEqual(row.params);
      expect(rendered.bindings.map((b) => [b.name, b.indices])).toEqual(row.bindings);

      const bound = renderTenantSql(rendered.businessSql, row.dialect, tenant);
      expect(bound.sql).toBe(mode === "sql-params" ? row.sqlParams : c.sqlOnly);
      expect(bound.tenantParams).toEqual(mode === "sql-params" ? c.tenantParams : undefined);
      expect(bound.tenantBindings.map((b) => [b.placeholder, b.ids])).toEqual(c.tenantBindings);
    }
  });
});
