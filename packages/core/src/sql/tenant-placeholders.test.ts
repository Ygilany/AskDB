import { describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModel } from "ai";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope, NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import {
  extractTenantPlaceholders,
  placeholderForRoot,
  resolvePlaceholders,
  replacePlaceholdersWithLiterals,
  replacePlaceholdersWithParams,
  resolveTenantSql,
} from "./tenant-placeholders.js";
import { ask, type AskDialect } from "../ask.js";
import { TenantScopeError } from "../errors.js";
import { getDialectSpec, type BuiltInDialectId } from "./dialect-spec.js";
import { tokenizeSqlSpans } from "./bind.js";

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof TenantScopeError) return e.reason;
    throw e;
  }
  return undefined;
}

/** Concatenated code (non-quoted) regions — what the database parses as SQL. */
function codeRegions(sql: string): string {
  return tokenizeSqlSpans(sql)
    .filter((s) => s.kind === "code")
    .map((s) => sql.slice(s.start, s.end))
    .join(" ");
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

const schema = loadSchema(multiTenantDir);
const policy = schema.tenantPolicy!;

const fakeModel = {} as LanguageModel;

describe("placeholderForRoot", () => {
  it("lowercases and replaces non-alphanumeric chars", () => {
    expect(placeholderForRoot("Agency")).toBe(":tenant_agency_ids");
    expect(placeholderForRoot("Sub-Agency")).toBe(":tenant_sub_agency_ids");
    expect(placeholderForRoot("My Cool Root")).toBe(":tenant_my_cool_root_ids");
  });
});

describe("extractTenantPlaceholders", () => {
  it("extracts all unique placeholders from SQL", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND client_id IN (:tenant_client_ids) AND agency_id = :tenant_agency_ids";
    const placeholders = extractTenantPlaceholders(sql);
    expect(placeholders).toEqual([":tenant_agency_ids", ":tenant_client_ids"]);
  });

  it("returns empty array when no placeholders", () => {
    expect(extractTenantPlaceholders("SELECT * FROM orders")).toEqual([]);
  });
});

describe("resolvePlaceholders", () => {
  it("resolves ids scope to placeholder values", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
    };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const resolved = resolvePlaceholders(sql, policy, scope);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.placeholder).toBe(":tenant_agency_ids");
    expect(resolved[0]!.ids).toEqual(["42", "99"]);
    expect(resolved[0]!.rootId).toBe("table:public.agencies");
  });

  it("rejects subtree scope instead of binding only the root IDs", () => {
    const scope: TenantScope = {
      access: { kind: "subtree", tenantRoot: "table:public.agencies", rootIds: ["42"], includeDescendants: true },
    };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(() => resolvePlaceholders(sql, policy, scope)).toThrow(TenantScopeError);
    expect(reasonOf(() => resolveTenantSql(sql, policy, scope, "sql-params"))).toBe(
      "UNSUPPORTED_ACCESS_KIND",
    );
  });

  it("resolves multi_root scope with multiple placeholders", () => {
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["42"] },
          { tenantRoot: "table:public.clients", ids: ["99", "100"] },
        ],
      },
    };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND client_id IN (:tenant_client_ids)";
    const resolved = resolvePlaceholders(sql, policy, scope);
    expect(resolved).toHaveLength(2);
    const agencyBinding = resolved.find((r) => r.placeholder === ":tenant_agency_ids");
    const clientBinding = resolved.find((r) => r.placeholder === ":tenant_client_ids");
    expect(agencyBinding!.ids).toEqual(["42"]);
    expect(clientBinding!.ids).toEqual(["99", "100"]);
  });

  it("returns empty for global scope", () => {
    const scope: TenantScope = { access: { kind: "global", reason: "admin" } };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const resolved = resolvePlaceholders(sql, policy, scope);
    expect(resolved[0]!.ids).toEqual([]);
  });
});

describe("replacePlaceholdersWithLiterals", () => {
  it("keeps quote-doubling-only behavior when no dialect is supplied", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["acme\\"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(replacePlaceholdersWithLiterals(sql, resolved)).toBe(
      "SELECT * FROM orders WHERE agency_id = 'acme\\'",
    );
  });

  it("handles multiple different placeholders", () => {
    const resolved = [
      { placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42"] },
      { placeholder: ":tenant_client_ids", rootLabel: "Client", rootId: "r2", ids: ["99", "100"] },
    ];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND client_id = :tenant_client_ids";
    expect(replacePlaceholdersWithLiterals(sql, resolved)).toBe(
      "SELECT * FROM orders WHERE agency_id = '42' AND client_id IN ('99', '100')",
    );
  });
});

describe("resolveTenantSql — sql-only mode", () => {
  const agencyScope: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
  };

  it("inlines literal values", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = resolveTenantSql(sql, policy, agencyScope, "sql-only");
    expect(result.mode).toBe("sql-only");
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = '42'");
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]!.rootLabel).toBe("Agency");
  });

  it("passes through SQL unchanged for global scope", () => {
    const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };
    const sql = "SELECT * FROM orders";
    const result = resolveTenantSql(sql, policy, globalScope, "sql-only");
    expect(result.sql).toBe(sql);
    expect(result.bindings).toEqual([]);
  });

  it("handles SQL with no placeholders", () => {
    const sql = "SELECT * FROM lookup_states";
    const result = resolveTenantSql(sql, policy, agencyScope, "sql-only");
    expect(result.sql).toBe(sql);
    expect(result.bindings).toEqual([]);
  });
});

describe("resolveTenantSql — sql-params mode", () => {
  it("passes through for global scope with empty params", () => {
    const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };
    const sql = "SELECT * FROM orders";
    const result = resolveTenantSql(sql, policy, globalScope, "sql-params");
    expect(result.mode).toBe("sql-params");
    if (result.mode === "sql-params") {
      expect(result.params).toEqual([]);
    }
  });
});

describe("ask() — tenant SQL output modes", () => {
  const agencyScope: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
  };

  it("defaults to sql-only mode with inlined literals", async () => {
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };

    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencyScope,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = '42'");
    expect(result.tenantBindings).toHaveLength(1);
    expect(result.tenantBindings![0]!.ids).toEqual(["42"]);
    expect(result.tenantParams).toBeUndefined();
  });

  it("returns positional params in sql-params mode", async () => {
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };

    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencyScope,
      tenantSqlMode: "sql-params",
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = $1");
    expect(result.tenantParams).toEqual(["42"]);
    expect(result.tenantBindings).toHaveLength(1);
  });

  it("handles multi-value scope in sql-only mode", async () => {
    const multiScope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
    };
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };

    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: multiScope,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id IN ('42', '99')");
  });

  it("handles multi-value scope in sql-params mode", async () => {
    const multiScope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
    };
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };

    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: multiScope,
      tenantSqlMode: "sql-params",
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id IN ($1, $2)");
    expect(result.tenantParams).toEqual(["42", "99"]);
  });

  it("leaves SQL unchanged when no tenant policy exists", async () => {
    const nonTenantSchema = loadSchema(join(fixturesDir, "orders-users.schema"));
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM users",
      }),
    };

    const result = await ask({
      question: "count users",
      schema: nonTenantSchema,
      model: fakeModel,
      dialect,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM users");
    expect(result.tenantParams).toBeUndefined();
    expect(result.tenantBindings).toBeUndefined();
  });

  it("passes through unmodified for global scope", async () => {
    const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders",
      }),
    };

    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: globalScope,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders");
    expect(result.tenantBindings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Binding correctness: dialect markers, fail-closed, operators, literals
// ---------------------------------------------------------------------------

const agencyOne: TenantScope = {
  access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
};
const agencyTwo: TenantScope = {
  access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
};

describe("resolveTenantSql — dialect marker styles (sql-params)", () => {
  const cases: Array<{
    dialect: BuiltInDialectId;
    single: string;
    multi: string;
    offset: string;
  }> = [
    { dialect: "postgres", single: "= $1", multi: "IN ($1, $2)", offset: "IN ($4, $5)" },
    { dialect: "cockroachdb", single: "= $1", multi: "IN ($1, $2)", offset: "IN ($4, $5)" },
    { dialect: "mysql", single: "= ?", multi: "IN (?, ?)", offset: "IN (?, ?)" },
    { dialect: "mariadb", single: "= ?", multi: "IN (?, ?)", offset: "IN (?, ?)" },
    { dialect: "sqlite", single: "= ?", multi: "IN (?, ?)", offset: "IN (?, ?)" },
    { dialect: "sqlserver", single: "= @p0", multi: "IN (@p0, @p1)", offset: "IN (@p3, @p4)" },
  ];
  const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";

  it.each(cases)("$dialect: single ID uses the dialect marker", ({ dialect, single }) => {
    const r = resolveTenantSql(sql, policy, agencyOne, "sql-params", 1, getDialectSpec(dialect));
    expect(r.sql).toBe(`SELECT * FROM orders WHERE agency_id ${single}`);
    expect(r.mode === "sql-params" && r.params).toEqual(["42"]);
  });

  it.each(cases)("$dialect: several IDs expand to IN with one marker each", ({ dialect, multi }) => {
    const r = resolveTenantSql(sql, policy, agencyTwo, "sql-params", 1, getDialectSpec(dialect));
    expect(r.sql).toBe(`SELECT * FROM orders WHERE agency_id ${multi}`);
    expect(r.mode === "sql-params" && r.params).toEqual(["42", "99"]);
  });

  it.each(cases)("$dialect: paramStartIndex offsets numbered markers", ({ dialect, offset }) => {
    const r = resolveTenantSql(sql, policy, agencyTwo, "sql-params", 4, getDialectSpec(dialect));
    expect(r.sql).toBe(`SELECT * FROM orders WHERE agency_id ${offset}`);
  });

  it("defaults to $N when no dialect id is supplied (custom AskDialect path)", () => {
    const r = resolveTenantSql(sql, policy, agencyOne, "sql-params", 1, { backslashEscapes: true });
    expect(r.sql).toBe("SELECT * FROM orders WHERE agency_id = $1");
  });
});

describe("replacePlaceholdersWithParams — ? marker ordering", () => {
  const multi = [
    { placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "a", ids: ["a1", "a2"] },
    { placeholder: ":tenant_client_ids", rootLabel: "Client", rootId: "c", ids: ["c1", "c2", "c3"] },
  ];

  it("? style: params follow the markers left to right", () => {
    const sql =
      "SELECT * FROM t WHERE client_id IN (:tenant_client_ids) AND agency_id = :tenant_agency_ids";
    const r = replacePlaceholdersWithParams(sql, multi, 1, getDialectSpec("mysql"));
    expect(r.sql).toBe("SELECT * FROM t WHERE client_id IN (?, ?, ?) AND agency_id IN (?, ?)");
    expect(r.params).toEqual(["c1", "c2", "c3", "a1", "a2"]);
  });

  it("? style: a placeholder used twice gets its values twice", () => {
    const sql =
      "SELECT * FROM t WHERE agency_id = :tenant_agency_ids OR parent_id IN (:tenant_agency_ids)";
    const r = replacePlaceholdersWithParams(sql, multi, 1, getDialectSpec("sqlite"));
    expect(r.sql).toBe("SELECT * FROM t WHERE agency_id IN (?, ?) OR parent_id IN (?, ?)");
    expect(r.params).toEqual(["a1", "a2", "a1", "a2"]);
    expect(r.sql.match(/\?/g)).toHaveLength(r.params.length);
  });
});

describe("resolveTenantSql — fails closed on unresolved placeholders", () => {
  it.each(["sql-only", "sql-params"] as const)(
    "%s: a placeholder for a root the scope does not cover throws",
    (mode) => {
      const sql =
        "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND client_id IN (:tenant_client_ids)";
      expect(reasonOf(() => resolveTenantSql(sql, policy, agencyOne, mode))).toBe(
        "UNRESOLVED_TENANT_PLACEHOLDER",
      );
    },
  );

  it.each(["sql-only", "sql-params"] as const)(
    "%s: a tenant-shaped placeholder matching no root throws",
    (mode) => {
      const sql = "SELECT * FROM orders WHERE agency_id = :tenant_bogus_ids";
      expect(reasonOf(() => resolveTenantSql(sql, policy, agencyOne, mode))).toBe(
        "UNRESOLVED_TENANT_PLACEHOLDER",
      );
    },
  );

  it("an empty ID list for a referenced root throws in the low-level replacers", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: [] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(reasonOf(() => replacePlaceholdersWithLiterals(sql, resolved))).toBe(
      "UNRESOLVED_TENANT_PLACEHOLDER",
    );
    expect(reasonOf(() => replacePlaceholdersWithParams(sql, resolved))).toBe(
      "UNRESOLVED_TENANT_PLACEHOLDER",
    );
  });

  it("global scope is unaffected: SQL returned unchanged, no throw", () => {
    const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };
    const sql = "SELECT * FROM orders WHERE client_id IN (:tenant_client_ids)";
    expect(resolveTenantSql(sql, policy, globalScope, "sql-only").sql).toBe(sql);
    expect(resolveTenantSql(sql, policy, globalScope, "sql-params").sql).toBe(sql);
  });
});

describe("resolveTenantSql — operator-aware list rewriting", () => {
  const base = "SELECT * FROM orders WHERE agency_id";
  const table: Array<{ name: string; predicate: string; literals?: string; reason?: string }> = [
    { name: "=", predicate: "= :tenant_agency_ids", literals: "IN ('42', '99')" },
    { name: "== (SQLite)", predicate: "== :tenant_agency_ids", literals: "IN ('42', '99')" },
    { name: "!=", predicate: "!= :tenant_agency_ids", literals: "NOT IN ('42', '99')" },
    { name: "<>", predicate: "<> :tenant_agency_ids", literals: "NOT IN ('42', '99')" },
    { name: "IN (…)", predicate: "IN (:tenant_agency_ids)", literals: "IN ('42', '99')" },
    { name: "NOT IN (…)", predicate: "NOT IN ( :tenant_agency_ids )", literals: "NOT IN ( '42', '99' )" },
    { name: "= ANY(…)", predicate: "= ANY(:tenant_agency_ids)", literals: "IN ('42', '99')" },
    { name: "<> ALL(…)", predicate: "<> ALL (:tenant_agency_ids)", literals: "NOT IN ('42', '99')" },
    { name: "<=", predicate: "<= :tenant_agency_ids", reason: "UNSUPPORTED_TENANT_PREDICATE" },
    { name: ">=", predicate: ">= :tenant_agency_ids", reason: "UNSUPPORTED_TENANT_PREDICATE" },
    { name: "<", predicate: "< :tenant_agency_ids", reason: "UNSUPPORTED_TENANT_PREDICATE" },
    { name: ">", predicate: "> :tenant_agency_ids", reason: "UNSUPPORTED_TENANT_PREDICATE" },
    { name: "<= ANY(…)", predicate: "<= ANY(:tenant_agency_ids)", reason: "UNSUPPORTED_TENANT_PREDICATE" },
    { name: "= ALL(…)", predicate: "= ALL(:tenant_agency_ids)", reason: "UNSUPPORTED_TENANT_PREDICATE" },
    { name: "function argument", predicate: "= MIN(:tenant_agency_ids)", reason: "UNSUPPORTED_TENANT_PREDICATE" },
  ];

  it.each(table)("several IDs with $name", ({ predicate, literals, reason }) => {
    const sql = `${base} ${predicate}`;
    for (const mode of ["sql-only", "sql-params"] as const) {
      if (reason) {
        expect(reasonOf(() => resolveTenantSql(sql, policy, agencyTwo, mode))).toBe(reason);
        continue;
      }
      const out = resolveTenantSql(sql, policy, agencyTwo, mode).sql;
      if (mode === "sql-only") expect(out).toBe(`${base} ${literals}`);
      expect(out).not.toMatch(/[!<>=]\s*IN\b/);
      expect(out).not.toContain(":tenant_");
    }
  });

  it("= with no surrounding spaces still yields a separated IN", () => {
    const out = resolveTenantSql(
      "SELECT * FROM orders WHERE agency_id=:tenant_agency_ids",
      policy,
      agencyTwo,
      "sql-only",
    );
    expect(out.sql).toBe("SELECT * FROM orders WHERE agency_id IN ('42', '99')");
  });

  it.each(["=", "!=", "<>", "<=", ">=", "<", ">"])(
    "one ID keeps operator %s and replaces only the placeholder",
    (op) => {
      const out = resolveTenantSql(`${base} ${op} :tenant_agency_ids`, policy, agencyOne, "sql-only");
      expect(out.sql).toBe(`${base} ${op} '42'`);
    },
  );

  it("one ID with = ANY(…) becomes IN (…) — ANY needs an array, not a scalar marker", () => {
    const out = resolveTenantSql(`${base} = ANY(:tenant_agency_ids)`, policy, agencyOne, "sql-params");
    expect(out.sql).toBe(`${base} IN ($1)`);
  });
});

describe("resolveTenantSql — only code regions are substituted", () => {
  it.each(["sql-only", "sql-params"] as const)(
    "%s: placeholder text inside string literals and quoted identifiers is untouched",
    (mode) => {
      const sql =
        'SELECT ":tenant_agency_ids" FROM orders WHERE agency_id = :tenant_agency_ids ' +
        "AND note <> ':tenant_agency_ids' AND memo = $q$:tenant_agency_ids$q$";
      const out = resolveTenantSql(sql, policy, agencyOne, mode);
      expect(out.sql).toContain('":tenant_agency_ids"');
      expect(out.sql).toContain("note <> ':tenant_agency_ids'");
      expect(out.sql).toContain("$q$:tenant_agency_ids$q$");
      expect(out.sql).toContain(mode === "sql-only" ? "agency_id = '42'" : "agency_id = $1");
      if (out.mode === "sql-params") expect(out.params).toEqual(["42"]);
    },
  );

  it("a crafted tenant ID cannot break out of its literal", () => {
    const hostile: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["x') OR 1=1 --"] },
    };
    const sql =
      "SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) AND note = 'see :tenant_agency_ids'";
    const out = resolveTenantSql(sql, policy, hostile, "sql-only", 1, getDialectSpec("postgres"));
    expect(out.sql).toBe(
      "SELECT * FROM orders WHERE agency_id IN ('x'') OR 1=1 --') AND note = 'see :tenant_agency_ids'",
    );
    // The injected text only ever appears inside a quoted region.
    expect(codeRegions(out.sql)).not.toMatch(/OR\s+1=1/);
    expect(codeRegions(out.sql)).toMatch(/AND note =/);
  });

  it("a crafted tenant ID with a backslash stays inside its literal on MySQL", () => {
    const hostile: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["x\\' OR 1=1 -- "] },
    };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const out = resolveTenantSql(sql, policy, hostile, "sql-only", 1, getDialectSpec("mysql"));
    expect(out.sql).toBe("SELECT * FROM orders WHERE agency_id = 'x\\\\'' OR 1=1 -- '");
  });

  it.each(["sql-only", "sql-params"] as const)(
    "%s on MySQL: a placeholder inside a backslash-escaped string literal is untouched",
    (mode) => {
      // MySQL reads 'it\'s :tenant_agency_ids' as ONE string literal. The generic lexer
      // (no backslash escapes) would end the literal at \' and substitute inside it.
      const sql =
        "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND note = 'it\\'s :tenant_agency_ids'";
      const out = resolveTenantSql(sql, policy, agencyOne, mode, 1, getDialectSpec("mysql"));
      expect(out.sql).toBe(
        mode === "sql-only"
          ? "SELECT * FROM orders WHERE agency_id = '42' AND note = 'it\\'s :tenant_agency_ids'"
          : "SELECT * FROM orders WHERE agency_id = ? AND note = 'it\\'s :tenant_agency_ids'",
      );
      if (out.mode === "sql-params") expect(out.params).toEqual(["42"]);
    },
  );

  it("placeholders inside comments are not substituted, including MySQL # comments", () => {
    const pgSql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids -- :tenant_agency_ids\n";
    const pgOut = resolveTenantSql(pgSql, policy, agencyOne, "sql-params", 1, getDialectSpec("postgres"));
    expect(pgOut.sql).toBe("SELECT * FROM orders WHERE agency_id = $1 -- :tenant_agency_ids\n");

    const mysqlSql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids # :tenant_agency_ids\n";
    const mysqlOut = resolveTenantSql(mysqlSql, policy, agencyOne, "sql-params", 1, getDialectSpec("mysql"));
    expect(mysqlOut.sql).toBe("SELECT * FROM orders WHERE agency_id = ? # :tenant_agency_ids\n");
    if (mysqlOut.mode === "sql-params") expect(mysqlOut.params).toEqual(["42"]);
  });
});
