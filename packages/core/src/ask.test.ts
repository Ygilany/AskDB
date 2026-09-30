import type { LanguageModel } from "ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ask, type AskDialect } from "./ask.js";
import { placeholderForTenantRoot, validateTenantScope } from "./index.js";
import {
  AskDbError,
  SchemaParseError,
  SensitiveReferenceError,
  TenantGuardrailError,
  TenantScopeError,
  UnknownDialectError,
} from "./errors.js";
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

  it("combined business + tenant in tenantSqlMode sql-params: sql runs with tenantParams, unboundSql with params", async () => {
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

    // Business values are literals in `sql`, so its tenant markers start at $1
    // and line up with tenantParams (previously $2 with a one-element array).
    expect(result.sql).toBe(
      "SELECT count(*) FROM orders WHERE status = 'paid' AND agency_id = $1",
    );
    expect(result.tenantParams).toEqual(["42"]);
    expect(result.unboundSql).toBe(
      "SELECT count(*) FROM orders WHERE status = $1 AND agency_id = $2",
    );
    expect(result.params).toEqual(["paid", "42"]);
    expect(result.tenantBindings).toHaveLength(1);
    expect(result.tenantBindings![0]!.ids).toEqual(["42"]);
    expect(result.tenantBindings![0]!.placeholder).toBe(":tenant_agency_ids");
  });
});

describe("ask — tenant params contract across dialects (sql-params)", () => {
  // Tenant placeholder BEFORE the business placeholders, so `?` dialects must
  // interleave tenant and business values in source order.
  const reply = [
    "```sql",
    "SELECT count(*) FROM orders WHERE agency_id IN (:tenant_agency_ids) AND status = 'paid' AND total > 10",
    "```",
    "```sql-unbound",
    "SELECT count(*) FROM orders WHERE agency_id IN (:tenant_agency_ids) AND status = :status_name AND total > :min_total",
    "```",
    "```json",
    '{"parameters":[{"name":"status_name","type":"string","cardinality":"one","value":"paid"},' +
      '{"name":"min_total","type":"number","cardinality":"one","value":10}]}',
    "```",
  ].join("\n");
  const twoAgencies: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
  };
  const literalSql =
    "SELECT count(*) FROM orders WHERE agency_id IN ('42', '99') AND status = 'paid' AND total > 10";

  const cases = [
    {
      dialect: "postgres" as const,
      sql: "agency_id IN ($1, $2) AND status = 'paid' AND total > 10",
      unbound: "agency_id IN ($3, $4) AND status = $1 AND total > $2",
      params: ["paid", 10, "42", "99"],
      indices: { status_name: [0], min_total: [1] },
    },
    {
      dialect: "mysql" as const,
      sql: "agency_id IN (?, ?) AND status = 'paid' AND total > 10",
      unbound: "agency_id IN (?, ?) AND status = ? AND total > ?",
      params: ["42", "99", "paid", 10],
      indices: { status_name: [2], min_total: [3] },
    },
    {
      dialect: "sqlite" as const,
      sql: "agency_id IN (?, ?) AND status = 'paid' AND total > 10",
      unbound: "agency_id IN (?, ?) AND status = ? AND total > ?",
      params: ["42", "99", "paid", 10],
      indices: { status_name: [2], min_total: [3] },
    },
    {
      dialect: "sqlserver" as const,
      sql: "agency_id IN (@p0, @p1) AND status = 'paid' AND total > 10",
      unbound: "agency_id IN (@p2, @p3) AND status = @p0 AND total > @p1",
      params: ["paid", 10, "42", "99"],
      indices: { status_name: [0], min_total: [1] },
    },
  ];

  it.each(cases)("$dialect: markers, params, and parameter indices line up", async (c) => {
    const schema = loadSchema(multiTenantDir);
    const result = await ask({
      question: "how many paid orders over 10",
      schema,
      model: fakeModel,
      dialect: c.dialect,
      tenantScope: twoAgencies,
      tenantSqlMode: "sql-params",
      deps: { generateText: vi.fn(async () => ({ text: reply })) },
    });

    const prefix = "SELECT count(*) FROM orders WHERE ";
    expect(result.sql).toBe(prefix + c.sql);
    expect(result.tenantParams).toEqual(["42", "99"]);
    expect(result.unboundSql).toBe(prefix + c.unbound);
    expect(result.params).toEqual(c.params);
    expect(
      Object.fromEntries(result.parameters!.map((p) => [p.name, p.indices])),
    ).toEqual(c.indices);
    // No foreign marker style leaks into the statement.
    const foreign = { postgres: /\?|@p\d/, mysql: /\$\d|@p\d/, sqlite: /\$\d|@p\d/, sqlserver: /\$\d|\?/ };
    expect(result.sql).not.toMatch(foreign[c.dialect]);
    expect(result.unboundSql).not.toMatch(foreign[c.dialect]);

    // Executable pairs: inlining params into markers reproduces the literal SQL.
    expect(inlineMarkers(result.sql, result.tenantParams!)).toBe(literalSql);
    expect(inlineMarkers(result.unboundSql!, result.params!)).toBe(literalSql);
    for (const p of result.parameters!) {
      for (const i of p.indices) expect(result.params![i]).toEqual(p.value);
    }
  });

  it("MySQL: a business marker before the tenant list keeps source order", async () => {
    const schema = loadSchema(multiTenantDir);
    const before = [
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
    const result = await ask({
      question: "q",
      schema,
      model: fakeModel,
      dialect: "mysql",
      tenantScope: twoAgencies,
      tenantSqlMode: "sql-params",
      deps: { generateText: vi.fn(async () => ({ text: before })) },
    });
    expect(result.unboundSql).toBe(
      "SELECT count(*) FROM orders WHERE status = ? AND agency_id IN (?, ?)",
    );
    expect(result.params).toEqual(["paid", "42", "99"]);
    expect(result.sql).toBe("SELECT count(*) FROM orders WHERE status = 'paid' AND agency_id IN (?, ?)");
    expect(result.sql).not.toMatch(/\$\d/);
  });

  it("zero IDs for a referenced root throws instead of returning SQL", async () => {
    const schema = loadSchema(multiTenantDir);
    const clientOnly = [
      "```sql",
      "SELECT count(*) FROM orders WHERE agency_id IN (:tenant_agency_ids) AND client_id IN (:tenant_client_ids)",
      "```",
    ].join("\n");
    await expect(
      ask({
        question: "q",
        schema,
        model: fakeModel,
        dialect: "postgres",
        tenantScope: twoAgencies,
        parameterize: false,
        deps: { generateText: vi.fn(async () => ({ text: clientOnly })) },
      }),
    ).rejects.toMatchObject({ name: "TenantScopeError", reason: "UNRESOLVED_TENANT_PLACEHOLDER" });
  });
});

/** Replace driver markers in code regions with the literal of the value they bind. */
function inlineMarkers(sql: string, params: readonly unknown[]): string {
  const lit = (v: unknown) => (typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v));
  let q = 0;
  return sql.replace(/'(?:[^']|'')*'|\$(\d+)|@p(\d+)|\?/g, (m, dollar?: string, atp?: string) => {
    if (m.startsWith("'")) return m;
    if (dollar !== undefined) return lit(params[Number(dollar) - 1]);
    if (atp !== undefined) return lit(params[Number(atp)]);
    return lit(params[q++]);
  });
}

describe("ask — tenant guardrail runs on the SQL actually returned", () => {
  // The model's bound ```sql block is unscoped while its ```sql-unbound block is
  // scoped. The consistency check drops the unbound extras, so result.sql is the
  // unscoped statement — the guardrail must judge that, not the unbound form.
  const disagreeingReply = [
    "```sql",
    "SELECT * FROM orders WHERE status='open'",
    "```",
    "```sql-unbound",
    "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status",
    "```",
    "```json",
    '{"parameters":[{"name":"status","type":"string","cardinality":"one","value":"open"}]}',
    "```",
  ].join("\n");

  function warnSchema() {
    const schema = loadSchema(multiTenantDir);
    return { ...schema, tenantPolicy: { ...schema.tenantPolicy!, enforcement: "warn" as const } };
  }

  it("strict: throws TenantGuardrailError when sql and sql-unbound disagree on tenant scope", async () => {
    const schema = loadSchema(multiTenantDir);
    const generateText = vi.fn(async () => ({ text: disagreeingReply }));
    await expect(
      ask({
        question: "open orders",
        schema,
        model: fakeModel,
        dialect: "postgres",
        tenantScope: agencyScope,
        deps: { generateText },
      }),
    ).rejects.toThrow(TenantGuardrailError);
  });

  it("warn: returns the unscoped SQL with a failed guardrail and warnings", async () => {
    const generateText = vi.fn(async () => ({ text: disagreeingReply }));
    const result = await ask({
      question: "open orders",
      schema: warnSchema(),
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      deps: { generateText },
    });
    expect(result.sql).toBe("SELECT * FROM orders WHERE status='open'");
    expect(result.unboundSql).toBeUndefined();
    expect(result.tenantGuardrail?.passed).toBe(false);
    expect(result.tenantGuardrail?.warnings.map((w) => w.rule)).toContain(
      "MISSING_TENANT_PREDICATE",
    );
  });

  it("consistent sql / sql-unbound with a tenant predicate still passes, reported once", async () => {
    const schema = loadSchema(multiTenantDir);
    const generateText = vi.fn(async () => ({
      text: [
        "```sql",
        "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'open'",
        "```",
        "```sql-unbound",
        "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status",
        "```",
        "```json",
        '{"parameters":[{"name":"status","type":"string","cardinality":"one","value":"open"}]}',
        "```",
      ].join("\n"),
    }));
    const info = vi.fn();
    const result = await ask({
      question: "open orders",
      schema,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      logger: { info, error: vi.fn() },
      deps: { generateText },
    });
    expect(result.sql).toBe("SELECT * FROM orders WHERE agency_id = '42' AND status = 'open'");
    expect(result.unboundSql).toBe("SELECT * FROM orders WHERE agency_id = '42' AND status = $1");
    expect(result.tenantGuardrail).toEqual({ passed: true, warnings: [] });
    const guardrailEvents = info.mock.calls.filter((c) =>
      [AskDbLogEvent.TenantGuardrailPassed, AskDbLogEvent.TenantGuardrailFailed].includes(
        (c[0] as { event?: string }).event as never,
      ),
    );
    expect(guardrailEvents).toHaveLength(1);
    expect(guardrailEvents[0]![0]).toMatchObject({ event: AskDbLogEvent.TenantGuardrailPassed });
  });

  it("reads the SQL with the target dialect: a Postgres double-quoted tenant column counts", async () => {
    // Without the dialect the guardrail must also accept the MySQL reading, where
    // "agency_id" is a string, and would reject this.
    const schema = loadSchema(multiTenantDir);
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT * FROM orders WHERE \"agency_id\" = :tenant_agency_ids\n```",
    }));
    const result = await ask({
      question: "orders",
      schema,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      parameterize: false,
      deps: { generateText },
    });
    expect(result.tenantGuardrail).toEqual({ passed: true, warnings: [] });
  });

  it("checks the model's SQL before tenant substitution, so its sql-params rendering ($1) passes", async () => {
    const schema = loadSchema(multiTenantDir);
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids\n```",
    }));
    const result = await ask({
      question: "count orders",
      schema,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      tenantSqlMode: "sql-params",
      parameterize: false,
      deps: { generateText },
    });
    expect(result.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = $1");
    expect(result.tenantGuardrail?.passed).toBe(true);
  });
});

describe("ask — tenant guardrail covers custom AskDialect implementations", () => {
  it("strict: rejects an unscoped SELECT from a custom dialect", async () => {
    const schema = loadSchema(multiTenantDir);
    const dialect: AskDialect = { generate: async () => ({ sql: "SELECT * FROM orders" }) };
    await expect(
      ask({ question: "q", schema, model: fakeModel, dialect, tenantScope: agencyScope }),
    ).rejects.toThrow(TenantGuardrailError);
  });

  it("does not trust a custom dialect's self-reported passing guardrail", async () => {
    const schema = loadSchema(multiTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT * FROM orders",
        tenantGuardrail: { passed: true, warnings: [] },
      }),
    };
    await expect(
      ask({ question: "q", schema, model: fakeModel, dialect, tenantScope: agencyScope }),
    ).rejects.toThrow(TenantGuardrailError);
  });

  it("merges a custom dialect's reported failures into the result (warn)", async () => {
    const base = loadSchema(multiTenantDir);
    const schema = { ...base, tenantPolicy: { ...base.tenantPolicy!, enforcement: "warn" as const } };
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids",
        tenantGuardrail: {
          passed: false,
          warnings: [{ rule: "UNPROVABLE_SCOPE", tableId: "table:public.orders", message: "custom" }],
        },
      }),
    };
    const result = await ask({ question: "q", schema, model: fakeModel, dialect, tenantScope: agencyScope });
    expect(result.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = '42'");
    expect(result.tenantGuardrail?.passed).toBe(false);
    expect(result.tenantGuardrail?.warnings).toEqual([
      { rule: "UNPROVABLE_SCOPE", tableId: "table:public.orders", message: "custom" },
    ]);
  });

  it("scoped SQL from a custom dialect passes and gets a tenantGuardrail result", async () => {
    const schema = loadSchema(multiTenantDir);
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids",
      }),
    };
    const result = await ask({ question: "q", schema, model: fakeModel, dialect, tenantScope: agencyScope });
    expect(result.tenantGuardrail).toEqual({ passed: true, warnings: [] });
  });

  it("without a tenant policy, custom dialect output is unchanged", async () => {
    const dialect: AskDialect = { generate: async () => ({ sql: "DELETE FROM orders" }) };
    const result = await ask({ question: "q", schema: minimalSchema, model: fakeModel, dialect });
    expect(result).toEqual({ sql: "DELETE FROM orders" });
  });
});

describe("ask — unknown dialect id", () => {
  it("throws a typed UnknownDialectError", async () => {
    const run = ask({
      question: "q",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "oracle" as never,
    });
    await expect(run).rejects.toBeInstanceOf(UnknownDialectError);
    await expect(run).rejects.toBeInstanceOf(AskDbError);
    await expect(run).rejects.toMatchObject({ dialectId: "oracle" });
  });
});

describe("ask — sensitive-identifier guardrail", () => {
  const sensitiveSchema: NormalizedSchema = {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "integer", nullable: false, primaryKey: true },
          { name: "email", type: "text", nullable: false },
          { name: "password", type: "text", nullable: false, sensitive: true },
        ],
      },
      {
        name: "orders",
        columns: [
          { name: "id", type: "integer", nullable: false, primaryKey: true },
          { name: "total_cents", type: "integer", nullable: false },
        ],
      },
    ],
  };

  const dialectReturning = (sql: string): AskDialect => ({ generate: async () => ({ sql }) });

  it("attaches sensitiveGuardrail and warns by default", async () => {
    const info = vi.fn();
    const result = await ask({
      question: "credentials",
      schema: sensitiveSchema,
      model: fakeModel,
      dialect: dialectReturning("SELECT email, password FROM users"),
      logger: { info, error: vi.fn() },
    });

    expect(result.sensitiveGuardrail).toEqual({
      passed: false,
      references: [{ table: "users", column: "password", matchKind: "unqualified" }],
    });
    const warnings = info.mock.calls.filter(
      (c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelineSensitiveSqlWarning,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toMatchObject({
      sensitiveColumnCount: 1,
      sensitiveColumns: ["users.password"],
    });
  });

  it("does not flag a benign query against another table", async () => {
    const result = await ask({
      question: "orders",
      schema: sensitiveSchema,
      model: fakeModel,
      dialect: dialectReturning("SELECT id, total_cents FROM orders"),
    });
    expect(result.sensitiveGuardrail).toEqual({ passed: true, references: [] });
  });

  it("strict mode rejects the call with SensitiveReferenceError", async () => {
    const info = vi.fn();
    await expect(
      ask({
        question: "credentials",
        schema: sensitiveSchema,
        model: fakeModel,
        dialect: dialectReturning("SELECT u.password FROM users u"),
        sensitiveGuardrailMode: "strict",
        logger: { info, error: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(SensitiveReferenceError);

    // The warning is still logged before the throw so operators see what tripped it.
    expect(
      info.mock.calls.filter(
        (c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelineSensitiveSqlWarning,
      ),
    ).toHaveLength(1);
  });

  it("off mode skips the check entirely", async () => {
    const result = await ask({
      question: "credentials",
      schema: sensitiveSchema,
      model: fakeModel,
      dialect: dialectReturning("SELECT email, password FROM users"),
      sensitiveGuardrailMode: "off",
    });
    expect(result.sensitiveGuardrail).toBeUndefined();
  });

  it("lexes the SQL with the call's dialect", async () => {
    // MySQL reads 'a\' , password' as ONE string literal (backslash escape). Engines
    // without backslash escapes end the literal at \' and see `password` as code.
    const sql = "SELECT id FROM users WHERE id = 'a\\' , password'";
    const generateText = vi.fn(async () => ({ text: "```sql\n" + sql + "\n```" }));
    const mysql = await ask({
      question: "ids",
      schema: sensitiveSchema,
      model: fakeModel,
      dialect: "mysql",
      parameterize: false,
      deps: { generateText },
    });
    expect(mysql.sensitiveGuardrail).toEqual({ passed: true, references: [] });

    // A custom AskDialect has no spec, so every built-in reading is considered.
    const custom = await ask({
      question: "ids",
      schema: sensitiveSchema,
      model: fakeModel,
      dialect: dialectReturning(sql),
    });
    expect(custom.sensitiveGuardrail?.references).toEqual([
      expect.objectContaining({ table: "users", column: "password" }),
    ]);
  });

  it("is absent when the schema declares no sensitive identifiers", async () => {
    const result = await ask({
      question: "count",
      schema: minimalSchema,
      model: fakeModel,
      dialect: cannedDialect,
    });
    expect(result.sensitiveGuardrail).toBeUndefined();
  });
});

describe("ask — subtree tenant scope expansion", () => {
  const schema = loadSchema(multiTenantDir);
  const agencies = "table:public.agencies";
  const subAgencies = "table:public.sub_agencies";
  const clients = "table:public.clients";
  const subtreeOf = (tenantRoot: string, rootIds: string[]): TenantScope => ({
    access: { kind: "subtree", tenantRoot, rootIds, includeDescendants: true },
  });
  const agencySubtree = subtreeOf(agencies, ["1"]);
  const sqlDialect = (sql: string) => ({ generate: vi.fn(async (..._args: unknown[]) => ({ sql })) });
  const ordersByAgency = "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids";

  // Regression (#338). The fixture's hierarchy spans three root tables, each with its own
  // ID space: agency 1 owns sub-agency 5 and client 5, and agency 5 is another tenant.
  // A flat "every ID in the subtree" list folded 5 into :tenant_agency_ids, so
  // `orders.agency_id IN ('1', '5')` returned the other tenant's orders. A flat list
  // can't say which root each ID belongs to, so ask() refuses it before the model call.
  it("refuses a flat ID list instead of binding descendant IDs to the root's placeholder", async () => {
    const dialect = sqlDialect(ordersByAgency);
    const error = await ask({
      question: "list orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencySubtree,
      resolveTenantDescendants: async () => ["1", "5", "5"] as never,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("SUBTREE_NOT_RESOLVABLE");
    expect((error as TenantScopeError).message).toMatch(/returned an array.*IDs per tenant root/s);
    expect(dialect.generate).not.toHaveBeenCalled();
  });

  // Regression (#338), the per-root contract: each level's IDs bind to that level's own
  // placeholder, even when the same ID value appears at several levels.
  it.each([
    {
      mode: "sql-only" as const,
      sql: "SELECT id FROM orders WHERE agency_id = '1' UNION ALL SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN ('5')",
      tenantParams: undefined,
    },
    {
      mode: "sql-params" as const,
      sql: "SELECT id FROM orders WHERE agency_id = $1 UNION ALL SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN ($2)",
      tenantParams: ["1", "5"],
    },
  ])("binds each root's IDs to its own placeholder when IDs collide across roots ($mode)", async ({ mode, sql, tenantParams }) => {
    const dialect = sqlDialect(
      `${ordersByAgency} UNION ALL SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN (:tenant_client_ids)`,
    );
    const resolveTenantDescendants = vi.fn(async () => ({
      [agencies]: ["1"],
      [subAgencies]: ["5"],
      [clients]: ["5"],
    }));
    const result = await ask({
      question: "list orders and appointments",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencySubtree,
      tenantSqlMode: mode,
      resolveTenantDescendants,
    });

    expect(result.sql).toBe(sql);
    expect(result.tenantParams).toEqual(tenantParams);
    expect(result.tenantBindings).toEqual([
      { placeholder: ":tenant_agency_ids", rootLabel: "Agency", rootId: agencies, ids: ["1"] },
      { placeholder: ":tenant_client_ids", rootLabel: "Client", rootId: clients, ids: ["5"] },
    ]);
    expect(resolveTenantDescendants).toHaveBeenCalledWith(agencies, ["1"]);
    // The model is prompted with the expanded scope, one placeholder per level.
    expect(dialect.generate.mock.calls[0]).toContainEqual(
      expect.objectContaining({
        tenantScope: {
          access: {
            kind: "multi_root",
            scopes: [
              { tenantRoot: agencies, ids: ["1"] },
              { tenantRoot: subAgencies, ids: ["5"] },
              { tenantRoot: clients, ids: ["5"] },
            ],
          },
        },
      }),
    );
  });

  // The policy can't declare a same-table tree yet (#238), so a host whose agencies
  // table has a parent column returns its descendants under the root's own key. The
  // fixture's agencies table has no parent column: the resolver stands in for that host.
  it("binds same-root descendants to the root's placeholder, with the seeds unioned in", async () => {
    const result = await ask({
      question: "list orders",
      schema,
      model: fakeModel,
      dialect: sqlDialect(ordersByAgency),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [agencies]: ["2", "3"] }),
    });

    expect(result.sql).toBe("SELECT id FROM orders WHERE agency_id IN ('1', '2', '3')");
  });

  // An ancestor never loses its own rows when a resolver returns strict descendants only.
  it("binds the seeds to the root's placeholder when the resolver returns child levels only", async () => {
    const result = await ask({
      question: "list orders",
      schema,
      model: fakeModel,
      dialect: sqlDialect(ordersByAgency),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [clients]: ["5"] }),
    });

    expect(result.sql).toBe("SELECT id FROM orders WHERE agency_id = '1'");
  });

  // A level the resolver returns no IDs for has no placeholder value, so using it
  // fails closed rather than binding nothing or another level's IDs.
  it("throws UNRESOLVED_TENANT_PLACEHOLDER for a level the resolver returned no IDs for", async () => {
    const error = await ask({
      question: "list sub-agency notes",
      schema,
      model: fakeModel,
      dialect: sqlDialect("SELECT id FROM notes WHERE owner_type = 'sub_agency' AND owner_id IN (:tenant_sub_agency_ids)"),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [agencies]: ["1"], [subAgencies]: [], [clients]: ["5"] }),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
  });

  // Regression (#375 review): with the sub-agency root labelled "agency", both roots
  // derive :tenant_agency_ids, and substitution kept the later root, so the sub-agency's
  // ID 5 was bound where agency IDs are compared. A policy that reaches ask() without the
  // loader (built in code) must be refused too, before the model call.
  it("refuses a policy whose root labels derive the same placeholder", async () => {
    const policy = schema.tenantPolicy!;
    const colliding = {
      ...schema,
      tenantPolicy: {
        ...policy,
        roots: policy.roots.map((root) => (root.id === subAgencies ? { ...root, label: "agency" } : root)),
      },
    };
    const dialect = sqlDialect(ordersByAgency);
    const error = await ask({
      question: "list orders",
      schema: colliding,
      model: fakeModel,
      dialect,
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [agencies]: ["1"], [subAgencies]: ["5"] }),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SchemaParseError);
    expect((error as SchemaParseError).message).toContain(
      `roots '${agencies}' (label "Agency") and '${subAgencies}' (label "agency") both map to the placeholder :tenant_agency_ids`,
    );
    expect(dialect.generate).not.toHaveBeenCalled();
  });

  // The check before generation can't see labels changed afterwards (here by the resolver,
  // i.e. host code editing its own policy), so substitution re-checks where the IDs bind.
  it("refuses to bind when the policy's labels collide after scope validation", async () => {
    const policy = schema.tenantPolicy!;
    const roots = policy.roots.map((root) => ({ ...root }));
    const mutable = { ...schema, tenantPolicy: { ...policy, roots } };
    const error = await ask({
      question: "list orders",
      schema: mutable,
      model: fakeModel,
      dialect: sqlDialect(ordersByAgency),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => {
        roots.find((root) => root.id === subAgencies)!.label = "agency";
        return { [agencies]: ["1"], [subAgencies]: ["5"] };
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SchemaParseError);
    expect((error as SchemaParseError).message).toContain("both map to the placeholder :tenant_agency_ids");
  });

  // The resolver result is read once: a value hidden from validation (non-enumerable) or
  // one that changes between reads (a getter) must not reach the bound IDs.
  it("ignores a non-enumerable level instead of binding its unvalidated value", async () => {
    const resolved = { [agencies]: ["1"] };
    Object.defineProperty(resolved, clients, { value: "15", enumerable: false });
    const error = await ask({
      question: "list client appointments",
      schema,
      model: fakeModel,
      dialect: sqlDialect(
        "SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN (:tenant_client_ids)",
      ),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => resolved,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
  });

  it("binds the IDs a getter returned when validated, not a later read", async () => {
    const reads = [["5"], ["9"]];
    const resolved = { [agencies]: ["1"] } as Record<string, readonly string[]>;
    Object.defineProperty(resolved, clients, { get: () => reads.shift() ?? [""], enumerable: true });
    const result = await ask({
      question: "list client appointments",
      schema,
      model: fakeModel,
      dialect: sqlDialect(
        "SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN (:tenant_client_ids)",
      ),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => resolved,
    });

    expect(result.sql).toBe("SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN ('5')");
  });

  // An expanded subtree puts one placeholder per root in front of the model. With IDs
  // colliding across roots (agency 1 owns client 5; agency 5 is another tenant), a
  // placeholder compared with another root's column binds another tenant's IDs. The
  // strict tenant guardrail (#341) requires each column to be compared with its own
  // root's placeholder, so these are rejected before any SQL is returned.
  it.each([
    {
      name: "a client placeholder on the agency column",
      sql: "SELECT id FROM orders WHERE agency_id IN (:tenant_client_ids)",
      warnings: [["MISSING_TENANT_PREDICATE", "table:public.orders"]],
    },
    {
      name: "a client placeholder under the agency discriminator",
      sql: "SELECT id FROM notes WHERE owner_type = 'agency' AND owner_id IN (:tenant_client_ids)",
      warnings: [["MISSING_TYPE_DISCRIMINATOR", "table:public.notes"]],
    },
    {
      name: "the agency placeholder on the client column",
      sql: "SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN (:tenant_agency_ids)",
      warnings: [
        ["MISSING_TENANT_PREDICATE", clients],
        ["MISSING_TENANT_PREDICATE", "table:public.appointments"],
      ],
    },
    // Not a mispairing, but the same rule: every root the expanded scope covers that the
    // query reads needs its own placeholder, so joining up to the agency alone is refused.
    {
      name: "child roots filtered only through the agency",
      sql:
        "SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id " +
        "JOIN sub_agencies s ON c.sub_agency_id = s.id WHERE s.agency_id IN (:tenant_agency_ids)",
      warnings: [
        ["MISSING_TENANT_PREDICATE", subAgencies],
        ["MISSING_TENANT_PREDICATE", clients],
      ],
    },
  ])("rejects $name under an expanded subtree (strict)", async ({ sql, warnings }) => {
    const error = await ask({
      question: "list rows",
      schema,
      model: fakeModel,
      dialect: sqlDialect(sql),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [agencies]: ["1"], [subAgencies]: ["5"], [clients]: ["5"] }),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantGuardrailError);
    expect((error as TenantGuardrailError).warnings.map((w) => [w.rule, w.tableId])).toEqual(warnings);
  });

  // A level the resolver returns no IDs for is still covered by the subtree: reading
  // it must fail closed, not be less restricted than a level that has IDs (#375
  // review). Without the level in the scope, the guardrail never checked the root, so
  // filtering it only through its parent's key (or an ancestor) returned its rows.
  it.each([
    {
      name: "an empty child level filtered only by its parent's foreign key",
      resolved: { [agencies]: ["1"], [subAgencies]: ["5"] },
      sql: "SELECT c.email FROM clients c WHERE c.sub_agency_id IN (:tenant_sub_agency_ids)",
      warnings: [["MISSING_TENANT_PREDICATE", clients]],
    },
    {
      name: "empty child levels reached only through the agency",
      resolved: { [agencies]: ["1"] },
      sql:
        "SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id " +
        "JOIN sub_agencies s ON c.sub_agency_id = s.id WHERE s.agency_id IN (:tenant_agency_ids)",
      warnings: [
        ["MISSING_TENANT_PREDICATE", subAgencies],
        ["MISSING_TENANT_PREDICATE", clients],
      ],
    },
  ])("rejects reading $name (strict)", async ({ resolved, sql, warnings }) => {
    const error = await ask({
      question: "list rows",
      schema,
      model: fakeModel,
      dialect: sqlDialect(sql),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => resolved,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantGuardrailError);
    expect((error as TenantGuardrailError).warnings.map((w) => [w.rule, w.tableId])).toEqual(warnings);
  });

  // The expanded scope keeps an empty level as `ids: []`. A custom AskDialect that
  // validates the scope it's handed must accept what ask() hands it (#375 review).
  it("hands a custom AskDialect an expanded scope that validateTenantScope accepts", async () => {
    let validationError: unknown = "not called";
    const dialect: AskDialect = {
      async generate(_question, _schema, _model, options) {
        try {
          validateTenantScope(options!.tenantPolicy!, options!.tenantScope);
          validationError = undefined;
        } catch (e) {
          validationError = e;
        }
        return { sql: ordersByAgency };
      },
    };
    await ask({
      question: "list orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [agencies]: ["1"], [subAgencies]: ["5"] }),
    });

    expect(validationError).toBeUndefined();
  });

  // A host expanding a subtree by hand can say a root is covered but has no IDs. Reading
  // it binds nothing, so it fails closed at binding.
  it("throws UNRESOLVED_TENANT_PLACEHOLDER for a hand-built multi_root entry with no IDs", async () => {
    const error = await ask({
      question: "list clients",
      schema,
      model: fakeModel,
      dialect: sqlDialect("SELECT id FROM clients WHERE id IN (:tenant_client_ids)"),
      tenantScope: {
        access: {
          kind: "multi_root",
          scopes: [
            { tenantRoot: agencies, ids: ["1"] },
            { tenantRoot: clients, ids: [] },
          ],
        },
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("UNRESOLVED_TENANT_PLACEHOLDER");
  });

  // The guardrail must look for the placeholder the prompt and the binder use. For a
  // root labelled without ASCII letters or digits that is the table-name placeholder,
  // so SQL written with `placeholderForTenantRoot(root)` passes: on the root table
  // itself, a scoped table joined to it, and a polymorphic table.
  it.each([
    "SELECT id FROM clients WHERE id IN (:tenant_clients_ids)",
    "SELECT a.id FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN (:tenant_clients_ids)",
    "SELECT id FROM notes WHERE owner_type = 'client' AND owner_id IN (:tenant_clients_ids)",
  ])("accepts %s for a root labelled in Cyrillic (strict)", async (sql) => {
    const policy = schema.tenantPolicy!;
    const cyrillic = {
      ...schema,
      tenantPolicy: {
        ...policy,
        roots: policy.roots.map((root) => (root.id === clients ? { ...root, label: "Клиент" } : root)),
      },
    };
    const clientRoot = cyrillic.tenantPolicy.roots.find((root) => root.id === clients)!;
    expect(placeholderForTenantRoot(clientRoot)).toBe(":tenant_clients_ids");

    const result = await ask({
      question: "list client rows",
      schema: cyrillic,
      model: fakeModel,
      dialect: sqlDialect(sql),
      tenantScope: agencySubtree,
      resolveTenantDescendants: () => ({ [agencies]: ["1"], [subAgencies]: ["5"], [clients]: ["5"] }),
    });

    expect(result.tenantGuardrail?.passed).toBe(true);
    expect(result.sql).toBe(sql.replace(":tenant_clients_ids", "'5'"));
  });

  // Regression guard for silent under-scoping: without a resolver there is no
  // way to reach descendants, so ask() must refuse rather than use the seeds.
  it("throws SUBTREE_NOT_RESOLVABLE without a resolver, before calling the model", async () => {
    const dialect = sqlDialect(ordersByAgency);
    const error = await ask({
      question: "list orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: agencySubtree,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("SUBTREE_NOT_RESOLVABLE");
    expect((error as TenantScopeError).message).toContain(agencies);
    expect(dialect.generate).not.toHaveBeenCalled();
  });

  it.each([
    { name: "an empty array", scope: agencySubtree, resolved: [], message: /returned an array/ },
    { name: 'an array holding ""', scope: agencySubtree, resolved: [""], message: /returned an array/ },
    { name: "null", scope: agencySubtree, resolved: null, message: /must return an object/ },
    { name: "an empty object", scope: agencySubtree, resolved: {}, message: /returned no IDs/ },
    { name: "empty arrays only", scope: agencySubtree, resolved: { [agencies]: [], [clients]: [] }, message: /returned no IDs/ },
    {
      name: "non-string IDs",
      scope: agencySubtree,
      resolved: { [agencies]: [1] },
      message: /IDs for 'table:public\.agencies' must be an array of non-empty strings/,
    },
    {
      name: "an empty-string ID",
      scope: agencySubtree,
      resolved: { [clients]: ["5", ""] },
      message: /IDs for 'table:public\.clients' must be an array of non-empty strings/,
    },
    {
      name: "a non-array level",
      scope: agencySubtree,
      resolved: { [clients]: "5" },
      message: /IDs for 'table:public\.clients' must be an array of non-empty strings/,
    },
    {
      name: "a key that is not a tenant root",
      scope: agencySubtree,
      resolved: { "table:public.orders": ["1"] },
      message: /'table:public\.orders' is not a tenant root/,
    },
    {
      name: "a root outside the subtree",
      scope: subtreeOf(subAgencies, ["5"]),
      resolved: { [agencies]: ["1"], [clients]: ["5"] },
      message: /'table:public\.agencies' is not in the subtree of 'table:public\.sub_agencies'/,
    },
  ])("throws SUBTREE_NOT_RESOLVABLE before calling the model when the resolver returns $name", async ({ scope, resolved, message }) => {
    const dialect = sqlDialect(ordersByAgency);
    const error = await ask({
      question: "list orders",
      schema,
      model: fakeModel,
      dialect,
      tenantScope: scope,
      resolveTenantDescendants: async () => resolved as never,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantScopeError);
    expect((error as TenantScopeError).reason).toBe("SUBTREE_NOT_RESOLVABLE");
    expect((error as TenantScopeError).message).toMatch(message);
    expect(dialect.generate).not.toHaveBeenCalled();
  });

  // ids and multi_root must not change: no resolver needed, and supplying one
  // neither calls it nor alters the output.
  it.each([
    { name: "ids", access: { kind: "ids", tenantRoot: agencies, ids: ["42", "99"] } },
    {
      name: "multi_root",
      access: { kind: "multi_root", scopes: [{ tenantRoot: agencies, ids: ["42", "99"] }] },
    },
  ] satisfies Array<{ name: string; access: TenantScope["access"] }>)(
    "leaves $name access untouched",
    async ({ access }) => {
      const base = { question: "count orders", schema, model: fakeModel, tenantScope: { access } };
      const resolveTenantDescendants = vi.fn(() => ({ [agencies]: ["should-not-appear"] }));
      const without = await ask({ ...base, dialect: sqlDialect(ordersByAgency) });
      const withResolver = await ask({ ...base, dialect: sqlDialect(ordersByAgency), resolveTenantDescendants });

      expect(without.sql).toBe("SELECT id FROM orders WHERE agency_id IN ('42', '99')");
      expect(withResolver).toEqual(without);
      expect(resolveTenantDescendants).not.toHaveBeenCalled();
    },
  );
});
