import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AiProviderAdapter, AiRegistry } from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import type { AnyNormalizedSchema } from "@askdb/core";
import { loadSchema, loadSchemaFromJson } from "@askdb/core";
import type { DialectResolution } from "./client.js";
import { createAskDb } from "./client.js";
import {
  DialectNotSupportedError,
  ModelNotConfiguredError,
  SchemaLoadError,
  SchemaNotConfiguredError,
} from "./errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureSchemaPath = join(here, "../../../fixtures/schemas/orders-users.schema");

const minimalV2Json = JSON.stringify({
  version: 2,
  schemaId: "test-schema",
  tables: [
    {
      id: "table:public.users",
      name: "users",
      schema: "public",
      sensitive: false,
      columns: [
        { id: "table:public.users#id", name: "id", type: "uuid", nullable: false, primaryKey: true, sensitive: false },
      ],
    },
  ],
});

const postgresProviderV2Json = JSON.stringify({
  version: 2,
  schemaId: "test-postgres",
  provider: "postgres",
  tables: [
    {
      id: "table:public.t",
      name: "t",
      schema: "public",
      sensitive: false,
      columns: [
        { id: "table:public.t#id", name: "id", type: "int", nullable: false, primaryKey: true, sensitive: false },
      ],
    },
  ],
});

const unsupportedProviderV2Json = JSON.stringify({
  version: 2,
  schemaId: "test-snowflake",
  provider: "snowflake",
  tables: [
    {
      id: "table:public.t",
      name: "t",
      schema: "public",
      sensitive: false,
      columns: [
        { id: "table:public.t#id", name: "id", type: "int", nullable: false, primaryKey: true, sensitive: false },
      ],
    },
  ],
});

function makeRegistry(overrides?: Partial<AiRegistry>): AiRegistry {
  return {
    hasProvider: vi.fn(() => false),
    resolveAiConfig: vi.fn(() => undefined),
    resolveEmbeddingConfig: vi.fn(() => undefined),
    createLanguageModel: vi.fn(async () => ({}) as never),
    createEmbeddingModel: vi.fn(async () => ({}) as never),
    createLanguageModelFromEnv: vi.fn(async () => undefined),
    createEmbeddingModelFromEnv: vi.fn(async () => undefined),
    keyMissingMessage: vi.fn((ctx: string) => `${ctx}: no AI API key configured.`),
    ...overrides,
  } as unknown as AiRegistry;
}

function makeConfig(overrides?: {
  schemaPath?: string;
  schemaJson?: string;
  mockSql?: string;
  dialect?: AskDbRuntimeConfig["nlToSql"]["dialect"];
  envSchemaPath?: string;
  envSchemaJson?: string;
}): AskDbRuntimeConfig {
  return {
    structured: {
      host: {
        schemaPath: overrides?.schemaPath,
        schemaJson: overrides?.schemaJson,
      },
    } as AskDbRuntimeConfig["structured"],
    ai: {
      aiEnv: {
        ASKDB_SCHEMA_PATH: overrides?.envSchemaPath,
        ASKDB_SCHEMA_JSON: overrides?.envSchemaJson,
      },
    },
    dev: { mockSql: overrides?.mockSql },
    nlToSql: { dialect: overrides?.dialect },
  } as unknown as AskDbRuntimeConfig;
}

describe("createAskDb", () => {
  it("1. schema from createAskDb({ schema: { path } }) - loads and uses the schema", async () => {
    const config = makeConfig({ mockSql: "SELECT 1" });
    const registry = makeRegistry();
    const askdb = createAskDb({
      config,
      registry,
      schema: { path: fixtureSchemaPath },
    });
    const result = await askdb.ask("list all users");
    expect(result.sql).toBe("SELECT 1");
    expect(registry.createLanguageModelFromEnv).not.toHaveBeenCalled();
  });

  it("2. mock SQL path - returns mock SQL without calling registry", async () => {
    const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
    const config = makeConfig({ mockSql: "SELECT 1" });
    const registry = makeRegistry();
    const askdb = createAskDb({ config, registry, schema: { schema: preloaded } });
    const result = await askdb.ask("count users");
    expect(result.sql).toBe("SELECT 1");
    expect(registry.createLanguageModelFromEnv).not.toHaveBeenCalled();
  });

  it("3. model override - uses override model/deps without calling registry", async () => {
    const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
    const config = makeConfig();
    const registry = makeRegistry();
    const sentinelModel = { kind: "sentinel-model" } as never;
    const askdb = createAskDb({ config, registry, schema: { schema: preloaded } });
    const result = await askdb.ask("q", {
      model: sentinelModel,
      deps: { generateText: async () => ({ text: "SELECT 2" } as any) as any },
    });
    expect(result.sql).toBe("SELECT 2");
    expect(registry.createLanguageModelFromEnv).not.toHaveBeenCalled();
  });

  describe("4. dialect precedence", () => {
    const schemaWithProvider = loadSchemaFromJson(postgresProviderV2Json) as AnyNormalizedSchema;
    const schemaNoProvider = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;

    it("override wins", async () => {
      const config = makeConfig({ mockSql: "SELECT 1", dialect: "postgres" });
      const registry = makeRegistry();
      let dialectInfo: DialectResolution | undefined;
      const askdb = createAskDb({
        config,
        registry,
        schema: { schema: schemaWithProvider },
        onResolve: ({ dialect }) => { dialectInfo = dialect; },
      });
      await askdb.ask("q", { dialect: "mysql" });
      expect(dialectInfo?.source).toBe("override");
      expect(dialectInfo?.dialect).toBe("mysql");
    });

    it("config dialect wins over schema provider and sets note when they disagree", async () => {
      const config = makeConfig({ mockSql: "SELECT 1", dialect: "mysql" });
      const registry = makeRegistry();
      let dialectInfo: DialectResolution | undefined;
      const askdb = createAskDb({
        config,
        registry,
        schema: { schema: schemaWithProvider },
        onResolve: ({ dialect }) => { dialectInfo = dialect; },
      });
      await askdb.ask("q");
      expect(dialectInfo?.source).toBe("config");
      expect(dialectInfo?.dialect).toBe("mysql");
      expect(dialectInfo?.note).toMatch(/mysql.*postgres/);
    });

    it("schema provider used when no config dialect", async () => {
      const config = makeConfig({ mockSql: "SELECT 1" });
      const registry = makeRegistry();
      let dialectInfo: DialectResolution | undefined;
      const askdb = createAskDb({
        config,
        registry,
        schema: { schema: schemaWithProvider },
        onResolve: ({ dialect }) => { dialectInfo = dialect; },
      });
      await askdb.ask("q");
      expect(dialectInfo?.source).toBe("schema");
      expect(dialectInfo?.dialect).toBe("postgres");
    });

    it("defaults to postgres when neither config nor schema has dialect", async () => {
      const config = makeConfig({ mockSql: "SELECT 1" });
      const registry = makeRegistry();
      let dialectInfo: DialectResolution | undefined;
      const askdb = createAskDb({
        config,
        registry,
        schema: { schema: schemaNoProvider },
        onResolve: ({ dialect }) => { dialectInfo = dialect; },
      });
      await askdb.ask("q");
      expect(dialectInfo?.source).toBe("default");
      expect(dialectInfo?.dialect).toBe("postgres");
    });

    it("rejects unsupported schema providers by default with the supported dialect list", async () => {
      const config = makeConfig({ mockSql: "SELECT 1" });
      const registry = makeRegistry();
      const schema = loadSchemaFromJson(unsupportedProviderV2Json) as AnyNormalizedSchema;
      const askdb = createAskDb({ config, registry, schema: { schema } });

      await expect(askdb.ask("q")).rejects.toBeInstanceOf(DialectNotSupportedError);
      await expect(askdb.ask("q")).rejects.toThrow(/snowflake[\s\S]*Supported:/);
    });

    it("can fall back to postgres for unsupported schema providers", async () => {
      const config = makeConfig({ mockSql: "SELECT 1" });
      const registry = makeRegistry();
      const schema = loadSchemaFromJson(unsupportedProviderV2Json) as AnyNormalizedSchema;
      let dialectInfo: DialectResolution | undefined;
      const askdb = createAskDb({
        config,
        registry,
        schema: { schema },
        unknownDialect: "fallback-postgres",
        onResolve: ({ dialect }) => { dialectInfo = dialect; },
      });

      await askdb.ask("q");
      expect(dialectInfo?.source).toBe("default");
      expect(dialectInfo?.dialect).toBe("postgres");
      expect(dialectInfo?.note).toContain("snowflake");
    });
  });

  it("5. missing schema - rejects with descriptive error", async () => {
    const config = makeConfig();
    const registry = makeRegistry();
    const askdb = createAskDb({ config, registry });
    await expect(askdb.ask("q")).rejects.toBeInstanceOf(SchemaNotConfiguredError);
    await expect(askdb.ask("q")).rejects.toThrow("No schema configured");
  });

  it("6. missing key - rejects when registry returns undefined model", async () => {
    const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
    const config = makeConfig();
    const registry = makeRegistry({
      createLanguageModelFromEnv: vi.fn(async () => undefined),
      keyMissingMessage: vi.fn(() => "NL→SQL generation: no AI API key configured."),
    });
    const askdb = createAskDb({ config, registry, schema: { schema: preloaded } });
    await expect(askdb.ask("q")).rejects.toBeInstanceOf(ModelNotConfiguredError);
    await expect(askdb.ask("q")).rejects.toThrow("NL→SQL generation: no AI API key configured.");
  });

  it("rejects schema paths that cannot be loaded with source context", async () => {
    const missingPath = "/nope/does-not-exist.schema";
    const config = makeConfig({ mockSql: "SELECT 1" });
    const registry = makeRegistry();
    const askdb = createAskDb({ config, registry, schema: { path: missingPath } });

    try {
      await askdb.ask("q");
      throw new Error("expected askdb.ask to reject");
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaLoadError);
      expect((e as SchemaLoadError).source).toContain(missingPath);
    }
  });

  it("7. caching - schema loaded once; reload() forces re-resolution", async () => {
    const config = makeConfig({ mockSql: "SELECT 1" });
    const registry = makeRegistry();
    const loadSchemaSpy = vi.spyOn(
      await import("@askdb/core"),
      "loadSchema",
    );
    const askdb = createAskDb({
      config,
      registry,
      schema: { path: fixtureSchemaPath },
    });
    await askdb.ask("q1");
    await askdb.ask("q2");
    expect(loadSchemaSpy).toHaveBeenCalledTimes(1);
    askdb.reload();
    await askdb.ask("q3");
    expect(loadSchemaSpy).toHaveBeenCalledTimes(2);
    loadSchemaSpy.mockRestore();
  });
});

describe("createAskDb providers option", () => {
  const fakeAdapter: AiProviderAdapter = {
    provider: "openai",
    configHint: "For FakeAI, set FAKE_API_KEY.",
    resolveConfig: () => undefined, // no key configured
    createLanguageModel: () => ({}) as never,
    createEmbeddingModel: () => ({}) as never,
  };

  it("builds the registry internally from providers", async () => {
    const config = makeConfig({ mockSql: "SELECT 42" });
    const askdb = createAskDb({
      config,
      providers: [fakeAdapter],
      schema: { path: fixtureSchemaPath },
    });
    const result = await askdb.ask("how many users?");
    expect(result.sql).toBe("SELECT 42");
  });

  it("routes model resolution through the providers-built registry", async () => {
    const config = makeConfig(); // no mockSql -> registry path
    const askdb = createAskDb({
      config,
      providers: [fakeAdapter],
      schema: { path: fixtureSchemaPath },
    });
    // The adapter reports no API key, so the composite key-missing message
    // must surface its configHint — proving the internal registry was built
    // from exactly the adapters we passed.
    await expect(askdb.ask("q")).rejects.toThrow(ModelNotConfiguredError);
    await expect(askdb.ask("q")).rejects.toThrow(/FAKE_API_KEY/);
  });

  it("rejects passing both providers and registry", () => {
    const config = makeConfig({ mockSql: "SELECT 1" });
    expect(() =>
      createAskDb({ config, providers: [fakeAdapter], registry: makeRegistry() }),
    ).toThrow(/not both/);
  });

  it("rejects passing neither providers nor registry", () => {
    const config = makeConfig({ mockSql: "SELECT 1" });
    expect(() => createAskDb({ config })).toThrow(/providers/);
  });
});
