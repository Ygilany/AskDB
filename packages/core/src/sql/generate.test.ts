import { APICallError, RetryError, type LanguageModel } from "ai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { AskDbError, SqlGenerationError, SqlValidationError, TenantGuardrailError } from "../errors.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import { loadNormalizedSchemaFromJson } from "../schema/parse.js";
import type { NormalizedSchema } from "../schema/types.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import {
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
} from "./dialect-spec.js";
import { generateSelectSql } from "./generate.js";

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

const here = dirname(fileURLToPath(import.meta.url));
const sensitiveFixture = join(here, "../../../../fixtures/schemas/orders-users-sensitive.schema.json");


describe("generateSelectSql (postgres)", () => {
  it("parses fenced SQL and validates SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
    });
    expect(out.sql).toBe("SELECT id FROM users");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("does not send providerOptions to generateText when unset (preserves current behavior)", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
    });
    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect("providerOptions" in call).toBe(false);
  });

  it("forwards deps.providerOptions verbatim to generateText when set", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const providerOptions = { openai: { reasoningEffort: "low" } };
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      providerOptions,
    });
    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.providerOptions).toBe(providerOptions);
  });

  it("normalizes AI SDK 6 input and output token usage", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
      usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
    }));

    const out = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
    });

    expect(out.usage).toEqual({
      promptTokens: 120,
      completionTokens: 24,
      totalTokens: 144,
    });
  });

  it("surfaces SqlValidationError when model returns non-SELECT", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nDELETE FROM users\n```",
    }));
    await expect(
      generateSelectSql(POSTGRES_DIALECT, "nuke", minimalSchema, fakeModel, {
        generateText,
      }),
    ).rejects.toThrow(SqlValidationError);
  });

  it("rejects empty-table schema before calling the model", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT 1\n```",
    }));
    await expect(
      generateSelectSql(POSTGRES_DIALECT, "anything", { tables: [] }, fakeModel, { generateText }),
    ).rejects.toThrow(AskDbError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("appends join-ambiguity context when the schema has a single table but the question sounds like a join", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "How do orders join to users?", minimalSchema, fakeModel, {
      generateText,
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Context (deterministic checks from AskDB");
    expect(prompt).toContain("only one table");
    expect(prompt).toContain("users");
  });

  it("appends unknown-table context when the question echoes FROM/JOIN with a missing table name", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "Run select * from phantom", minimalSchema, fakeModel, {
      generateText,
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('table "phantom"');
    expect(prompt).toContain("users");
  });

  it("lists sensitive column names in the model prompt by default (fixture)", async () => {
    const schema = loadNormalizedSchemaFromJson(readFileSync(sensitiveFixture, "utf8"));
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const debug = vi.fn();
    await generateSelectSql(POSTGRES_DIALECT, "list users", schema, fakeModel, {
      generateText,
      logger: { info: vi.fn(), error: vi.fn(), debug },
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toMatch(/secret_recovery_token/i);
    expect(prompt).toContain("(sensitive)");
    expect(prompt).toContain("email");
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PromptSensitiveIdentifiersListed,
        listedSensitiveColumnCount: 1,
      }),
      expect.any(String),
    );
  });

  it("omits sensitive identifiers from the prompt when deps omit flag is set", async () => {
    const schema = loadNormalizedSchemaFromJson(readFileSync(sensitiveFixture, "utf8"));
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const debug = vi.fn();
    await generateSelectSql(POSTGRES_DIALECT, "list users", schema, fakeModel, {
      generateText,
      omitSensitiveIdentifiersFromNlToSqlPrompt: true,
      logger: { info: vi.fn(), error: vi.fn(), debug },
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toMatch(/secret_recovery_token/i);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AskDbLogEvent.PromptSensitiveRedacted,
        redactedColumnCount: 1,
        sensitiveTableStubCount: 0,
      }),
      expect.any(String),
    );
  });

  it("returns explain metadata when deps.explain is true", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nWITH c AS (SELECT 1 AS n) SELECT n FROM c\n```",
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "count", minimalSchema, fakeModel, {
      generateText,
      explain: true,
    });
    expect(out.sql).toContain("WITH c AS");
    expect(out.explain?.statementKind).toBe("with");
    expect(out.explain?.checksVerified).toContain("no_blocked_write_or_ddl_keywords");
    expect(out.explain?.remediationNote).toContain("Heuristic");
  });
});

describe("generateSelectSql — prompt parameterization per dialect", () => {
  async function capturedPrompt(
    dialect: typeof POSTGRES_DIALECT,
    sqlForModel: string,
  ): Promise<{ system: string; prompt: string }> {
    const generateText = vi.fn(async () => ({ text: `\`\`\`sql\n${sqlForModel}\n\`\`\`` }));
    await generateSelectSql(dialect, "show me users", minimalSchema, fakeModel, {
      generateText,
    });
    const call = generateText.mock.calls[0]![0] as { system: string; prompt: string };
    return { system: call.system, prompt: call.prompt };
  }

  it("MySQL prompt mentions backticks and CONCAT(), system prompt names MySQL", async () => {
    const { system, prompt } = await capturedPrompt(MYSQL_DIALECT, "SELECT id FROM users");
    expect(system).toMatch(/MySQL/);
    expect(prompt).toMatch(/MySQL SELECT/);
    expect(prompt).toMatch(/backtick/i);
    expect(prompt).toMatch(/CONCAT/);
  });

  it("SQLite prompt mentions strftime() and `||` concat, system prompt names SQLite", async () => {
    const { system, prompt } = await capturedPrompt(SQLITE_DIALECT, "SELECT id FROM users");
    expect(system).toMatch(/SQLite/);
    expect(prompt).toMatch(/SQLite SELECT/);
    expect(prompt).toMatch(/strftime/);
    expect(prompt).toMatch(/\|\|/);
  });

  it("SQL Server prompt mentions TOP and OFFSET .. FETCH NEXT", async () => {
    const { system, prompt } = await capturedPrompt(
      SQLSERVER_DIALECT,
      "SELECT TOP (5) id FROM users",
    );
    expect(system).toMatch(/SQL Server/);
    expect(prompt).toMatch(/SQL Server SELECT/);
    expect(prompt).toMatch(/TOP/);
    expect(prompt).toMatch(/OFFSET .* FETCH NEXT/);
  });

  // AI SDK 7 reads `system` only as a deprecated alias of `instructions`; this fails if the
  // installed 7.x stops honoring it. The AI SDK 6 side is held by the consumer-ai6 install smoke.
  it("delivers the `system` prompt to the model through the real AI SDK 7 generateText", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "```sql\nSELECT id FROM users\n```" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const result = await generateSelectSql(POSTGRES_DIALECT, "show me users", minimalSchema, model);
    expect(result.sql).toMatch(/SELECT id FROM users/);
    const prompt = model.doGenerateCalls[0]!.prompt;
    const systemMessage = prompt.find((m) => m.role === "system");
    expect(systemMessage?.content).toEqual(expect.stringContaining("AskDB SQL generator"));
  });
});

describe("generateSelectSql — parameterize prompt + extras", () => {
  it("parameterize false and omitted send the same prompt, without parameterize instructions", async () => {
    const generateTextOff = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const generateTextDefault = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText: generateTextOff,
      parameterize: false,
    });
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText: generateTextDefault,
      // parameterize omitted — generate only enables when explicitly true
    });
    const off = (generateTextOff.mock.calls[0]![0] as { prompt: string }).prompt;
    const def = (generateTextDefault.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(off).toBe(def);
    expect(off).not.toContain("Parameterized output format");
  });

  it("appends parameterize instructions when parameterize is true", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    const prompt = (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Parameterized output format");
    expect(prompt).toContain("sql-unbound");
    expect(prompt).toContain("= ANY(:name)");
  });

  it("returns unboundNamedSql + manifest when the model complies", async () => {
    const generateText = vi.fn(async () => ({
      text: [
        "```sql",
        "SELECT count(*) FROM cities WHERE state = 'colorado'",
        "```",
        "```sql-unbound",
        "SELECT count(*) FROM cities WHERE state = :state_name",
        "```",
        "```json",
        '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
        "```",
      ].join("\n"),
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "how many in colorado", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    expect(out.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(out.unboundNamedSql).toBe("SELECT count(*) FROM cities WHERE state = :state_name");
    expect(out.parameterManifest?.parameters).toHaveLength(1);
  });

  it("drops extras when unbound is missing — bound SQL unaffected", async () => {
    const generateText = vi.fn(async () => ({
      text: "```sql\nSELECT id FROM users\n```",
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    expect(out.sql).toBe("SELECT id FROM users");
    expect(out.unboundNamedSql).toBeUndefined();
    expect(out.parameterManifest).toBeUndefined();
  });

  it("drops extras when a quoted marker makes the placeholder invisible", async () => {
    const generateText = vi.fn(async () => ({
      text: [
        "```sql",
        "SELECT count(*) FROM cities WHERE state = 'colorado'",
        "```",
        "```sql-unbound",
        "SELECT count(*) FROM cities WHERE state = ':state_name'",
        "```",
        "```json",
        '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
        "```",
      ].join("\n"),
    }));
    const out = await generateSelectSql(POSTGRES_DIALECT, "how many in colorado", minimalSchema, fakeModel, {
      generateText,
      parameterize: true,
    });
    expect(out.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(out.unboundNamedSql).toBeUndefined();
    expect(out.parameterManifest).toBeUndefined();
  });
});

describe("generateSelectSql — tenant guardrail checks the returned SQL", () => {
  const multiTenantDir = join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema");
  const agencyScope: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
  };
  // Scoped unbound block, unscoped bound block: the bound one is what callers run.
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

  it("strict: throws when the bound SQL is unscoped even though the unbound SQL is scoped", async () => {
    const schema = loadSchema(multiTenantDir);
    await expect(
      generateSelectSql(POSTGRES_DIALECT, "open orders", schema, fakeModel, {
        generateText: vi.fn(async () => ({ text: disagreeingReply })) as never,
        parameterize: true,
        tenantPolicy: schema.tenantPolicy,
        tenantScope: agencyScope,
      }),
    ).rejects.toThrow(TenantGuardrailError);
  });

  it("warn: reports the unscoped bound SQL as a failure", async () => {
    const schema = loadSchema(multiTenantDir);
    const out = await generateSelectSql(POSTGRES_DIALECT, "open orders", schema, fakeModel, {
      generateText: vi.fn(async () => ({ text: disagreeingReply })) as never,
      parameterize: true,
      tenantPolicy: { ...schema.tenantPolicy!, enforcement: "warn" },
      tenantScope: agencyScope,
    });
    expect(out.tenantGuardrail?.passed).toBe(false);
    expect(out.tenantGuardrail?.warnings.map((w) => w.rule)).toContain("MISSING_TENANT_PREDICATE");
  });

  it("reads the SQL with the target dialect: a Postgres double-quoted tenant column counts", async () => {
    // Without the dialect the guardrail must also accept the MySQL reading, where
    // "agency_id" is a string, and would reject this.
    const schema = loadSchema(multiTenantDir);
    const out = await generateSelectSql(POSTGRES_DIALECT, "orders", schema, fakeModel, {
      generateText: vi.fn(async () => ({
        text: "```sql\nSELECT * FROM orders WHERE \"agency_id\" = :tenant_agency_ids\n```",
      })) as never,
      tenantPolicy: schema.tenantPolicy,
      tenantScope: agencyScope,
    });
    expect(out.tenantGuardrail).toEqual({ passed: true, warnings: [] });
  });

  it("also checks the unbound SQL when it is returned", async () => {
    const schema = loadSchema(multiTenantDir);
    const reply = [
      "```sql",
      "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND status='open'",
      "```",
      "```sql-unbound",
      "SELECT * FROM orders WHERE status = :status",
      "```",
      "```json",
      '{"parameters":[{"name":"status","type":"string","cardinality":"one","value":"open"}]}',
      "```",
    ].join("\n");
    await expect(
      generateSelectSql(POSTGRES_DIALECT, "open orders", schema, fakeModel, {
        generateText: vi.fn(async () => ({ text: reply })) as never,
        parameterize: true,
        tenantPolicy: schema.tenantPolicy,
        tenantScope: agencyScope,
      }),
    ).rejects.toThrow(TenantGuardrailError);
  });

  it("sqlserver: accepts a non-ASCII column the schema spells exactly, and refuses another spelling of it", async () => {
    // The tenant policy names no such column; the schema does, and the guardrail checks against both.
    const loaded = loadSchema(multiTenantDir);
    const schema = {
      ...loaded,
      tables: loaded.tables.map((t) =>
        t.name === "orders"
          ? { ...t, columns: [...t.columns, { id: "table:public.orders#Größe", name: "Größe", type: "text", nullable: true, primaryKey: false }] }
          : t,
      ),
    };
    const reply = (column: string) => vi.fn(async () => ({
      text: `\`\`\`sql\nSELECT [${column}] FROM orders WHERE agency_id = :tenant_agency_ids\n\`\`\``,
    })) as never;
    const deps = { tenantPolicy: loaded.tenantPolicy, tenantScope: agencyScope };
    const out = await generateSelectSql(SQLSERVER_DIALECT, "sizes", schema, fakeModel, { generateText: reply("Größe"), ...deps });
    expect(out.tenantGuardrail).toEqual({ passed: true, warnings: [] });
    // Fullwidth `Größe`, which SQL Server's collation reads as the same column.
    await expect(
      generateSelectSql(SQLSERVER_DIALECT, "sizes", schema, fakeModel, { generateText: reply("Ｇｒößｅ"), ...deps }),
    ).rejects.toThrow(TenantGuardrailError);
  });
});

describe("generateSelectSql — a model call that fails before giving a reason", () => {
  // What Node throws for each address when `localhost` refuses on both ::1 and 127.0.0.1.
  const refused = (address: string): Error =>
    Object.assign(new Error(`connect ECONNREFUSED ${address}:11434`), { code: "ECONNREFUSED", syscall: "connect", address, port: 11434 });
  // The AI SDK's wrapping of that refusal: `Cannot connect to API: ${cause.message}` over the
  // message-less AggregateError, then the retry's "Last error: …". The URL and request carry secrets.
  const cannotConnect = (cause: unknown): APICallError =>
    new APICallError({
      message: `Cannot connect to API: ${cause instanceof Error ? cause.message : ""}`,
      cause,
      url: "http://admin:S3cret@localhost:11434/v1/chat/completions",
      requestBodyValues: { model: "llama3", apiKey: "sk-S3cret", messages: [] },
      isRetryable: true,
    });
  const bothRefused = (): AggregateError => new AggregateError([refused("::1"), refused("127.0.0.1")], "");
  const afterRetries = (last: unknown): RetryError =>
    new RetryError({
      message: `Failed after 3 attempts. Last error: ${last instanceof Error ? last.message : ""}`,
      reason: "maxRetriesExceeded",
      errors: [last, last, last],
    });

  async function failWith(error: unknown): Promise<{ thrown: unknown; logged: unknown }> {
    const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const generateText = vi.fn(async () => {
      throw error;
    });
    const thrown = await generateSelectSql(POSTGRES_DIALECT, "list users", minimalSchema, fakeModel, {
      generateText,
      logger: logger as never,
    }).catch((e: unknown) => e);
    const failed = logger.error.mock.calls.find(([entry]) => (entry as { event?: string }).event === AskDbLogEvent.PipelineFailed);
    return { thrown, logged: (failed?.[0] as { errMessage?: unknown } | undefined)?.errMessage };
  }

  it.each([
    [
      "the retried call, refused on both addresses",
      () => afterRetries(cannotConnect(bothRefused())),
      "Model call failed: Failed after 3 attempts. Last error: Cannot connect to API: ECONNREFUSED [::1]:11434; ECONNREFUSED 127.0.0.1:11434",
    ],
    [
      "a single call, refused on both addresses",
      () => cannotConnect(bothRefused()),
      "Model call failed: Cannot connect to API: ECONNREFUSED [::1]:11434; ECONNREFUSED 127.0.0.1:11434",
    ],
    [
      "an inner error whose text carries a credential: only its code is used",
      () => cannotConnect(new AggregateError([Object.assign(new Error("reset by https://admin:S3cret@llm.internal"), { code: "ECONNRESET" })], "")),
      "Model call failed: Cannot connect to API: ECONNRESET",
    ],
    [
      "an inner error with no code: its name",
      () => cannotConnect(new AggregateError([new TypeError("https://admin:S3cret@llm.internal")], "")),
      "Model call failed: Cannot connect to API: TypeError",
    ],
    ["a message that already gives its reason, unchanged", () => new Error("Rate limit reached: retry in 20s"), "Model call failed: Rate limit reached: retry in 20s"],
    ["an error whose message isn't a string, as before", () => Object.assign(new Error(), { message: null }), "Model call failed: null"],
  ])("names the reason for %s, in the error and in the pipeline.failed log", async (_name, makeError, expected) => {
    const { thrown, logged } = await failWith(makeError());
    expect(thrown).toBeInstanceOf(SqlGenerationError);
    expect((thrown as Error).message).toBe(expected);
    expect(logged).toBe(expected);
    expect(`${(thrown as Error).message}${String(logged)}`).not.toMatch(/S3cret|admin|llm\.internal/);
  });
});
