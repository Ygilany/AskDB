import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AiConfig, AiProviderAdapter, AiRegistry } from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import type { AnyNormalizedSchema, AskDialect } from "@askdb/core";
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
    resolveProviderOptions: vi.fn(() => undefined),
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
  aiEnv?: Record<string, string | undefined>;
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
        ...overrides?.aiEnv,
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

describe("createAskDb reasoning effort resolution", () => {
  const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
  const resolvedAiConfig: AiConfig = { provider: "openai", apiKey: "k", model: "o3-mini" };
  const sentinelModel = { kind: "sentinel-model" } as never;

  function capturingDialect(): { dialect: AskDialect; seen: () => Record<string, unknown> | undefined } {
    let seen: Record<string, unknown> | undefined;
    return {
      dialect: {
        async generate(_q, _s, _m, opts) {
          seen = opts?.providerOptions;
          return { sql: "SELECT 1" };
        },
      },
      seen: () => seen,
    };
  }

  it("resolves ai.reasoning env config into providerOptions and forwards to ask()", async () => {
    const config = makeConfig({ aiEnv: { ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "low" } });
    const registry = makeRegistry({
      resolveAiConfig: vi.fn(() => resolvedAiConfig),
      createLanguageModel: vi.fn(async () => sentinelModel),
      resolveProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: "low" } })),
    });
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({ config, registry, schema: { schema: preloaded } });

    const result = await askdb.ask("q", { dialect });

    expect(result.sql).toBe("SELECT 1");
    expect(registry.resolveProviderOptions).toHaveBeenCalledWith(resolvedAiConfig, {
      reasoningEffort: "low",
    });
    expect(seen()).toEqual({ openai: { reasoningEffort: "low" } });
  });

  it("per-call reasoningEffort overrides both the client default and env config", async () => {
    const config = makeConfig({ aiEnv: { ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "low" } });
    const registry = makeRegistry({
      resolveAiConfig: vi.fn(() => resolvedAiConfig),
      createLanguageModel: vi.fn(async () => sentinelModel),
      resolveProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: "high" } })),
    });
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({
      config,
      registry,
      schema: { schema: preloaded },
      reasoningEffort: "medium",
    });

    await askdb.ask("q", { dialect, reasoningEffort: "high" });

    expect(registry.resolveProviderOptions).toHaveBeenCalledWith(resolvedAiConfig, {
      reasoningEffort: "high",
    });
    expect(seen()).toEqual({ openai: { reasoningEffort: "high" } });
  });

  it("client-level reasoningEffort default applies when no per-call override is set", async () => {
    const config = makeConfig();
    const registry = makeRegistry({
      resolveAiConfig: vi.fn(() => resolvedAiConfig),
      createLanguageModel: vi.fn(async () => sentinelModel),
      resolveProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: "medium" } })),
    });
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({
      config,
      registry,
      schema: { schema: preloaded },
      reasoningEffort: "medium",
    });

    await askdb.ask("q", { dialect });

    expect(registry.resolveProviderOptions).toHaveBeenCalledWith(resolvedAiConfig, {
      reasoningEffort: "medium",
    });
    expect(seen()).toEqual({ openai: { reasoningEffort: "medium" } });
  });

  it("does not call resolveProviderOptions when no reasoningEffort is configured (preserves current behavior)", async () => {
    const config = makeConfig();
    const registry = makeRegistry({
      resolveAiConfig: vi.fn(() => resolvedAiConfig),
      createLanguageModel: vi.fn(async () => sentinelModel),
    });
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({ config, registry, schema: { schema: preloaded } });

    await askdb.ask("q", { dialect });

    expect(registry.resolveProviderOptions).not.toHaveBeenCalled();
    expect(seen()).toBeUndefined();
  });

  it("an explicit deps.providerOptions from the caller wins over the resolved reasoningEffort", async () => {
    const config = makeConfig({ aiEnv: { ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "low" } });
    const registry = makeRegistry({
      resolveAiConfig: vi.fn(() => resolvedAiConfig),
      createLanguageModel: vi.fn(async () => sentinelModel),
      resolveProviderOptions: vi.fn(() => ({ openai: { reasoningEffort: "low" } })),
    });
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({ config, registry, schema: { schema: preloaded } });
    const explicitProviderOptions = { openai: { reasoningEffort: "high" } };

    await askdb.ask("q", { dialect, deps: { providerOptions: explicitProviderOptions } });

    expect(seen()).toBe(explicitProviderOptions);
  });
});
