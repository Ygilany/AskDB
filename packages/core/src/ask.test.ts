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

const minimalSchema: NormalizedSchema = {
  tables: [{ name: "users", columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }] }],
};

const fakeModel = {} as LanguageModel;

const here = dirname(fileURLToPath(import.meta.url));
const v2Dir = join(here, "../../../fixtures/schemas/orders-users.schema");

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
  it("emits pipeline mode before generation and does not post_execute without execute", async () => {
    const info = vi.fn();
    await ask({
      question: "count users",
      schema: minimalSchema,
      model: fakeModel,
      dialect: cannedDialect,
      execute: false,
      mode: "bounded_results",
      logger: { info, error: vi.fn() },
    });

    const modes = info.mock.calls.filter((c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelineMode);
    expect(modes.length).toBeGreaterThanOrEqual(1);
    expect(modes[0]![0]).toMatchObject({ mode: "bounded_results" });

    const post = info.mock.calls.filter(
      (c) => (c[0] as { event?: string })?.event === AskDbLogEvent.PipelinePostExecute,
    );
    expect(post).toHaveLength(0);
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
      execute: false,
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
      execute: false,
      deps: { generateText: baselineGenerateText },
    });

    await ask({
      question: "How many users?",
      schema,
      model: fakeModel,
      dialect: promptForwardingDialect,
      execute: false,
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
      execute: false,
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
      execute: false,
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
