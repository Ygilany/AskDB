import type { LanguageModel } from "ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ask, type AskDialect } from "./ask.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import { formatSchemaForNlToSql } from "./schema/normalize.js";
import type { NormalizedSchema } from "./schema/types.js";
import { formatSchemaV2ForNlToSql } from "./schema/v2/index.js";
import { loadSchema } from "./schema/v2/loader.js";
import type { TenantScope } from "./schema/v2/tenant-policy.js";

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

const here = dirname(fileURLToPath(import.meta.url));
const v2Dir = join(here, "../../../fixtures/schemas/orders-users.schema");
const multiTenantDir = join(here, "../../../fixtures/schemas/agency-multi-tenant.schema");

const agencyScope: TenantScope = {
  access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
};
const cannedDialect: AskDialect = {
  generate: async () => ({ sql: "SELECT COUNT(*) AS n FROM users" }),
};

const promptForwardingDialect: AskDialect = {
  async generate(_question, schema, _model, options) {
    const prompt =
      options?.prebuiltDdl ??
      ("schemaId" in schema
        ? formatSchemaV2ForNlToSql(schema, {
            omitSensitiveIdentifiersFromPrompt: options?.omitSensitiveIdentifiersFromNlToSqlPrompt,
          }).ddl
        : formatSchemaForNlToSql(schema, {
            omitSensitiveIdentifiersFromPrompt: options?.omitSensitiveIdentifiersFromNlToSqlPrompt,
          }).ddl);

    await options?.generateText?.({
      model: fakeModel,
      instructions: "test",
      prompt,
      temperature: 0,
    } as never);

    return { sql: "SELECT COUNT(*) AS n FROM users" };
  },
};

describe("ask (mode + logging)", () => {
  it("emits pipeline mode before generation", async () => {
    const info = vi.fn();
    await ask({
      question: "count users",
      schema: minimalSchema,
      model: fakeModel,
      dialect: cannedDialect,
      mode: "bounded_results",
      logger: { info, error: vi.fn() },
    });

    const modes = info.mock.calls.filter((c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelineMode);
    expect(modes.length).toBeGreaterThanOrEqual(1);
    expect(modes[0]![0]).toMatchObject({ mode: "bounded_results" });
  });
});

describe("ask — providerOptions passthrough", () => {
  it("does not forward a providerOptions key to the dialect when deps.providerOptions is unset", async () => {
    let seen: unknown;
    const capturingDialect: AskDialect = {
      async generate(_question, _schema, _model, options) {
        seen = options;
        return { sql: "SELECT COUNT(*) AS n FROM users" };
      },
    };

    await ask({
      question: "count users",
      schema: minimalSchema,
      model: fakeModel,
      dialect: capturingDialect,
    });

    expect((seen as { providerOptions?: unknown })?.providerOptions).toBeUndefined();
  });

  it("forwards deps.providerOptions to the dialect's generate() options", async () => {
    let seen: unknown;
    const capturingDialect: AskDialect = {
      async generate(_question, _schema, _model, options) {
        seen = options;
        return { sql: "SELECT COUNT(*) AS n FROM users" };
      },
    };
    const providerOptions = { openai: { reasoningEffort: "low" } };

    await ask({
      question: "count users",
      schema: minimalSchema,
      model: fakeModel,
      dialect: capturingDialect,
      deps: { providerOptions },
    });

    expect((seen as { providerOptions?: unknown })?.providerOptions).toBe(providerOptions);
  });
});

describe("ask — retriever wiring", () => {
  it("uses retrieved chunks to synthesize a focused DDL block for large v2 schemas", async () => {
    const schema = loadSchema(v2Dir);
    const retriever = vi.fn(async () => [
      {
        id: "chunk:table:public.orders#cql",
        score: 0.99,
        payload: {
          id: "chunk:table:public.orders#cql",
          type: "cql" as const,
          text:
            "# public.orders — common query language\n" +
            "- \"revenue\" usually means `sum(total_amount)` where `status = 'paid'`",
          schemaId: "orders-users",
          refs: ["table:public.orders"],
          sensitive: false,
        },
      },
    ]);
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT SUM(total_amount) FROM orders WHERE status = 'paid'\n```",
    }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await ask({
      question: "How much revenue did we make?",
      schema,
      model: fakeModel,
      dialect: promptForwardingDialect,
      retriever,
      retrievalK: 4,
      totalSchemaChunkCount: 100,
      logger,
      deps: { generateText },
    });

    expect(retriever).toHaveBeenCalledWith({
      question: "How much revenue did we make?",
      k: 4,
      filter: { schemaId: "orders-users" },
    });

    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("TABLE public.orders");
    expect(prompt).toContain("-- common query language --");
    expect(prompt).toContain("revenue");
    expect(prompt).not.toContain("TABLE public.users");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PipelineRetrievalUsed,
        resultCount: 1,
        tablesEmitted: 1,
      }),
      expect.any(String),
    );
  });

  it("prefers full DDL below the retrieval threshold without calling the retriever", async () => {
    const schema = loadSchema(v2Dir);
    const retriever = vi.fn(async () => []);
    const skippedGenerateText = vi.fn(async () => ({
      text: "```sql\nSELECT COUNT(*) FROM users\n```",
    }));
    const baselineGenerateText = vi.fn(async () => ({
      text: "```sql\nSELECT COUNT(*) FROM users\n```",
    }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await ask({
      question: "How many users?",
      schema,
      model: fakeModel,
      dialect: promptForwardingDialect,
      deps: { generateText: baselineGenerateText },
    });

    await ask({
      question: "How many users?",
      schema,
      model: fakeModel,
      dialect: promptForwardingDialect,
      retriever,
      totalSchemaChunkCount: 2,
      retrievalThresholdChunks: 30,
      logger,
      deps: { generateText: skippedGenerateText },
    });

    expect(retriever).not.toHaveBeenCalled();
    const baselinePrompt = (baselineGenerateText.mock.calls[0]![0] as { prompt: string }).prompt;
    const prompt = (skippedGenerateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toBe(baselinePrompt);
    expect(prompt).toContain("TABLE public.users");
    expect(prompt).toContain("TABLE public.orders");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PipelineRetrievalSkipped,
        reason: "below_threshold",
      }),
      expect.any(String),
    );
  });

  it("synthesized DDL still gets sensitive identifiers from core formatting", async () => {
    const schema = loadSchema(v2Dir);
    const retriever = vi.fn(async () => [
      {
        id: "chunk:table:public.users",
        score: 1,
        payload: {
          id: "chunk:table:public.users",
          type: "table" as const,
          text: "# public.users\nColumns:\n- id uuid (PK NOT NULL)",
          schemaId: "orders-users",
          refs: ["table:public.users"],
          sensitive: false,
        },
      },
    ]);
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT COUNT(*) FROM users\n```",
    }));

    await ask({
      question: "How many users?",
      schema,
      model: fakeModel,
      dialect: promptForwardingDialect,
      retriever,
      totalSchemaChunkCount: 100,
      deps: { generateText },
    });

    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("  - email text (NOT NULL) (sensitive)");
  });

  it("falls back to full DDL when the retriever returns no chunks", async () => {
    const schema = loadSchema(v2Dir);
    const retriever = vi.fn(async () => []);
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT COUNT(*) FROM users\n```",
    }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await ask({
      question: "How many users?",
      schema,
      model: fakeModel,
      dialect: promptForwardingDialect,
      retriever,
      totalSchemaChunkCount: 100,
      logger,
      deps: { generateText },
    });

    expect(retriever).toHaveBeenCalledOnce();
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("TABLE public.users");
    expect(prompt).toContain("TABLE public.orders");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PipelineRetrievalSkipped,
        reason: "no_results",
      }),
      expect.any(String),
    );
  });
});

describe("ask — parameterize", () => {
  const threeBlock = [
    "```sql",
    "SELECT count(*) FROM cities WHERE state = 'colorado'",
    "```",
    "```sql-unbound",
    "SELECT count(*) FROM cities WHERE state = :state_name",
    "```",
    "```json",
    '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","description":"State","value":"colorado"}]}',
    "```",
  ].join("\n");

  it("returns unboundSql, params, parameters, and preparedQuery after one model call", async () => {
    const generateText = vi.fn(async () => ({ text: threeBlock }));
    const result = await ask({
      question: "How many cities does Colorado have?",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      deps: { generateText },
    });
    expect(generateText).toHaveBeenCalledOnce();
    expect(result.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(result.unboundSql).toBe("SELECT count(*) FROM cities WHERE state = $1");
    expect(result.params).toEqual(["colorado"]);
    expect(result.parameters?.[0]?.name).toBe("state_name");
    expect(result.parameters?.[0]?.value).toBe("colorado");
    expect(result.preparedQuery?.namedSql).toContain(":state_name");
    expect(result.preparedQuery?.parameters[0]).not.toHaveProperty("value");
  });

  it("drops extras when blocks disagree — result.sql unaffected", async () => {
    const generateText = vi.fn(async () => ({
      text: [
        "```sql",
        "SELECT count(*) FROM cities WHERE state = 'colorado'",
        "```",
        "```sql-unbound",
        "SELECT count(*) FROM cities WHERE state = :state_name",
        "```",
        "```json",
        '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"utah"}]}',
        "```",
      ].join("\n"),
    }));
    const result = await ask({
      question: "how many",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      deps: { generateText },
    });
    expect(result.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(result.unboundSql).toBeUndefined();
    expect(result.params).toBeUndefined();
    expect(result.preparedQuery).toBeUndefined();
  });

  it("parameterize: false produces today's shape with no extras", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const result = await ask({
      question: "list users",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      parameterize: false,
      deps: { generateText },
    });
    expect(result).toEqual({ sql: "SELECT id FROM users" });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toContain("Parameterized output format");
  });

  it("custom AskDialect is unaffected and returns no extras", async () => {
    const result = await ask({
      question: "count",
      schema: minimalSchema,
      model: fakeModel,
      dialect: cannedDialect,
    });
    expect(result.sql).toBe("SELECT COUNT(*) AS n FROM users");
    expect(result.unboundSql).toBeUndefined();
    expect(result.preparedQuery).toBeUndefined();
  });

  const businessPlusTenantReply = [
    "```sql",
    "SELECT count(*) FROM orders WHERE status = 'paid' AND agency_id = :tenant_agency_ids",
    "```",
    "```sql-unbound",
    "SELECT count(*) FROM orders WHERE status = :status_name AND agency_id = :tenant_agency_ids",
    "```",
    "```json",
    '{"parameters":[{"name":"status_name","type":"string","cardinality":"one","value":"paid"}]}',
    "```",
  ].join("\n");

  it("combined business + tenant in tenantSqlMode sql-only", async () => {
    const schema = loadSchema(multiTenantDir);
    const generateText = vi.fn(async () => ({ text: businessPlusTenantReply }));
    const result = await ask({
      question: "how many paid orders",
      schema,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      tenantSqlMode: "sql-only",
      deps: { generateText },
    });

    expect(result.sql).toBe(
      "SELECT count(*) FROM orders WHERE status = 'paid' AND agency_id = '42'",
    );
    expect(result.unboundSql).toBe(
      "SELECT count(*) FROM orders WHERE status = $1 AND agency_id = '42'",
    );
    expect(result.params).toEqual(["paid"]);
    expect(result.tenantParams).toBeUndefined();
    expect(result.tenantBindings).toHaveLength(1);
    expect(result.tenantBindings![0]!.ids).toEqual(["42"]);
    expect(result.tenantBindings![0]!.placeholder).toBe(":tenant_agency_ids");
  });

  it("combined business + tenant in tenantSqlMode sql-params with continuous markers", async () => {
    const schema = loadSchema(multiTenantDir);
    const generateText = vi.fn(async () => ({ text: businessPlusTenantReply }));
    const result = await ask({
      question: "how many paid orders",
      schema,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      tenantSqlMode: "sql-params",
      deps: { generateText },
    });

    expect(result.sql).toBe(
      "SELECT count(*) FROM orders WHERE status = 'paid' AND agency_id = $2",
    );
    expect(result.unboundSql).toBe(
      "SELECT count(*) FROM orders WHERE status = $1 AND agency_id = $2",
    );
    expect(result.params).toEqual(["paid", "42"]);
    expect(result.tenantParams).toEqual(["42"]);
    expect(result.tenantBindings).toHaveLength(1);
    expect(result.tenantBindings![0]!.ids).toEqual(["42"]);
    expect(result.tenantBindings![0]!.placeholder).toBe(":tenant_agency_ids");
  });
});
