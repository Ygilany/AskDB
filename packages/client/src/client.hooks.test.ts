/**
 * createAskDb onResolve hook against the fixture schema on the mock-SQL path
 * (no real AI calls), plus the parameterized-query types/binder imported
 * through the @askdb/core barrel.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiRegistry } from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import {
  bindPreparedQuery,
  type BoundQuery,
  type PreparedQuery,
  type QueryParameterBinding,
} from "@askdb/core";
import { createAskDb } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureSchemaPath = join(here, "../../../fixtures/schemas/orders-users.schema");

const fakeRegistry: AiRegistry = {
  hasProvider: () => false,
  resolveAiConfig: () => undefined,
  resolveEmbeddingConfig: () => undefined,
  createLanguageModel: async () => ({}) as never,
  createEmbeddingModel: async () => ({}) as never,
  createLanguageModelFromEnv: async () => undefined,
  createEmbeddingModelFromEnv: async () => undefined,
  keyMissingMessage: (ctx) => `${ctx}: no AI API key configured.`,
} as unknown as AiRegistry;

const mockConfig = {
  structured: { host: {} } as AskDbRuntimeConfig["structured"],
  ai: { aiEnv: {} },
  dev: { mockSql: "SELECT COUNT(*) FROM users" },
  nlToSql: { dialect: undefined },
} as unknown as AskDbRuntimeConfig;

describe("createAskDb hooks and core re-exports", () => {
  it("onResolve hook fires with dialect and modelSource info", async () => {
    let capturedModelSource: string | undefined;
    let capturedDialectSource: string | undefined;

    const client = createAskDb({
      config: mockConfig,
      registry: fakeRegistry,
      schema: { path: fixtureSchemaPath },
      onResolve: ({ dialect, modelSource }) => {
        capturedDialectSource = dialect.source;
        capturedModelSource = modelSource;
      },
    });

    await client.ask("count users");
    expect(capturedModelSource).toBe("mock");
    expect(capturedDialectSource).toBeDefined();
  });

  it("imports PreparedQuery / BoundQuery / bindPreparedQuery from @askdb/core and rebinds", () => {
    const prepared: PreparedQuery = {
      version: 1,
      dialect: "postgres",
      namedSql: "SELECT count(*) FROM cities WHERE state = :state_name",
      parameters: [
        {
          name: "state_name",
          placeholder: ":state_name",
          type: "string",
          cardinality: "one",
          source: "question",
        },
      ],
    };
    const rebound: BoundQuery = bindPreparedQuery(prepared, { state_name: "Utah" });
    expect(rebound.sql).toBe("SELECT count(*) FROM cities WHERE state = 'Utah'");
    expect(rebound.unboundSql).toBe("SELECT count(*) FROM cities WHERE state = $1");
    expect(rebound.params).toEqual(["Utah"]);
    const binding: QueryParameterBinding = rebound.bindings[0]!;
    expect(binding.name).toBe("state_name");
    expect(binding.markers).toEqual(["$1"]);
  });
});
