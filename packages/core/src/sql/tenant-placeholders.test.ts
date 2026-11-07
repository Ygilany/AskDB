import { describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModel } from "ai";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope, NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import {
  extractTenantPlaceholders,
  resolveTenantSql,
  type TenantSqlDialect,
} from "./tenant-placeholders.js";
import { ask, type AskDialect } from "../ask.js";
import { SchemaParseError, TenantScopeError, UnknownDialectError } from "../errors.js";
import { getDialectSpec, type BuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import { tokenizeSqlSpans } from "./bind.js";
import { placeholderForTenantRoot as publicPlaceholderForTenantRoot } from "../index.js";

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

describe("resolveTenantSql — sql-only mode", () => {
  const agencyScope: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
  };

  it("inlines literal values", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = resolveTenantSql(sql, policy, agencyScope, "sql-only");
    expect(result.mode).toBe("sql-only");
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = '42'");
    expect(result.bindings).toEqual([
      { placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "table:public.agencies", ids: ["42"] },
    ]);
  });

  it("handles SQL with no placeholders", () => {
    const sql = "SELECT * FROM lookup_states";
    const result = resolveTenantSql(sql, policy, agencyScope, "sql-only");
    expect(result.sql).toBe(sql);
    expect(result.bindings).toEqual([]);
  });
});

describe("ask() — tenant SQL output modes", () => {
  const agencyScope: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
  };

  it("inlines escaped literals in sql-only mode", async () => {
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
      tenantSqlMode: "sql-only",
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = '42'");
    expect(result.tenantBindings).toHaveLength(1);
    expect(result.tenantBindings![0]!.ids).toEqual(["42"]);
    expect(result.tenantParams).toBeUndefined();
  });

  // The one owner of the default (#231): without tenantSqlMode, tenant IDs leave the
  // SQL text, and `sql` runs with `tenantParams`.
  it("defaults to sql-params: sql has driver markers and runs with tenantParams", async () => {
    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      deps: {
        generateText: (async () => ({
          text: "```sql\nSELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids\n```",
        })) as never,
      },
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = $1");
    expect(result.tenantParams).toEqual(["42"]);
    expect(result.tenantBindings).toHaveLength(1);
  });

  // AskDB can't know which markers a custom AskDialect's driver takes, and the `$N` it
  // would default to is a money constant on SQL Server: `agency_id = $1` runs and returns
  // agency 1's rows. So the host must choose the mode, and ask() refuses before the model call.
  it("refuses a custom AskDialect with a tenant scope and no tenantSqlMode, before calling it", async () => {
    const generate = vi.fn(async () => ({
      sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
    }));

    const error = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect: { generate },
      tenantScope: agencyScope,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("TENANT_SQL_MODE_REQUIRED");
    expect(generate).not.toHaveBeenCalled();
    // Choosing a mode is all it takes: an explicit sql-params keeps `$N`.
    const chosen = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect: { generate },
      tenantScope: agencyScope,
      tenantSqlMode: "sql-params",
    });
    expect(chosen.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = $1");
  });

  // A DialectSpec must keep a built-in id (ADR 0029, #717), so a spec spread from SQL Server under
  // another id is refused as an unknown dialect, before the tenant mode check and the model call.
  // A spread that keeps the id keeps that engine's markers (ADR 0024).
  it("refuses a DialectSpec whose id isn't built in, and keeps the default under a built-in id", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids\n```",
    }));
    const sqlServer = getDialectSpec("sqlserver");
    const run = (dialect: DialectSpec) =>
      ask({ question: "count orders", schema, model: fakeModel, dialect, tenantScope: agencyScope, deps: { generateText: generateText as never } });

    // "constructor" is an Object.prototype key, not a built-in id.
    for (const id of ["mssql", "constructor"]) {
      const error = await run({ ...sqlServer, id } as unknown as DialectSpec).catch((e: unknown) => e);
      expect(error, id).toBeInstanceOf(UnknownDialectError);
      expect((error as UnknownDialectError).dialectId, id).toBe(id);
    }
    expect(generateText).not.toHaveBeenCalled();
    // A spread that keeps the built-in id is still that engine, with its own markers.
    const spread = await run({ ...sqlServer, blockedFunctions: [...(sqlServer.blockedFunctions ?? []), "my_udf"] });
    expect(spread.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = @p0");
  });

  // A mode ask() doesn't recognise is no choice: rendered as sql-params, it would give a
  // custom AskDialect `$N` (agency 1's rows on SQL Server). So it fails closed, on every dialect.
  it.each(["sql_only", ""])("refuses the unrecognised tenantSqlMode %j before calling the model", async (mode) => {
    const sql = "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids";
    const generate = vi.fn(async () => ({ sql }));
    const generateText = vi.fn(async () => ({ text: `\`\`\`sql\n${sql}\n\`\`\`` }));

    for (const dialect of [{ generate }, "postgres"] as const) {
      const error = await ask({
        question: "count orders",
        schema,
        model: fakeModel,
        dialect,
        tenantScope: agencyScope,
        tenantSqlMode: mode as never,
        deps: { generateText: generateText as never },
      }).catch((e: unknown) => e);

      expect(error, typeof dialect).toBeInstanceOf(TenantScopeError);
      expect((error as TenantScopeError).reason).toBe("TENANT_SQL_MODE_REQUIRED");
    }
    expect(generate).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  // resolveTenantSql() is public too, for a host that renders SQL itself; ask() always
  // passes a mode, so its own default needs its own owner.
  it("resolveTenantSql() also defaults to sql-params", () => {
    const out = resolveTenantSql("SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids", policy, agencyScope);
    expect(out.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id = $1");
    expect(out.mode === "sql-params" && out.params).toEqual(["42"]);
  });

  it("resolveTenantSql() refuses a mode it doesn't recognise", () => {
    const sql = "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(reasonOf(() => resolveTenantSql(sql, policy, agencyScope, "inline" as never))).toBe("TENANT_SQL_MODE_REQUIRED");
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
      tenantSqlMode: "sql-only",
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders");
    expect(result.tenantBindings).toBeUndefined();
  });

  // Before ADR 0010, ask() returned the raw placeholder with tenantGuardrail.passed: true.
  // The other placeholder forms are resolveTenantSql()'s to prove (below).
  it.each([":tenant_agency_ids", ":TENANT_AGENCY_IDS"])(
    "throws UNRESOLVED_TENANT_PLACEHOLDER for a global-scope reply that still has %s",
    async (placeholder) => {
      const error = await ask({
        question: "count orders",
        schema,
        model: fakeModel,
        dialect: { generate: async () => ({ sql: `SELECT COUNT(*) FROM orders WHERE agency_id = ${placeholder}` }) },
        tenantScope: { access: { kind: "global", reason: "admin" } },
        tenantSqlMode: "sql-only",
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TenantScopeError);
      expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
    },
  );
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

describe("resolveTenantSql — ? marker ordering (sql-params)", () => {
  const multi: TenantScope = {
    access: {
      kind: "multi_root",
      scopes: [
        { tenantRoot: "table:public.agencies", ids: ["a1", "a2"] },
        { tenantRoot: "table:public.clients", ids: ["c1", "c2", "c3"] },
      ],
    },
  };

  it("? style: params follow the markers left to right", () => {
    const sql =
      "SELECT * FROM t WHERE client_id IN (:tenant_client_ids) AND agency_id = :tenant_agency_ids";
    const r = resolveTenantSql(sql, policy, multi, "sql-params", 1, getDialectSpec("mysql"));
    expect(r.sql).toBe("SELECT * FROM t WHERE client_id IN (?, ?, ?) AND agency_id IN (?, ?)");
    expect(r.mode === "sql-params" && r.params).toEqual(["c1", "c2", "c3", "a1", "a2"]);
  });

  it("? style: a placeholder used twice gets its values twice", () => {
    const sql =
      "SELECT * FROM t WHERE agency_id = :tenant_agency_ids OR parent_id IN (:tenant_agency_ids)";
    const r = resolveTenantSql(sql, policy, multi, "sql-params", 1, getDialectSpec("sqlite"));
    expect(r.sql).toBe("SELECT * FROM t WHERE agency_id IN (?, ?) OR parent_id IN (?, ?)");
    const params = r.mode === "sql-params" ? r.params : [];
    expect(params).toEqual(["a1", "a2", "a1", "a2"]);
    expect(r.sql.match(/\?/g)).toHaveLength(params.length);
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

  it.each(["sql-only", "sql-params"] as const)(
    "%s: a placeholder in non-lowercase form throws instead of passing through unsubstituted",
    (mode) => {
      const sql = "SELECT * FROM orders WHERE owner_ref IN (:TENANT_AGENCY_IDS)";
      expect(reasonOf(() => resolveTenantSql(sql, policy, agencyOne, mode))).toBe(
        "UNRESOLVED_TENANT_PLACEHOLDER",
      );
    },
  );

  it("reads case-variant placeholders with the dialect's lexing, so MySQL string text is not rejected", () => {
    // Under MySQL, `'a\\' :TENANT_AGENCY_IDS'` is one string literal (backslash escapes the quote),
    // so the uppercase text inside it is data, not an unsubstituted placeholder.
    const sql =
      "SELECT * FROM orders WHERE note = 'a\\' :TENANT_AGENCY_IDS' AND owner_ref IN (:tenant_agency_ids)";
    const out = resolveTenantSql(sql, policy, agencyOne, "sql-only", 1, getDialectSpec("mysql"));
    expect(out.sql).toContain("'a\\' :TENANT_AGENCY_IDS'");
    expect(out.sql).not.toContain(":tenant_agency_ids");
  });

  // ask() expands a subtree via resolveTenantDescendants before substitution;
  // this layer never walks the hierarchy, so binding the seeds would drop descendants.
  it("an unexpanded subtree scope throws instead of binding the seed IDs only", () => {
    const subtree: TenantScope = {
      access: { kind: "subtree", tenantRoot: "table:public.agencies", rootIds: ["42"], includeDescendants: true },
    };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(() => resolveTenantSql(sql, policy, subtree)).toThrow(
      expect.objectContaining({
        reason: "SUBTREE_NOT_RESOLVABLE",
        message: expect.stringContaining("resolveTenantDescendants"),
      }),
    );
  });

  // The scanner reads an identifier glued to a placeholder as part of its name, so
  // `:tenant_agency_idsOR` is no tenant placeholder anyone can render: it must throw, not
  // come back raw.
  it.each([":tenant_agency_idsOR 1=1", ":tenant_agency_ids$x", ":tenant_agency_idsé", ":Tenant_agency_idsOR"])(
    "a glued tenant placeholder (%s) throws UNRESOLVED_TENANT_PLACEHOLDER under an ids scope",
    (tail) => {
      const sql = `SELECT * FROM orders WHERE agency_id = ${tail}`;
      const ids: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };
      expect(reasonOf(() => resolveTenantSql(sql, policy, ids, "sql-only"))).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
      expect(reasonOf(() => resolveTenantSql(sql, policy, ids, "sql-params"))).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
    },
  );

  // ADR 0010: a global scope binds no IDs, so a placeholder left in the SQL can never be
  // filled. Returning it raw (as before) handed the host unexecutable SQL marked passed.
  it.each([
    { name: "lowercase", sql: "SELECT * FROM orders WHERE client_id IN (:tenant_client_ids)" },
    { name: "upper-case", sql: "SELECT * FROM orders WHERE agency_id = :TENANT_AGENCY_IDS" },
    { name: "keyword-glued", sql: "SELECT * FROM orders WHERE agency_id = :tenant_agency_idsOR 1=1" },
  ])("global scope with a $name tenant placeholder throws UNRESOLVED_TENANT_PLACEHOLDER", ({ sql }) => {
    const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };
    expect(reasonOf(() => resolveTenantSql(sql, policy, globalScope, "sql-only"))).toBe(
      "UNRESOLVED_TENANT_PLACEHOLDER",
    );
    expect(reasonOf(() => resolveTenantSql(sql, policy, globalScope, "sql-params"))).toBe(
      "UNRESOLVED_TENANT_PLACEHOLDER",
    );
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

  // Inlined, a tenant ID must read the same whatever the server's string settings and
  // connection charset (ADR 0024). A backslash ends the literal early on a server that reads
  // strings differently from the dialect (#371: on Postgres with standard_conforming_strings
  // = off, `'x\'' OR 1=1 -- '` returned every row), and with no dialect (a custom
  // AskDialect, #360) the reading is unknown. A non-ASCII character's bytes depend on the
  // connection charset: `¥` goes out as 0x5C, a backslash, under sjis, cp932 or ujis. So
  // sql-only inlines only printable ASCII without a backslash, on every dialect, and
  // sql-params carries any other ID as a driver parameter.
  describe("a tenant ID that can't be inlined safely", () => {
    const ids = (id: string): TenantScope => ({
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: [id] },
    });
    // The edges just outside U+0020 to U+007E are refused too: a newline, NUL, U+001F and DEL.
    const refused = ["x\\' OR 1=1 -- ", "2\u00a5' OR 1=1 -- ", "東京", "a\nb", "a\u0000b", "a\u001fb", "a\u007fb"];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";

    it.each<[string, TenantSqlDialect | undefined]>([
      ["no dialect (a custom AskDialect)", undefined],
      ["the Postgres spec", getDialectSpec("postgres")],
      ["Postgres with backslashEscapes: true (standard_conforming_strings = off)", { id: "postgres", backslashEscapes: true }],
      ["the MySQL spec", getDialectSpec("mysql")],
      ["{ id: 'mariadb' }", { id: "mariadb" }],
      ["MySQL with backslashEscapes: false (NO_BACKSLASH_ESCAPES)", { id: "mysql", backslashEscapes: false }],
      ["an id whose escaping is unknown", { id: "oracle" } as unknown as TenantSqlDialect],
    ])("is refused in sql-only mode and bound as a parameter in sql-params mode, given %s", (_label, dialect) => {
      for (const id of refused) {
        expect(reasonOf(() => resolveTenantSql(sql, policy, ids(id), "sql-only", 1, dialect)), id).toBe(
          "UNESCAPABLE_TENANT_ID",
        );
        const params = resolveTenantSql(sql, policy, ids(id), "sql-params", 1, dialect);
        expect(params.mode === "sql-params" && params.params, id).toEqual([id]);
      }
      // Printable ASCII is still inlined, from the space to the tilde, with quotes doubled.
      expect(resolveTenantSql(sql, policy, ids("it's ~ok"), "sql-only", 1, dialect).sql).toBe(
        "SELECT * FROM orders WHERE agency_id = 'it''s ~ok'",
      );
    });
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

// The placeholder each root binds through is derived from its label (#375 review).
describe("resolveTenantSql — placeholders derived per root", () => {
  const agencies = "table:public.agencies";
  const subAgencies = "table:public.sub_agencies";
  const clients = "table:public.clients";
  const relabel = (labels: Record<string, string>): NormalizedTenantPolicy => ({
    ...policy,
    roots: policy.roots.map((root) => (labels[root.id] ? { ...root, label: labels[root.id]! } : root)),
  });
  const agencyAndSub: TenantScope = {
    access: {
      kind: "multi_root",
      scopes: [
        { tenantRoot: agencies, ids: ["1"] },
        { tenantRoot: subAgencies, ids: ["5"] },
      ],
    },
  };

  // A policy built in code skips the loader's check. Substitution used to keep the later
  // of two roots sharing a placeholder, binding sub-agency 5 where agency IDs are compared.
  it("throws on roots whose labels derive the same placeholder instead of keeping the last one", () => {
    let error: unknown;
    try {
      resolveTenantSql(
        "SELECT id FROM orders WHERE agency_id IN (:tenant_agency_ids)",
        relabel({ [subAgencies]: "agency" }),
        agencyAndSub,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SchemaParseError);
    expect((error as SchemaParseError).message).toContain(
      `roots '${agencies}' (label "Agency") and '${subAgencies}' (label "agency") both map to the placeholder :tenant_agency_ids`,
    );
  });

  // Labels with no ASCII letters or digits derive the placeholder from the table name,
  // so two Cyrillic-labelled roots each bind their own IDs.
  it("binds each Cyrillic-labelled root through its table name's placeholder", () => {
    const result = resolveTenantSql(
      "SELECT id FROM orders WHERE agency_id = :tenant_agencies_ids " +
        "UNION ALL SELECT id FROM notes WHERE owner_type = 'client' AND owner_id IN (:tenant_clients_ids)",
      relabel({ [agencies]: "Агентство", [clients]: "Клиент" }),
      {
        access: {
          kind: "multi_root",
          scopes: [
            { tenantRoot: agencies, ids: ["1"] },
            { tenantRoot: clients, ids: ["5"] },
          ],
        },
      },
      "sql-only",
    );
    expect(result.sql).toBe(
      "SELECT id FROM orders WHERE agency_id = '1' " +
        "UNION ALL SELECT id FROM notes WHERE owner_type = 'client' AND owner_id IN ('5')",
    );
    expect(result.bindings).toEqual([
      { placeholder: ":tenant_agencies_ids", rootLabel: "Агентство", rootId: agencies, ids: ["1"] },
      { placeholder: ":tenant_clients_ids", rootLabel: "Клиент", rootId: clients, ids: ["5"] },
    ]);
  });
});

// A host that computes a placeholder itself (to write or rebind SQL) must get the one
// core binds. The public `placeholderForTenantRoot` is that derivation (#375 review).
describe("placeholderForTenantRoot — the public derivation agrees with the binder", () => {
  const relabelled: NormalizedTenantPolicy = {
    ...policy,
    roots: policy.roots.map((root) => (root.id === "table:public.clients" ? { ...root, label: "Клиент" } : root)),
  };

  it.each([
    { name: "ASCII labels", roots: policy },
    { name: "a Cyrillic label", roots: relabelled },
  ])("binds each root's IDs under the placeholder the public function returns ($name)", ({ roots: p }) => {
    const placeholders = p.roots.map((root) => publicPlaceholderForTenantRoot(root));
    const result = resolveTenantSql(
      placeholders.map((ph, i) => `SELECT ${i} FROM t WHERE c IN (${ph})`).join(" UNION ALL "),
      p,
      { access: { kind: "multi_root", scopes: p.roots.map((root, i) => ({ tenantRoot: root.id, ids: [`id-${i}`] })) } },
    );
    expect(result.bindings.map((b) => [b.placeholder, b.rootId])).toEqual(
      p.roots.map((root, i) => [placeholders[i], root.id]),
    );
  });
});
