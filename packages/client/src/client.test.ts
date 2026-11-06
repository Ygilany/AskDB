import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiBaseUrlCredentialsError, createAiRegistry, type AiConfig, type AiProviderAdapter, type AiRegistry } from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import type { AnyNormalizedSchema, AskDbLogger, AskDbModeV1, AskDialect } from "@askdb/core";
import {
  AskDbError,
  AskDbLogEvent,
  loadSchema,
  loadSchemaFromJson,
  SensitiveReferenceError,
  TenantGuardrailError,
} from "@askdb/core";
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
  aiEnv?: Record<string, string | undefined>;
  omitSensitiveFromPrompt?: boolean;
  askdbMode?: AskDbModeV1;
}): AskDbRuntimeConfig {
  return {
    structured: {
      host: {
        schemaPath: overrides?.schemaPath,
        schemaJson: overrides?.schemaJson,
      },
    } as AskDbRuntimeConfig["structured"],
    ai: { aiEnv: { ...overrides?.aiEnv } },
    dev: { mockSql: overrides?.mockSql },
    nlToSql: { dialect: overrides?.dialect },
    modes: { askdbMode: overrides?.askdbMode, omitSensitiveFromPrompt: overrides?.omitSensitiveFromPrompt ?? false },
  } as unknown as AskDbRuntimeConfig;
}

describe("createAskDb", () => {
  it("2. mock SQL path - returns mock SQL without calling registry", async () => {
    const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
    const config = makeConfig({ mockSql: "SELECT 1" });
    const registry = makeRegistry();
    let modelSource: string | undefined;
    const askdb = createAskDb({
      config,
      registry,
      schema: { schema: preloaded },
      onResolve: (info) => { modelSource = info.modelSource; },
    });
    const result = await askdb.ask("count users");
    expect(result.sql).toBe("SELECT 1");
    expect(modelSource).toBe("mock");
    expect(registry.resolveAiConfig).not.toHaveBeenCalled();
    expect(registry.createLanguageModel).not.toHaveBeenCalled();
  });

  it("3. model override - uses override model/deps without calling registry", async () => {
    const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
    const config = makeConfig();
    const registry = makeRegistry();
    const sentinelModel = { kind: "sentinel-model" } as never;
    let modelSource: string | undefined;
    const askdb = createAskDb({
      config,
      registry,
      schema: { schema: preloaded },
      onResolve: (info) => { modelSource = info.modelSource; },
    });
    const result = await askdb.ask("q", {
      model: sentinelModel,
      deps: { generateText: async () => ({ text: "SELECT 2" } as any) as any },
    });
    expect(result.sql).toBe("SELECT 2");
    expect(modelSource).toBe("override");
    expect(registry.resolveAiConfig).not.toHaveBeenCalled();
    expect(registry.createLanguageModel).not.toHaveBeenCalled();
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

  describe("schema from config: host.schemaJson → host.schemaPath", () => {
    const badJson = "{not json";
    const missing = "/nope/does-not-exist.schema";

    // Each case breaks the source that should win, so the error's `source` names which one was read.
    it.each([
      {
        name: "host.schemaJson wins over host.schemaPath",
        config: { schemaJson: badJson, schemaPath: fixtureSchemaPath },
        source: "host.schemaJson",
      },
      {
        name: "a blank host.schemaJson falls through to host.schemaPath",
        config: { schemaJson: "   ", schemaPath: missing },
        source: `host.schemaPath (${missing})`,
      },
    ])("$name", async ({ config, source }) => {
      const askdb = createAskDb({ config: makeConfig({ ...config, mockSql: "SELECT 1" }), registry: makeRegistry() });
      const error = await askdb.ask("q").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SchemaLoadError);
      expect((error as SchemaLoadError).source).toBe(source);
    });

    // The flat map is a projection of `host.*`; a schema key found only there is never read (#711).
    it("treats blank host values as no schema configured, whatever the env map holds", async () => {
      const config = makeConfig({
        schemaJson: " ",
        schemaPath: "\t",
        mockSql: "SELECT 1",
        aiEnv: { ASKDB_SCHEMA_JSON: minimalV2Json, ASKDB_SCHEMA_PATH: fixtureSchemaPath },
      });
      const askdb = createAskDb({ config, registry: makeRegistry() });
      await expect(askdb.ask("q")).rejects.toBeInstanceOf(SchemaNotConfiguredError);
    });
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

  it("registers every built-in provider when neither providers nor registry is passed", async () => {
    const config = makeConfig(); // no mockSql and no key -> registry path
    const askdb = createAskDb({ config, schema: { path: fixtureSchemaPath } });
    // No API key configured: the key-missing message lists every built-in
    // provider's setup hint, proving the default registry holds the built-ins.
    const error = await askdb.ask("q").catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(ModelNotConfiguredError);
    for (const provider of ["openai", "azure", "anthropic", "google", "gateway"]) {
      expect(error.message).toContain(`ai.providerConfig.${provider}.apiKey`);
    }
  });

  it("accepts built-in provider names and registers only those", async () => {
    const config = makeConfig({ aiEnv: { ASKDB_AI_PROVIDER: "anthropic" } });
    const askdb = createAskDb({ config, providers: ["anthropic"], schema: { path: fixtureSchemaPath } });
    const error = await askdb.ask("q").catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(ModelNotConfiguredError);
    expect(error.message).toContain("ai.providerConfig.anthropic.apiKey");
    expect(error.message).not.toContain("ai.providerConfig.openai.apiKey");
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

describe("createAskDb — parameterize passthrough", () => {
  it("forwards parameterized extras from core through the facade", async () => {
    const threeBlock = [
      "```sql",
      "SELECT count(*) FROM cities WHERE state = 'colorado'",
      "```",
      "```sql-unbound",
      "SELECT count(*) FROM cities WHERE state = :state_name",
      "```",
      "```json",
      '{"parameters":[{"name":"state_name","type":"string","cardinality":"one","value":"colorado"}]}',
      "```",
    ].join("\n");
    const generateText = vi.fn(async () => ({ text: threeBlock }));
    const askdb = createAskDb({
      config: makeConfig(),
      registry: makeRegistry({
        createLanguageModel: vi.fn(async () => ({}) as never),
        createLanguageModelFromEnv: vi.fn(async () => ({}) as never),
      }),
      schema: { path: fixtureSchemaPath },
    });
    const result = await askdb.ask("How many cities does Colorado have?", {
      dialect: "postgres",
      deps: { generateText },
    });
    expect(result.sql).toBe("SELECT count(*) FROM cities WHERE state = 'colorado'");
    expect(result.unboundSql).toBe("SELECT count(*) FROM cities WHERE state = $1");
    expect(result.params).toEqual(["colorado"]);
    expect(result.parameters?.[0]?.name).toBe("state_name");
    expect(result.preparedQuery?.version).toBe(1);
  });
});

describe("createAskDb — omitSensitiveFromPrompt config floor", () => {
  const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;

  function capturingDialect(): { dialect: AskDialect; seen: () => boolean | undefined } {
    let seen: boolean | undefined;
    return {
      dialect: {
        async generate(_q, _s, _m, opts) {
          seen = opts?.omitSensitiveIdentifiersFromNlToSqlPrompt;
          return { sql: "SELECT 1" };
        },
      },
      seen: () => seen,
    };
  }

  it("config true + per-call false still omits sensitive identifiers", async () => {
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({
      config: makeConfig({ mockSql: "SELECT 1", omitSensitiveFromPrompt: true }),
      registry: makeRegistry(),
      schema: { schema: preloaded },
    });
    await askdb.ask("q", { dialect, omitSensitiveIdentifiersFromNlToSqlPrompt: false });
    expect(seen()).toBe(true);
  });

  it("config true + no per-call value omits sensitive identifiers", async () => {
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({
      config: makeConfig({ mockSql: "SELECT 1", omitSensitiveFromPrompt: true }),
      registry: makeRegistry(),
      schema: { schema: preloaded },
    });
    await askdb.ask("q", { dialect });
    expect(seen()).toBe(true);
  });

  it("config false + per-call true tightens for that call only", async () => {
    const { dialect, seen } = capturingDialect();
    const askdb = createAskDb({
      config: makeConfig({ mockSql: "SELECT 1" }),
      registry: makeRegistry(),
      schema: { schema: preloaded },
    });
    await askdb.ask("q", { dialect, omitSensitiveIdentifiersFromNlToSqlPrompt: true });
    expect(seen()).toBe(true);
    await askdb.ask("q", { dialect });
    expect(seen()).toBeUndefined();
  });
});

describe("createAskDb — modes.askdbMode: a call can tighten the config mode, never loosen it", () => {
  const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;

  /** The mode core ran with, read from its documented `askdb.pipeline.mode` log line. */
  /** `callMode` is a plain string: an untyped JavaScript caller can pass any spelling. */
  async function modeRun(configMode: AskDbModeV1 | undefined, callMode: string | undefined): Promise<unknown> {
    const modes: unknown[] = [];
    const logger: AskDbLogger = {
      info: (context) => {
        if (context.event === AskDbLogEvent.PipelineMode) modes.push(context.mode);
      },
      error: () => {},
    };
    const askdb = createAskDb({
      config: makeConfig({ mockSql: "SELECT 1", askdbMode: configMode }),
      registry: makeRegistry(),
      schema: { schema: preloaded },
    });
    await askdb.ask("q", { logger, ...(callMode ? { mode: callMode as AskDbModeV1 } : {}) });
    expect(modes).toHaveLength(1);
    return modes[0];
  }

  it.each([
    { name: "config bounded_results applies when the call names no mode", config: "bounded_results", call: undefined, runs: "bounded_results" },
    { name: "a call's schema_only tightens config bounded_results", config: "bounded_results", call: "schema_only", runs: "schema_only" },
    { name: "a call can't loosen an unset config, which counts as schema_only", config: undefined, call: "bounded_results", runs: "schema_only" },
    { name: "a call's mode is parsed like the config's, so SCHEMA-ONLY still tightens", config: "bounded_results", call: "SCHEMA-ONLY", runs: "schema_only" },
  ] as const)("$name", async ({ config, call, runs }) => {
    expect(await modeRun(config, call)).toBe(runs);
  });

  it("rejects an unknown call mode instead of running the config mode", async () => {
    await expect(modeRun("bounded_results", "schema_onyl")).rejects.toThrow(AskDbError);
  });
});

describe("createAskDb — abortSignal", () => {
  // The abort contract itself is core's (ask.test.ts); this pins that the facade passes the
  // signal through on the path the HTTP API uses: a registry-resolved model, no deps.
  it("aborting the caller's controller aborts the registry-resolved model call", async () => {
    const preloaded = loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema;
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
    };
    const askdb = createAskDb({
      config: makeConfig(),
      registry: makeRegistry({
        resolveAiConfig: vi.fn(() => ({ provider: "openai", apiKey: "k", model: "m" }) as AiConfig),
        createLanguageModel: vi.fn(async () => model as never),
      }),
      schema: { schema: preloaded },
    });
    const controller = new AbortController();
    const pending = askdb.ask("q", {
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
});

describe("createAskDb — bind() rebinds a stored template under the guardrails (ADR 0010)", () => {
  const multiTenantPath = join(here, "../../../fixtures/schemas/agency-multi-tenant.schema");
  const agencies = "table:public.agencies";
  const reply = (sql: string, unbound: string) =>
    [
      "```sql",
      sql,
      "```",
      "```sql-unbound",
      unbound,
      "```",
      "```json",
      '{"parameters":[{"name":"status_name","type":"string","cardinality":"one","value":"shipped"}]}',
      "```",
    ].join("\n");
  const agencyIds = (...ids: string[]) => ({ access: { kind: "ids" as const, tenantRoot: agencies, ids } });
  const askdbReplying = (text: string) =>
    createAskDb({ config: makeConfig({ schemaPath: multiTenantPath, mockSql: text, dialect: "postgres" }), registry: makeRegistry() });

  it("loads the schema from host.schemaPath, renders the bind-time tenant IDs, and refuses what core refuses", async () => {
    const askdb = askdbReplying(
      reply(
        "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'shipped'",
        "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status_name",
      ),
    );
    const { preparedQuery } = await askdb.ask("orders by status", { tenantScope: agencyIds("42") });

    const bound = await askdb.bind(preparedQuery!, { status_name: "open" }, { tenantScope: agencyIds("7"), tenantSqlMode: "sql-only" });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = '7' AND status = 'open'");
    expect(bound.verdict.outcome).toBe("allow");

    const unscoped = { ...preparedQuery!, namedSql: "SELECT count(*) FROM orders WHERE status = :status_name", parameters: preparedQuery!.parameters.filter((p) => p.source === "question") };
    await expect(askdb.bind(unscoped, { status_name: "open" }, { tenantScope: agencyIds("7") })).rejects.toBeInstanceOf(
      TenantGuardrailError,
    );
  });

  it("forwards sensitiveGuardrailMode and checks under options.schema when it is set", async () => {
    const askdb = askdbReplying("SELECT 1");
    const readsEmail = {
      version: 1 as const,
      dialect: "postgres" as const,
      dialectRules: "builtin" as const,
      namedSql: "SELECT c.email FROM clients c WHERE c.id IN (:tenant_client_ids) AND c.name = :status_name",
      parameters: [
        { name: "status_name", placeholder: ":status_name", type: "string" as const, cardinality: "one" as const, source: "question" as const },
        { name: "tenant_client_ids", placeholder: ":tenant_client_ids", type: "string" as const, cardinality: "many" as const, source: "tenant" as const },
      ],
    };
    const clientScope = { access: { kind: "ids" as const, tenantRoot: "table:public.clients", ids: ["5"] } };

    const bound = await askdb.bind(readsEmail, { status_name: "x" }, { tenantScope: clientScope });
    expect(bound.verdict.outcome).toBe("warn");
    await expect(
      askdb.bind(readsEmail, { status_name: "x" }, { tenantScope: clientScope, sensitiveGuardrailMode: "strict" }),
    ).rejects.toBeInstanceOf(SensitiveReferenceError);

    // The same template under a schema without a tenant policy can't render its placeholder.
    const { tenantPolicy: _policy, ...noPolicy } = loadSchema(multiTenantPath);
    await expect(
      askdb.bind(readsEmail, { status_name: "x" }, { tenantScope: clientScope, schema: noPolicy as AnyNormalizedSchema }),
    ).rejects.toMatchObject({ name: "TenantScopeError", reason: "UNRESOLVED_TENANT_PLACEHOLDER" });
  });

  it("checks under a raw v1 schema object passed as options.schema", async () => {
    const askdb = askdbReplying("SELECT 1");
    const v1: AnyNormalizedSchema = {
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "integer", nullable: false, primaryKey: true },
            { name: "password", type: "text", nullable: false, primaryKey: false, sensitive: true },
          ],
        },
      ],
    };
    const readsPassword = {
      version: 1 as const,
      dialect: "postgres" as const,
      dialectRules: "builtin" as const,
      namedSql: "SELECT password FROM users WHERE id = :status_name",
      parameters: [
        { name: "status_name", placeholder: ":status_name", type: "string" as const, cardinality: "one" as const, source: "question" as const },
      ],
    };

    const bound = await askdb.bind(readsPassword, { status_name: "1" }, { schema: v1 });
    expect(bound.sql).toBe("SELECT password FROM users WHERE id = '1'");
    expect(bound.verdict.findings).toEqual([
      expect.objectContaining({ check: "sensitive", rule: "SENSITIVE_COLUMN_REFERENCED" }),
    ]);
  });

  // A template stored before AskDB recorded dialectRules needs the rules named at rebind;
  // askdb.bind() must pass `dialect` on to core, or a host can't rebind it at all (#660).
  it("passes dialect to the rebind, which a template stored without dialectRules needs", async () => {
    const askdb = askdbReplying(
      reply(
        "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'shipped'",
        "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status_name",
      ),
    );
    const { preparedQuery } = await askdb.ask("orders by status", { tenantScope: agencyIds("42") });
    const { dialectRules: _rules, ...stored } = preparedQuery!;

    await expect(askdb.bind(stored, { status_name: "open" }, { tenantScope: agencyIds("7") })).rejects.toMatchObject({
      reason: "DIALECT_SPEC_REQUIRED",
    });
    const bound = await askdb.bind(stored, { status_name: "open" }, { tenantScope: agencyIds("7"), dialect: "postgres", tenantSqlMode: "sql-only" });
    expect(bound.sql).toBe("SELECT count(*) FROM orders WHERE agency_id = '7' AND status = 'open'");
  });

  it("expands a subtree scope with resolveTenantDescendants before binding", async () => {
    const askdb = askdbReplying(
      reply(
        "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = 'shipped'",
        "SELECT count(*) FROM orders WHERE agency_id = :tenant_agency_ids AND status = :status_name",
      ),
    );
    const { preparedQuery } = await askdb.ask("orders by status", { tenantScope: agencyIds("42") });
    const resolveTenantDescendants = vi.fn(async () => ({ [agencies]: ["2"] }));

    const bound = await askdb.bind(preparedQuery!, { status_name: "open" }, {
      tenantScope: { access: { kind: "subtree", tenantRoot: agencies, rootIds: ["1"], includeDescendants: true } },
      resolveTenantDescendants,
      tenantSqlMode: "sql-only",
    });
    expect(resolveTenantDescendants).toHaveBeenCalledWith(agencies, ["1"]);
    expect(bound.sql).toBe(
      "SELECT count(*) FROM orders WHERE agency_id IN ('1', '2') AND status = 'open'",
    );
  });
});

// #787: a base URL with credentials is refused before any request is made. Unrefused, fetch quotes
// the URL in its error, which core logs as askdb.pipeline.failed; refused, core never runs, so the
// run logs nothing at all.
describe("createAskDb with a model base URL that carries credentials", () => {
  const SECRET_URL = "http://admin:S3cret@proxy.example/v1";
  const saved = process.env.OPENAI_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = saved;
  });

  async function askWith(aiEnv: Record<string, string>): Promise<{ error: unknown; lines: unknown[] }> {
    const lines: unknown[] = [];
    const logger: AskDbLogger = { info: (context) => void lines.push(context), error: (context) => void lines.push(context) };
    const askdb = createAskDb({
      config: makeConfig({ aiEnv }),
      registry: createAiRegistry(),
      schema: { schema: loadSchemaFromJson(minimalV2Json) as AnyNormalizedSchema },
    });
    const error = await askdb.ask("count users", { logger }).catch((e: unknown) => e);
    return { error, lines };
  }

  it.each([
    // A runtime config a host builds itself skips the config file's check.
    ["in the runtime config's env", { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: SECRET_URL }, () => {}],
    // The OpenAI SDK reads OPENAI_BASE_URL from process.env itself when AskDB passes no base URL.
    ["in process.env, where the SDK would read it", { OPENAI_API_KEY: "sk-test" }, () => void (process.env.OPENAI_BASE_URL = SECRET_URL)],
  ])("rejects one %s, and nothing repeats the URL", async (_where, aiEnv, arrange) => {
    arrange();
    const { error, lines } = await askWith(aiEnv);

    expect(error).toBeInstanceOf(AiBaseUrlCredentialsError);
    expect((error as AiBaseUrlCredentialsError).setting).toBe("OPENAI_BASE_URL");
    expect((error as Error).message).not.toMatch(/S3cret|admin/);
    expect(lines).toEqual([]);
  });
});
