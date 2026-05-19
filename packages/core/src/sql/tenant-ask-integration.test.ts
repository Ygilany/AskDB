import type { LanguageModel } from "ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ask, type AskDialect } from "../ask.js";
import { TenantScopeError } from "../errors.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");
const nonTenantDir = join(fixturesDir, "orders-users.schema");

const fakeModel = {} as LanguageModel;

const agencyScope: TenantScope = {
  access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
};

describe("ask() — tenant scope integration", () => {
  it("fails closed when tenant policy exists but no scope is provided", async () => {
    const schema = loadSchema(multiTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({ sql: "SELECT 1" }),
    };

    await expect(
      ask({
        question: "count orders",
        schema,
        model: fakeModel,
        dialect,
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("proceeds when tenant policy exists and valid scope is provided", async () => {
    const schema = loadSchema(multiTenantDir);
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

    expect(result.sql).toContain("SELECT COUNT(*)");
  });

  it("does not require scope when schema has no tenant policy", async () => {
    const schema = loadSchema(nonTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({ sql: "SELECT COUNT(*) FROM users" }),
    };

    const result = await ask({
      question: "count users",
      schema,
      model: fakeModel,
      dialect,
    });

    expect(result.sql).toContain("SELECT COUNT(*)");
  });

  it("rejects unknown tenant root before reaching the model", async () => {
    const schema = loadSchema(multiTenantDir);
    const generate = vi.fn(async () => ({ sql: "SELECT 1" }));
    const dialect: AskDialect = { generate };

    await expect(
      ask({
        question: "count orders",
        schema,
        model: fakeModel,
        dialect,
        tenantScope: {
          access: { kind: "ids", tenantRoot: "table:public.nonexistent", ids: ["42"] },
        },
      }),
    ).rejects.toThrow(TenantScopeError);

    expect(generate).not.toHaveBeenCalled();
  });

  it("logs tenant scope validation events", async () => {
    const schema = loadSchema(multiTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };
    const info = vi.fn();

    await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencyScope,
      logger: { info, error: vi.fn() },
    });

    const tenantEvents = info.mock.calls.filter(
      (c) => (c[0] as { event?: string })?.event === "askdb.tenant.scope_validated",
    );
    expect(tenantEvents.length).toBe(1);
    expect(tenantEvents[0]![0]).toMatchObject({
      scopeKind: "ids",
      enforcement: "strict",
    });
  });

  it("passes tenant scope through to the dialect generate function", async () => {
    const schema = loadSchema(multiTenantDir);
    const generate = vi.fn(async () => ({
      sql: "SELECT COUNT(*) FROM orders WHERE agency_id = :tenant_agency_ids",
    }));
    const dialect: AskDialect = { generate };

    await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencyScope,
    });

    const options = generate.mock.calls[0]![3];
    expect(options?.tenantPolicy).toBeDefined();
    expect(options?.tenantScope).toEqual(agencyScope);
  });
});
