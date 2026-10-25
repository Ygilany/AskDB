import type { LanguageModel } from "ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ask, type AskDialect, type AskDialectInput } from "./ask.js";
import { placeholderForTenantRoot, validateTenantScope } from "./index.js";
import {
  AskDbError,
  SchemaParseError,
  SensitiveReferenceError,
  SqlValidationError,
  TenantGuardrailError,
  TenantScopeError,
  UnknownDialectError,
} from "./errors.js";
import { generateSelectSql } from "./sql/generate.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import { formatSchemaForNlToSql } from "./schema/normalize.js";
import type { NormalizedSchema } from "./schema/types.js";
import { formatSchemaV2ForNlToSql } from "./schema/v2/index.js";
import { loadSchema, loadSchemaFromJson } from "./schema/v2/loader.js";
import type { NormalizedSchemaV2 } from "./schema/v2/normalized.js";
import { POSTGRES_DIALECT, SQLITE_DIALECT, type DialectSpec } from "./sql/dialect-spec.js";
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
      system: "test",
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

describe("ask — abortSignal", () => {
  it("aborting the caller's controller aborts the model call and rejects with SqlGenerationError", async () => {
    // Without a signal the model answers at once, so ask() only rejects if the
    // caller's signal reached doGenerate and aborting it cancelled the call.
    const doGenerate = vi.fn(async (opts: { abortSignal?: AbortSignal }) => {
      const signal = opts.abortSignal;
      if (signal) {
        await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return {
        content: [{ type: "text", text: "```sql\nSELECT 1\n```" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    });
    const model = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "test",
      supportedUrls: {},
      doGenerate,
      doStream: vi.fn(),
    } as unknown as LanguageModel;
    const controller = new AbortController();

    const pending = ask({
      question: "count users",
      schema: minimalSchema,
      model,
      dialect: "postgres",
      parameterize: false,
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(doGenerate).toHaveBeenCalledTimes(1));
    const reason = new Error("caller aborted");
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({ name: "SqlGenerationError", cause: reason });
    expect(doGenerate.mock.calls[0]![0].abortSignal?.aborted).toBe(true);
  });

  it("passes abortSignal to a custom dialect's generate() options", async () => {
    let seen: { abortSignal?: AbortSignal } | undefined;
    const capturingDialect: AskDialect = {
      async generate(_question, _schema, _model, options) {
        seen = options;
        return { sql: "SELECT COUNT(*) AS n FROM users" };
      },
    };
    const controller = new AbortController();

    await ask({
      question: "count users",
      schema: minimalSchema,
      model: fakeModel,
      dialect: capturingDialect,
      abortSignal: controller.signal,
    });

    expect(seen?.abortSignal).toBe(controller.signal);
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

describe("ask — table names in the prompt per dialect (#447)", () => {
  function schemaOf(...tables: Array<[namespace: string, table: string]>) {
    return loadSchemaFromJson(
      JSON.stringify({
        version: 2,
        schemaId: "namespaces",
        tables: tables.map(([ns, name]) => ({
          id: `table:${ns}.${name}`,
          name,
          schema: ns,
          columns: [{ id: `table:${ns}.${name}#id`, name: "id", type: "integer", nullable: false, primaryKey: true }],
        })),
      }),
    );
  }
  // `public` as the only namespace: what SQLite and single-database MySQL/MariaDB connectors emit.
  const singleNamespace = schemaOf(["public", "orders"], ["public", "users"]);
  // A MySQL database list that includes a database actually named `public`.
  const databaseList = schemaOf(["public", "users"], ["sales", "orders"]);
  const oldRule = "- Use identifiers from the schema below; qualify table names where it helps readability.";

  function retrieverFor(...tableIds: string[]) {
    return vi.fn(async () =>
      tableIds.map((ref) => ({
        id: `chunk:${ref}`,
        score: 1,
        payload: { id: `chunk:${ref}`, type: "table" as const, text: `# ${ref}`, schemaId: "namespaces", refs: [ref], sensitive: false },
      })),
    );
  }

  async function promptFor(
    dialect: AskDialectInput,
    schema: NormalizedSchemaV2,
    extra: Partial<Parameters<typeof ask>[0]> = {},
  ): Promise<string> {
    const generateText = vi.fn(async () => ({ text: "```sql\nSELECT COUNT(*) FROM users\n```" }));
    await ask({
      question: "How many users?",
      schema,
      model: fakeModel,
      dialect,
      parameterize: false,
      deps: { generateText: generateText as never },
      ...extra,
    });
    return (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
  }

  it.each(["sqlite", "mysql", "mariadb"] as const)(
    "%s lists tables of its only namespace `public` unqualified and tells the model `public` is not a schema",
    async (dialect) => {
      const prompt = await promptFor(dialect, singleNamespace);
      expect(prompt).toMatch(/^TABLE users$/m);
      expect(prompt).toMatch(/^TABLE orders$/m);
      expect(prompt).not.toContain("TABLE public.");
      expect(prompt).not.toContain(oldRule);
      expect(prompt).toContain("never write `public.<table>`");
    },
  );

  it.each([
    ["postgres", /^TABLE public\.users$/m],
    ["cockroachdb", /^TABLE public\.users$/m],
    // `public` is a reserved word in T-SQL (#451).
    ["sqlserver", /^TABLE \[public\]\.users$/m],
  ] as const)(
    "%s keeps every table qualified with its schema",
    async (dialect, listed) => {
      const prompt = await promptFor(dialect, singleNamespace);
      expect(prompt).toMatch(listed);
      expect(prompt).toContain(oldRule);
      expect(prompt).not.toContain("never write");
    },
  );

  it.each([
    ["full schema", {}],
    ["retrieved schema", { retriever: retrieverFor("table:public.users", "table:sales.orders"), totalSchemaChunkCount: 100 }],
  ] as const)("mysql keeps a real database named `public` qualified when it isn't the only namespace (%s)", async (_path, extra) => {
    const prompt = await promptFor("mysql", databaseList, extra);
    expect(prompt).toMatch(/^TABLE public\.users$/m);
    expect(prompt).toMatch(/^TABLE sales\.orders$/m);
    expect(prompt).toContain(oldRule);
    expect(prompt).not.toContain("never write");
  });

  it("sqlite lists retrieved tables unqualified too", async () => {
    const retriever = retrieverFor("table:public.users");
    const prompt = await promptFor("sqlite", singleNamespace, { retriever, totalSchemaChunkCount: 100 });
    expect(retriever).toHaveBeenCalledOnce();
    expect(prompt).toMatch(/^TABLE users$/m);
    expect(prompt).not.toContain("TABLE public.");
    expect(prompt).toContain("never write `public.<table>`");
  });

  it("reads the namespace from a custom DialectSpec", async () => {
    const spec: DialectSpec = { ...SQLITE_DIALECT, unqualifiedNamespace: "main" };
    for (const extra of [{}, { retriever: retrieverFor("table:main.users"), totalSchemaChunkCount: 100 }]) {
      const prompt = await promptFor(spec, schemaOf(["main", "users"]), extra);
      expect(prompt).toMatch(/^TABLE users$/m);
      expect(prompt).toContain("never write `main.<table>`");
      expect(prompt).not.toContain("`public`");
    }
  });
});

describe("ask — identifier quoting in the prompt per dialect (#451)", () => {
  // `order` and `group` are reserved on every built-in engine; `payment` and `order_id` on none.
  function schemaOf(namespace: string) {
    return loadSchemaFromJson(
      JSON.stringify({
        version: 2,
        schemaId: "quoting",
        tables: ["order", "payment"].map((name) => ({
          id: `table:${namespace}.${name}`,
          name,
          schema: namespace,
          columns: [
            { id: `table:${namespace}.${name}#${name}_id`, name: `${name}_id`, type: "integer", nullable: false, primaryKey: true },
            { id: `table:${namespace}.${name}#group`, name: "group", type: "text", nullable: true, primaryKey: false },
          ],
        })),
      }),
    );
  }
  const retrieved = {
    retriever: vi.fn(async () =>
      ["order", "payment"].map((name) => ({
        id: `chunk:${name}`,
        score: 1,
        payload: { id: `chunk:${name}`, type: "table" as const, text: `# ${name}`, schemaId: "quoting", refs: [`table:billing.${name}`], sensitive: false },
      })),
    ),
    totalSchemaChunkCount: 100,
  };

  async function promptFor(
    dialect: AskDialectInput,
    schema: NormalizedSchemaV2,
    extra: Partial<Parameters<typeof ask>[0]> = {},
  ): Promise<string> {
    const generateText = vi.fn(async () => ({ text: "```sql\nSELECT 1\n```" }));
    await ask({
      question: "How many orders?",
      schema,
      model: fakeModel,
      dialect,
      parameterize: false,
      deps: { generateText: generateText as never },
      ...extra,
    });
    return (generateText.mock.calls[0]![0] as { prompt: string }).prompt;
  }

  describe.each([
    ["full schema", {}],
    ["retrieved schema", retrieved],
  ] as const)("%s", (_path, extra) => {
    it.each([
      ["postgres", 'TABLE billing."order"', '  - "group" text', '`"schema"."table"`'],
      ["cockroachdb", 'TABLE billing."order"', '  - "group" text', '`"schema"."table"`'],
      ["mysql", "TABLE billing.`order`", "  - `group` text", "`` `schema`.`table` ``"],
      ["mariadb", "TABLE billing.`order`", "  - `group` text", "`` `schema`.`table` ``"],
      ["sqlserver", "TABLE billing.[order]", "  - [group] text", "`[schema].[table]`"],
    ] as const)("%s lists reserved words quoted and says to quote a qualified name part by part", async (dialect, table, column, rule) => {
      const prompt = await promptFor(dialect, schemaOf("billing"), extra);
      expect(prompt).toMatch(new RegExp(`^${escapeRegExp(table)}$`, "m"));
      expect(prompt).toContain(`${column} (NULL)`);
      expect(prompt).toMatch(/^TABLE billing\.payment$/m);
      expect(prompt).toMatch(/^ {2}- order_id integer \(PK NOT NULL\)$/m);
      expect(prompt).toContain(`- When you quote a qualified name, quote each part separately: ${rule}.`);
    });
  });

  it("sqlite lists a reserved table name quoted and leaves out the qualified-name rule", async () => {
    const prompt = await promptFor("sqlite", schemaOf("public"));
    expect(prompt).toMatch(/^TABLE "order"$/m);
    expect(prompt).toMatch(/^TABLE payment$/m);
    expect(prompt).toContain('  - "group" text (NULL)');
    expect(prompt).not.toContain("quote each part separately");
  });

  it("leaves the qualified-name rule out of a v1 schema's prompt, which lists no schemas", async () => {
    const prompt = await promptFor("postgres", minimalSchema as never);
    expect(prompt).not.toContain("quote each part separately");
  });

  it("postgres lists a mixed-case table and column quoted, as Prisma creates them; mysql leaves them bare", async () => {
    const prisma = loadSchemaFromJson(
      JSON.stringify({
        version: 2,
        schemaId: "prisma",
        tables: [
          {
            id: "table:public.Post",
            name: "Post",
            schema: "public",
            columns: [{ id: "table:public.Post#createdAt", name: "createdAt", type: "timestamp", nullable: false, primaryKey: false }],
          },
        ],
      }),
    );
    const postgres = await promptFor("postgres", prisma);
    expect(postgres).toMatch(/^TABLE public\."Post"$/m);
    expect(postgres).toContain('  - "createdAt" timestamp (NOT NULL)');
    const mysql = await promptFor("mysql", prisma);
    expect(mysql).toMatch(/^TABLE Post$/m);
    expect(mysql).toContain("  - createdAt timestamp (NOT NULL)");
  });

  it("lists columns quoted with omitSensitiveIdentifiersFromNlToSqlPrompt too", async () => {
    const prompt = await promptFor("postgres", schemaOf("billing"), { omitSensitiveIdentifiersFromNlToSqlPrompt: true });
    expect(prompt).toMatch(/^TABLE billing\."order"$/m);
    expect(prompt).toContain('  - "group" text (NULL)');
  });

  it.each([
    ["postgres", 'SELECT "copy" FROM public."call"'],
    ["cockroachdb", 'SELECT "copy" FROM public."call"'],
    ["mysql", "SELECT `copy` FROM `call`"],
    ["mariadb", "SELECT `copy` FROM `call`"],
    ["sqlserver", "SELECT [copy] FROM [public].[call]"],
    ["sqlite", 'SELECT "copy" FROM "call"'],
  ] as const)(
    "%s: SQL that copies a listed name AskDB's validator rejects bare (`copy`, `call`) passes validation",
    async (dialect, expected) => {
      const schema = loadSchemaFromJson(
        JSON.stringify({
          version: 2,
          schemaId: "validator-words",
          tables: [
            {
              id: "table:public.call",
              name: "call",
              schema: "public",
              columns: [{ id: "table:public.call#copy", name: "copy", type: "text", nullable: true, primaryKey: false }],
            },
          ],
        }),
      );
      const generateText = vi.fn(async ({ prompt }: { prompt: string }) => {
        const table = /^TABLE (\S+)$/m.exec(prompt)![1];
        const column = /^ {2}- (\S+) text/m.exec(prompt)![1];
        return { text: "```sql\nSELECT " + column + " FROM " + table + "\n```" };
      });
      const result = await ask({
        question: "What is the copy of each call?",
        schema,
        model: fakeModel,
        dialect,
        parameterize: false,
        deps: { generateText: generateText as never },
      });
      expect(result.sql).toBe(expected);
    },
  );

  it("quotes for a custom DialectSpec by its id", async () => {
    const spec: DialectSpec = { ...POSTGRES_DIALECT, displayName: "Amazon Redshift" };
    const prompt = await promptFor(spec, schemaOf("billing"));
    expect(prompt).toMatch(/^TABLE billing\."order"$/m);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    expect(result).toEqual({ sql: "SELECT id FROM users", verdict: { outcome: "allow", findings: [] } });
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

describe("ask — a model's trailing semicolon is kept (#477)", () => {
  it("returns sql ending in ; only when the model's reply did", async () => {
    const run = (text: string) =>
      ask({
        question: "list users",
        schema: minimalSchema,
        model: fakeModel,
        dialect: "postgres",
        deps: { generateText: vi.fn(async () => ({ text })) },
      });
    expect((await run("```sql\nSELECT id FROM users;\n```")).sql).toBe("SELECT id FROM users;");
    expect((await run("```sql\nSELECT id FROM users\n```")).sql).toBe("SELECT id FROM users");
  });

  it("still rejects a second statement after the semicolon", async () => {
    await expect(
      ask({
        question: "list users",
        schema: minimalSchema,
        model: fakeModel,
        dialect: "postgres",
        deps: { generateText: vi.fn(async () => ({ text: "```sql\nSELECT 1; SELECT 2\n```" })) },
      }),
    ).rejects.toMatchObject({ rule: "SQL_MULTI_STATEMENT" });
  });

  const reply = [
    "```sql",
    "SELECT count(*) FROM orders WHERE status = 'paid' AND agency_id = :tenant_agency_ids;",
    "```",
    "```sql-unbound",
    "SELECT count(*) FROM orders WHERE status = :status_name AND agency_id = :tenant_agency_ids;",
    "```",
    "```json",
    '{"parameters":[{"name":"status_name","type":"string","cardinality":"one","value":"paid"}]}',
    "```",
  ].join("\n");

  it("keeps it in sql, unboundSql and preparedQuery.namedSql of a parameterized reply", async () => {
    const result = await ask({
      question: "how many paid orders",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      deps: {
        generateText: vi.fn(async () => ({
          text: [
            "```sql",
            "SELECT count(*) FROM cities WHERE state = 'colorado';",
            "```",
            "```sql-unbound",
            "SELECT count(*) FROM cities WHERE state = :state_name;",
            "```",
            "```json",
            '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
            "```",
          ].join("\n"),
        })),
      },
    });
    expect(result.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado';");
    expect(result.unboundSql).toBe("SELECT count(*) FROM cities WHERE state = $1;");
    expect(result.params).toEqual(["colorado"]);
    expect(result.preparedQuery?.namedSql).toBe("SELECT count(*) FROM cities WHERE state = :state_name;");
  });

  it("compares the parameterized blocks in linear time, however long a whitespace run the model writes", async () => {
    const gap = " ".repeat(100_000);
    const started = Date.now();
    const result = await ask({
      question: "How many cities does Colorado have?",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      deps: {
        generateText: vi.fn(async () => ({
          text: [
            "```sql",
            `SELECT count(*) FROM cities WHERE${gap}state = 'colorado';`,
            "```",
            "```sql-unbound",
            `SELECT count(*) FROM cities WHERE${gap}state = :state_name;`,
            "```",
            "```json",
            '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
            "```",
          ].join("\n"),
        })),
      },
    });
    expect(result.params).toEqual(["colorado"]);
    // A backtracking terminator pattern takes tens of seconds on this reply.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it.each([
    { bound: "'colorado' ;", unbound: ":state_name;", sql: "'colorado' ;", unboundSql: "$1;" },
    { bound: "'colorado';", unbound: ":state_name", sql: "'colorado';", unboundSql: "$1" },
    { bound: "'colorado'", unbound: ":state_name ;", sql: "'colorado'", unboundSql: "$1 ;" },
  ])("keeps the parameterized extras when the two blocks end differently ($bound / $unbound)", async (c) => {
    const result = await ask({
      question: "How many cities does Colorado have?",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      deps: {
        generateText: vi.fn(async () => ({
          text: [
            "```sql",
            `SELECT count(*) FROM cities WHERE state = ${c.bound}`,
            "```",
            "```sql-unbound",
            `SELECT count(*) FROM cities WHERE state = ${c.unbound}`,
            "```",
            "```json",
            '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
            "```",
          ].join("\n"),
        })),
      },
    });
    expect(result.sql).toBe(`SELECT count(*) FROM cities WHERE state = ${c.sql}`);
    expect(result.unboundSql).toBe(`SELECT count(*) FROM cities WHERE state = ${c.unboundSql}`);
    expect(result.params).toEqual(["colorado"]);
  });

  it.each([
    {
      dialect: "postgres" as const,
      mode: "sql-only" as const,
      sql: "status = 'paid' AND agency_id IN ('42', '99');",
      unbound: "status = $1 AND agency_id IN ('42', '99');",
    },
    {
      dialect: "postgres" as const,
      mode: "sql-params" as const,
      sql: "status = 'paid' AND agency_id IN ($1, $2);",
      unbound: "status = $1 AND agency_id IN ($2, $3);",
    },
    {
      dialect: "mysql" as const,
      mode: "sql-params" as const,
      sql: "status = 'paid' AND agency_id IN (?, ?);",
      unbound: "status = ? AND agency_id IN (?, ?);",
    },
  ])("$dialect $mode: the tenant guardrail passes and substitutes a placeholder right before it", async (c) => {
    const result = await ask({
      question: "how many paid orders",
      schema: loadSchema(multiTenantDir),
      model: fakeModel,
      dialect: c.dialect,
      tenantScope: { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] } },
      tenantSqlMode: c.mode,
      deps: { generateText: vi.fn(async () => ({ text: reply })) },
    });
    const prefix = "SELECT count(*) FROM orders WHERE ";
    expect(result.tenantGuardrail?.passed).toBe(true);
    expect(result.sql).toBe(prefix + c.sql);
    expect(result.unboundSql).toBe(prefix + c.unbound);
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
    expect(result).toEqual({ sql: "DELETE FROM orders", verdict: { outcome: "allow", findings: [] } });
  });
});

describe("ask — one guardrail decision point (ADR 0010)", () => {
  const strict = loadSchema(multiTenantDir);
  const warn = { ...strict, tenantPolicy: { ...strict.tenantPolicy!, enforcement: "warn" as const } };
  const replying = (text: string) => ({ generateText: vi.fn(async () => ({ text })) });
  // Unscoped (tenant), reads clients.email (sensitive in the fixture).
  const leaky = "SELECT o.id, c.email FROM orders o JOIN clients c ON o.client_id = c.id";

  it("runs every check before throwing: the TenantGuardrailError's verdict holds the sensitive finding", async () => {
    const error = await ask({
      question: "q",
      schema: strict,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      sensitiveGuardrailMode: "strict",
      parameterize: false,
      deps: replying("```sql\n" + leaky + "\n```"),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TenantGuardrailError);
    const checks = (error as TenantGuardrailError).verdict?.findings.map((f) => [f.check, f.rule]);
    expect(checks).toContainEqual(["tenant", "MISSING_TENANT_PREDICATE"]);
    expect(checks).toContainEqual(["sensitive", "SENSITIVE_COLUMN_REFERENCED"]);
  });

  it("throws SqlValidationError ahead of the tenant and sensitive errors, with their findings", async () => {
    const error = await ask({
      question: "q",
      schema: strict,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      sensitiveGuardrailMode: "strict",
      parameterize: false,
      deps: replying("```sql\n" + leaky + "; DELETE FROM orders\n```"),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SqlValidationError);
    expect((error as SqlValidationError).rule).toBe("SQL_MULTI_STATEMENT");
    expect(new Set((error as SqlValidationError).verdict?.findings.map((f) => f.check))).toEqual(
      new Set(["read-only", "tenant", "sensitive"]),
    );
  });

  it("refuses non-SELECT SQL from a built-in dialect whatever the modes", async () => {
    const error = await ask({
      question: "q",
      schema: warn,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      sensitiveGuardrailMode: "off",
      parameterize: false,
      deps: replying("```sql\nDELETE FROM orders WHERE agency_id = :tenant_agency_ids\n```"),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SqlValidationError);
    expect((error as SqlValidationError).rule).toBe("SQL_NOT_SELECT_OR_WITH");
  });

  it("drops the reuse artifacts when the sql-unbound block fails the read-only check, and still returns sql", async () => {
    const result = await ask({
      question: "q",
      schema: minimalSchema,
      model: fakeModel,
      dialect: "postgres",
      deps: replying(
        [
          "```sql",
          "SELECT id FROM users WHERE id = 1",
          "```",
          "```sql-unbound",
          "SELECT id FROM users WHERE id = :user_id; DELETE FROM users",
          "```",
          "```json",
          '{"parameters":[{"name":"user_id","type":"number","cardinality":"one","value":1}]}',
          "```",
        ].join("\n"),
      ),
    });

    expect(result.sql).toBe("SELECT id FROM users WHERE id = 1");
    expect(result.preparedQuery).toBeUndefined();
    expect(result.unboundSql).toBeUndefined();
    expect(result.verdict).toEqual({ outcome: "allow", findings: [] });
  });

  it("returns no preparedQuery for a template whose placeholder is glued to an identifier", async () => {
    const result = await ask({
      question: "q",
      schema: warn,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      deps: replying(
        reply3(
          "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'open'OR 1=1",
          "SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND status = :statusOR 1=1",
        ),
      ),
    });

    expect(result.preparedQuery).toBeUndefined();
    expect(result.unboundSql).toBeUndefined();
  });

  it("turns a custom generator's failure without warnings into an UNPROVABLE_SCOPE tenant finding", async () => {
    const dialect: AskDialect = {
      generate: async () => ({
        sql: "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids",
        tenantGuardrail: { passed: false, warnings: [] },
      }),
    };
    const result = await ask({ question: "q", schema: warn, model: fakeModel, dialect, tenantScope: agencyScope });

    expect(result.verdict.outcome).toBe("warn");
    expect(result.verdict.findings).toEqual([
      expect.objectContaining({ check: "tenant", form: "generator", rule: "UNPROVABLE_SCOPE" }),
    ]);
    expect(result.tenantGuardrail?.passed).toBe(false);
  });

  it("generateSelectSql() returns the same read-only and tenant findings as ask() for the same reply", async () => {
    const text = reply3(
      "SELECT * FROM orders WHERE status = 'open'",
      "SELECT * FROM orders WHERE status = :status",
    );
    const viaAsk = await ask({
      question: "q",
      schema: warn,
      model: fakeModel,
      dialect: "postgres",
      tenantScope: agencyScope,
      deps: replying(text),
    });
    const viaGenerate = await generateSelectSql(POSTGRES_DIALECT, "q", warn, fakeModel, {
      generateText: replying(text).generateText as never,
      tenantPolicy: warn.tenantPolicy,
      tenantScope: agencyScope,
      parameterize: true,
    });

    expect(viaGenerate.verdict.outcome).toBe("warn");
    expect(viaGenerate.verdict).toEqual(viaAsk.verdict);
    expect(viaAsk.verdict.findings.map((f) => [f.check, f.form, f.rule])).toEqual([
      ["tenant", "sql", "MISSING_TENANT_PREDICATE"],
      ["tenant", "template", "MISSING_TENANT_PREDICATE"],
    ]);
  });
});

function reply3(sql: string, unbound: string): string {
  return [
    "```sql",
    sql,
    "```",
    "```sql-unbound",
    unbound,
    "```",
    "```json",
    '{"parameters":[{"name":"status","type":"string","cardinality":"one","value":"open"}]}',
    "```",
  ].join("\n");
}

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
