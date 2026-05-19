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

  it("resolves subtree scope", () => {
    const scope: TenantScope = {
      access: { kind: "subtree", tenantRoot: "table:public.agencies", rootIds: ["42"], includeDescendants: true },
    };
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const resolved = resolvePlaceholders(sql, policy, scope);
    expect(resolved[0]!.ids).toEqual(["42"]);
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
  it("replaces single-value placeholder with quoted literal", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(replacePlaceholdersWithLiterals(sql, resolved)).toBe(
      "SELECT * FROM orders WHERE agency_id = '42'",
    );
  });

  it("replaces multi-value placeholder and converts = to IN", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42", "99"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(replacePlaceholdersWithLiterals(sql, resolved)).toBe(
      "SELECT * FROM orders WHERE agency_id IN ('42', '99')",
    );
  });

  it("handles IN (:placeholder) syntax with multiple values", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42", "99"] }];
    const sql = "SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids)";
    expect(replacePlaceholdersWithLiterals(sql, resolved)).toBe(
      "SELECT * FROM orders WHERE agency_id IN ('42', '99')",
    );
  });

  it("escapes single quotes in values", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["it's"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    expect(replacePlaceholdersWithLiterals(sql, resolved)).toBe(
      "SELECT * FROM orders WHERE agency_id = 'it''s'",
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

describe("replacePlaceholdersWithParams", () => {
  it("replaces single-value placeholder with $N", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = replacePlaceholdersWithParams(sql, resolved);
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = $1");
    expect(result.params).toEqual(["42"]);
    expect(result.nextIndex).toBe(2);
  });

  it("replaces multi-value placeholder with ($N, $N+1) and converts = to IN", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42", "99"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = replacePlaceholdersWithParams(sql, resolved);
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id IN ($1, $2)");
    expect(result.params).toEqual(["42", "99"]);
    expect(result.nextIndex).toBe(3);
  });

  it("respects startIndex for chaining with existing params", () => {
    const resolved = [{ placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42"] }];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = replacePlaceholdersWithParams(sql, resolved, 5);
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = $5");
    expect(result.params).toEqual(["42"]);
    expect(result.nextIndex).toBe(6);
  });

  it("handles multiple placeholders with sequential param indices", () => {
    const resolved = [
      { placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: "r1", ids: ["42"] },
      { placeholder: ":tenant_client_ids", rootLabel: "Client", rootId: "r2", ids: ["99", "100"] },
    ];
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND client_id = :tenant_client_ids";
    const result = replacePlaceholdersWithParams(sql, resolved);
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = $1 AND client_id IN ($2, $3)");
    expect(result.params).toEqual(["42", "99", "100"]);
    expect(result.nextIndex).toBe(4);
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
  const agencyScope: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
  };

  it("converts to positional parameters", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = resolveTenantSql(sql, policy, agencyScope, "sql-params");
    expect(result.mode).toBe("sql-params");
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = $1");
    if (result.mode === "sql-params") {
      expect(result.params).toEqual(["42"]);
      expect(result.paramStartIndex).toBe(1);
    }
  });

  it("passes through for global scope with empty params", () => {
    const globalScope: TenantScope = { access: { kind: "global", reason: "admin" } };
    const sql = "SELECT * FROM orders";
    const result = resolveTenantSql(sql, policy, globalScope, "sql-params");
    expect(result.mode).toBe("sql-params");
    if (result.mode === "sql-params") {
      expect(result.params).toEqual([]);
    }
  });

  it("respects custom paramStartIndex", () => {
    const sql = "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids";
    const result = resolveTenantSql(sql, policy, agencyScope, "sql-params", 3);
    if (result.mode === "sql-params") {
      expect(result.sql).toContain("$3");
      expect(result.paramStartIndex).toBe(3);
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
