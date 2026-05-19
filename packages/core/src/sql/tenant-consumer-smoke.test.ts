/**
 * Consumer smoke test — exercises the full tenant pipeline as an external
 * consumer would: import types, load schema, call ask() with tenant scope,
 * and verify scoped output in both SQL output modes.
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModel } from "ai";
import {
  ask,
  loadSchema,
  TenantScopeError,
  TenantGuardrailError,
  type AskDialect,
  type TenantScope,
  type TenantScopeContext,
  type TenantSqlOutputMode,
  type TenantBinding,
  type NormalizedTenantPolicy,
  type TableCoverageEntry,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");
const nonTenantDir = join(fixturesDir, "orders-users.schema");

const fakeModel = {} as LanguageModel;

describe("consumer smoke test — tenant pipeline", () => {
  it("loads a multi-tenant schema and inspects the policy", () => {
    const schema = loadSchema(multiTenantDir);
    expect(schema.tenantPolicy).toBeDefined();

    const policy: NormalizedTenantPolicy = schema.tenantPolicy!;
    expect(policy.enforcement).toBe("strict");
    expect(policy.roots.length).toBeGreaterThan(0);
    expect(policy.scopedTables.length).toBeGreaterThan(0);

    const coverage: TableCoverageEntry[] = policy.coverage;
    const classifications = new Set(coverage.map((c) => c.classification));
    expect(classifications).toContain("root");
    expect(classifications).toContain("scoped");
    expect(classifications).toContain("global");
  });

  it("fails closed when scope is missing on multi-tenant schema", async () => {
    const schema = loadSchema(multiTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({ sql: "SELECT 1" }),
    };

    await expect(
      ask({ question: "test", schema, model: fakeModel, dialect }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("produces literal SQL in sql-only mode (default)", async () => {
    const schema = loadSchema(multiTenantDir);
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
      context: {
        role: "regional_manager",
        region: "northeast",
        description: "Manages 3 agencies",
      } satisfies TenantScopeContext,
    };

    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT o.id, o.total FROM orders o WHERE o.agency_id = :tenant_agency_ids AND o.status = 'paid'",
      }),
    };

    const result = await ask({
      question: "show paid orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: scope,
    });

    expect(result.sql).toBe(
      "SELECT o.id, o.total FROM orders o WHERE o.agency_id = '42' AND o.status = 'paid'",
    );
    expect(result.tenantBindings).toBeDefined();
    const binding: TenantBinding = result.tenantBindings![0]!;
    expect(binding.rootLabel).toBe("Agency");
    expect(binding.ids).toEqual(["42"]);
    expect(result.tenantParams).toBeUndefined();
  });

  it("produces parameterized SQL in sql-params mode", async () => {
    const schema = loadSchema(multiTenantDir);
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
    };

    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };

    const mode: TenantSqlOutputMode = "sql-params";
    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: scope,
      tenantSqlMode: mode,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders WHERE agency_id IN ($1, $2)");
    expect(result.tenantParams).toEqual(["42", "99"]);
    expect(result.tenantBindings).toHaveLength(1);
  });

  it("works transparently on non-tenant schemas", async () => {
    const schema = loadSchema(nonTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM users",
      }),
    };

    const result = await ask({
      question: "count users",
      schema,
      model: fakeModel,
      dialect,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM users");
    expect(result.tenantBindings).toBeUndefined();
    expect(result.tenantParams).toBeUndefined();
  });

  it("supports global scope for admin users", async () => {
    const schema = loadSchema(multiTenantDir);
    const scope: TenantScope = {
      access: { kind: "global", reason: "super_admin" },
    };

    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders",
      }),
    };

    const result = await ask({
      question: "count all orders globally",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: scope,
    });

    expect(result.sql).toBe("SELECT COUNT(*) FROM orders");
    expect(result.tenantBindings).toBeUndefined();
  });

  it("supports multi_root scope", async () => {
    const schema = loadSchema(multiTenantDir);
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["42"] },
          { tenantRoot: "table:public.clients", ids: ["99"] },
        ],
      },
    };

    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };

    const result = await ask({
      question: "show orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: scope,
    });

    expect(result.sql).toContain("'42'");
    expect(result.tenantBindings).toBeDefined();
  });
});
