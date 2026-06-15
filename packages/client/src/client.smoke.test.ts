/**
 * Consumer smoke test — exercises createAskDb as an external consumer would:
 * import from the public surface, build a client from a config + registry, and
 * verify the full ask() path end-to-end using mock SQL (no real AI calls).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiRegistry } from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import { createAskDb, type AskDbClient, type CreateAskDbOptions } from "./index.js";

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

describe("@askdb/client smoke test", () => {
  it("createAskDb is importable and returns an AskDbClient", () => {
    const options: CreateAskDbOptions = {
      config: mockConfig,
      registry: fakeRegistry,
      schema: { path: fixtureSchemaPath },
    };
    const client: AskDbClient = createAskDb(options);
    expect(typeof client.ask).toBe("function");
    expect(typeof client.reload).toBe("function");
  });

  it("ask() resolves SQL end-to-end via mock SQL path", async () => {
    const client = createAskDb({
      config: mockConfig,
      registry: fakeRegistry,
      schema: { path: fixtureSchemaPath },
    });
    const result = await client.ask("how many users are there?");
    expect(result.sql).toBe("SELECT COUNT(*) FROM users");
  });

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

  it("reload() resets caches without throwing", async () => {
    const client = createAskDb({
      config: mockConfig,
      registry: fakeRegistry,
      schema: { path: fixtureSchemaPath },
    });
    await client.ask("q1");
    client.reload();
    const result = await client.ask("q2");
    expect(result.sql).toBe("SELECT COUNT(*) FROM users");
  });
});
