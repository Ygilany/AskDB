import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASKDB_AI_PROVIDERS,
  bootstrapAskDbEnv,
  defineConfig,
  discoverAskDbConfigPath,
  env,
  flattenAskDbConfig,
  getAskDbRuntimeConfig,
  isAskDbRuntimeInitialized,
  loadAskDbConfigProjection,
  loadAskDbConfigProjectionSync,
  requiredEnv,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
} from "./index.js";
import type { AskDbRuntimeConfig } from "./index.js";
import { renderAskDbAiConfigScaffold } from "./scaffold/index.js";
import type { AskDbConfig } from "./types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function linkWorkspacePackage(projectDir: string): void {
  const nmAskdb = join(projectDir, "node_modules", "@askdb");
  mkdirSync(nmAskdb, { recursive: true });
  const linkedPackage = join(nmAskdb, "config");
  mkdirSync(linkedPackage, { recursive: true });
  symlinkSync(join(pkgRoot, "src"), join(linkedPackage, "src"), "dir");
  writeFileSync(
    join(linkedPackage, "package.json"),
    JSON.stringify(
      {
        name: "@askdb/config",
        type: "module",
        main: "./src/index.ts",
        exports: {
          ".": "./src/index.ts",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function minimalConfig(overrides: Partial<AskDbConfig> = {}): AskDbConfig {
  const base: AskDbConfig = {
    ai: {
      provider: "openai",
      providerConfig: {
        openai: { apiKey: "k" },
      },
    },
    introspection: {
      provider: "postgres",
      providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } },
      outputDir: "./askdb/",
    },
    rag: {
      embedder: "mock",
      store: "memory",
      storeConfig: { memory: {} },
    },
  };
  return { ...base, ...overrides, ai: { ...base.ai, ...overrides.ai } as AskDbConfig["ai"] };
}

describe("discoverAskDbConfigPath", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("prefers askdb.config.ts over askdb.config.js in the same directory", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    writeFileSync(join(dir, "askdb.config.js"), "export default {}", "utf8");
    writeFileSync(join(dir, "askdb.config.ts"), "export default {}", "utf8");
    expect(discoverAskDbConfigPath(dir)).toBe(join(dir, "askdb.config.ts"));
  });

  it("prefers askdb.config.* over .config/askdb.* when both exist", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    mkdirSync(join(dir, ".config"), { recursive: true });
    writeFileSync(join(dir, ".config", "askdb.ts"), "export default {}", "utf8");
    writeFileSync(join(dir, "askdb.config.js"), "export default {}", "utf8");
    expect(discoverAskDbConfigPath(dir)).toBe(join(dir, "askdb.config.js"));
  });
});

describe("ASKDB_AI_PROVIDERS", () => {
  it("lists every first-party provider id flattenAskDbConfig handles, including anthropic and gateway", () => {
    expect([...ASKDB_AI_PROVIDERS].sort()).toEqual(
      ["anthropic", "azure", "foundry", "gateway", "google", "openai"].sort(),
    );
  });
});

describe("env helpers", () => {
  it("env returns undefined when missing", () => {
    delete process.env.ASKDB_CONFIG_TEST_MISSING;
    expect(env("ASKDB_CONFIG_TEST_MISSING")).toBeUndefined();
  });

  it("env trims when set", () => {
    process.env.ASKDB_CONFIG_TEST_OPT = "  x  ";
    expect(env("ASKDB_CONFIG_TEST_OPT")).toBe("x");
    delete process.env.ASKDB_CONFIG_TEST_OPT;
  });

  it("requiredEnv throws when missing", () => {
    delete process.env.ASKDB_CONFIG_TEST_MISSING;
    expect(() => requiredEnv("ASKDB_CONFIG_TEST_MISSING")).toThrow(/ASKDB_CONFIG_TEST_MISSING/);
  });
});

describe("flattenAskDbConfig", () => {
  it("maps openai + mock rag + memory store", () => {
    const flat = flattenAskDbConfig(minimalConfig());
    expect(flat.OPENAI_API_KEY).toBe("k");
    expect(flat.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://localhost/db");
    expect(flat.ASKDB_RAG_EMBEDDER).toBe("mock");
    expect(flat.ASKDB_INTROSPECT_OUT).toBe("./askdb/");
  });

  it("rejects invalid mode", () => {
    expect(() =>
      flattenAskDbConfig(
        minimalConfig({
          modes: { askdbMode: "nope" as unknown as import("./constants.js").AskDbModeV1 },
        }),
      ),
    ).toThrow(/invalid modes\.askdbMode/);
  });

  it("flattens MySQL introspection branch to ASKDB_INTROSPECT_MYSQL_URL", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        introspection: {
          provider: "mysql",
          providerConfig: { mysql: { databaseUrl: "mysql://app:pw@localhost/shop" } },
          outputDir: "./askdb/",
        },
      }),
    );
    expect(flat.ASKDB_INTROSPECT_MYSQL_URL).toBe("mysql://app:pw@localhost/shop");
    expect(flat.DATABASE_URL).toBeUndefined();
  });

  it("flattens SQLite introspection branch to ASKDB_INTROSPECT_SQLITE_FILE", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        introspection: {
          provider: "sqlite",
          providerConfig: { sqlite: { file: "./data/app.db" } },
          outputDir: "./askdb/",
        },
      }),
    );
    expect(flat.ASKDB_INTROSPECT_SQLITE_FILE).toBe("./data/app.db");
  });

  it("flattens SQL Server introspection branch to ASKDB_INTROSPECT_SQLSERVER_URL", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        introspection: {
          provider: "sqlserver",
          providerConfig: { sqlserver: { databaseUrl: "Server=localhost;Database=app;" } },
          outputDir: "./askdb/",
        },
      }),
    );
    expect(flat.ASKDB_INTROSPECT_SQLSERVER_URL).toBe("Server=localhost;Database=app;");
  });

  it("defaults OpenAI language model when model omitted", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "openai",
          providerConfig: { openai: { apiKey: "k" } },
        },
      }),
    );
    expect(flat.OPENAI_MODEL).toBe("gpt-4o-mini");
    expect(flat.ASKDB_MODEL).toBe("gpt-4o-mini");
  });

  it("omits ASKDB_INTROSPECT_POSTGRES_URL when postgres databaseUrl is not set", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        introspection: {
          provider: "postgres",
          providerConfig: { postgres: {} },
          outputDir: "./askdb/",
        },
      }),
    );
    expect(flat.ASKDB_INTROSPECT_POSTGRES_URL).toBeUndefined();
    expect(flat.DATABASE_URL).toBeUndefined();
  });

  // The CLI and Studio default an unset basePath to `<schema dir>/schema` themselves (#676).
  it("writes no file-store base path when basePath is omitted", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        rag: {
          embedder: "mock",
          store: "file",
          storeConfig: { file: {} },
        },
      }),
    );
    expect(flat.ASKDB_RAG_FILE_BASE_PATH).toBeUndefined();
  });

  it("defaults the gateway model to openai/gpt-4o-mini and requires its branch", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: { provider: "gateway", providerConfig: { gateway: { apiKey: "gw-key" } } },
      }),
    );
    expect(flat.ASKDB_AI_MODEL).toBe("openai/gpt-4o-mini");
    expect(() =>
      flattenAskDbConfig(minimalConfig({ ai: { provider: "gateway" } as never })),
    ).toThrow(/ai\.providerConfig\.gateway is required/);
  });

  it("defaults anthropic model to claude-sonnet-4-6 when model omitted", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "anthropic",
          providerConfig: {
            anthropic: { apiKey: "ant-key" },
          },
        },
      }),
    );
    expect(flat.ASKDB_AI_MODEL).toBe("claude-sonnet-4-6");
  });

  it("flattens azure modelFamily override to ASKDB_AI_AZURE_MODEL_FAMILY", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "azure",
          providerConfig: {
            azure: {
              apiKey: "k",
              baseUrl: "https://askdb-ai.openai.azure.com",
            },
          },
          language: { model: "askdb-reporting", modelFamily: "gpt-5" },
        },
      }),
    );
    expect(flat.AZURE_OPENAI_DEPLOYMENT).toBe("askdb-reporting");
    expect(flat.ASKDB_AI_AZURE_MODEL_FAMILY).toBe("gpt-5");
  });

  it.each(["azure", "foundry"] as const)(
    "flattens %s resourceName/baseUrl/apiVersion to the env keys the Azure adapter reads",
    (provider) => {
      const flat = flattenAskDbConfig(
        minimalConfig({
          ai: {
            provider,
            providerConfig: {
              [provider]: {
                apiKey: "k",
                resourceName: "my-foundry",
                baseUrl: "https://my-foundry.openai.azure.com/openai",
                apiVersion: "2025-04-01-preview",
              },
            },
          } as AskDbConfig["ai"],
        }),
      );
      expect(flat.ASKDB_AI_PROVIDER).toBe(provider);
      expect(flat.ASKDB_AI_AZURE_RESOURCE_NAME).toBe("my-foundry");
      expect(flat.AZURE_OPENAI_BASE_URL).toBe("https://my-foundry.openai.azure.com/openai");
      expect(flat.AZURE_OPENAI_API_VERSION).toBe("2025-04-01-preview");
    },
  );

  it("omits ASKDB_AI_AZURE_RESOURCE_NAME when azure resourceName is unset", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "azure",
          providerConfig: { azure: { apiKey: "k", baseUrl: "https://x.openai.azure.com" } },
        },
      }),
    );
    expect(flat).not.toHaveProperty("ASKDB_AI_AZURE_RESOURCE_NAME");
  });

  it("flattens a custom provider string to universal ASKDB_AI_* keys", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "mistral",
          providerConfig: {
            mistral: { apiKey: "mistral-key", baseUrl: "https://api.mistral.ai/v1" },
          },
          language: { model: "mistral-large-2" },
        },
      }),
    );
    expect(flat.ASKDB_AI_PROVIDER).toBe("mistral");
    expect(flat.ASKDB_AI_API_KEY).toBe("mistral-key");
    expect(flat.ASKDB_AI_MODEL).toBe("mistral-large-2");
    expect(flat.ASKDB_AI_BASE_URL).toBe("https://api.mistral.ai/v1");
  });

  it("sets ASKDB_AI_PROVIDER for custom provider even when providerConfig is absent", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "bedrock",
        },
      }),
    );
    expect(flat.ASKDB_AI_PROVIDER).toBe("bedrock");
    expect(flat.ASKDB_AI_API_KEY).toBeUndefined();
  });

  it("throws a clear error when openai provider has no providerConfig", () => {
    const cfg: AskDbConfig = {
      ...minimalConfig(),
      ai: { provider: "openai" } as unknown as AskDbConfig["ai"],
    };
    expect(() => flattenAskDbConfig(cfg)).toThrow(/ai\.providerConfig\.openai is required/);
  });

  it("throws a clear error when google provider has providerConfig.custom instead of providerConfig.google", () => {
    expect(() =>
      flattenAskDbConfig(
        minimalConfig({
          ai: {
            provider: "google",
            providerConfig: { custom: { apiKey: "k" } },
          } as unknown as AskDbConfig["ai"],
        }),
      ),
    ).toThrow(/ai\.providerConfig\.google is required/);
  });

  describe("ai.language.reasoning", () => {
    it("flattens the global effort to ASKDB_AI_REASONING_EFFORT", () => {
      const flat = flattenAskDbConfig(
        minimalConfig({
          ai: {
            provider: "openai",
            providerConfig: { openai: { apiKey: "k" } },
            language: { reasoning: { effort: "medium" } },
          },
        }),
      );
      expect(flat.ASKDB_AI_REASONING_EFFORT).toBe("medium");
      expect(flat.ASKDB_AI_REASONING_EFFORT_NL_TO_SQL).toBeUndefined();
      expect(flat.ASKDB_AI_REASONING_EFFORT_ENRICHMENT).toBeUndefined();
    });

    it("flattens per-call-site overrides independently of the global effort", () => {
      const flat = flattenAskDbConfig(
        minimalConfig({
          ai: {
            provider: "openai",
            providerConfig: { openai: { apiKey: "k" } },
            language: { reasoning: { effort: "medium", nlToSql: "high", enrichment: "low" } },
          },
        }),
      );
      expect(flat.ASKDB_AI_REASONING_EFFORT).toBe("medium");
      expect(flat.ASKDB_AI_REASONING_EFFORT_NL_TO_SQL).toBe("high");
      expect(flat.ASKDB_AI_REASONING_EFFORT_ENRICHMENT).toBe("low");
    });

    it("throws a clear error for an invalid reasoning effort value", () => {
      expect(() =>
        flattenAskDbConfig(
          minimalConfig({
            ai: {
              provider: "openai",
              providerConfig: { openai: { apiKey: "k" } },
              language: { reasoning: { effort: "ultra" as never } },
            },
          }),
        ),
      ).toThrow(/invalid ai\.language\.reasoning value "ultra"/);
    });
  });
});

describe("required ai and introspection blocks (#626)", () => {
  const { ai: _ai, ...noAi } = minimalConfig();
  const { introspection: _introspection, ...noIntrospection } = minimalConfig();

  // Before #626 both crashed in normalizing with a bare TypeError that named neither block.
  it.each([
    ["ai", noAi],
    ["introspection", noIntrospection],
  ])("defineConfig without an %s block names the missing block", (block, config) => {
    expect(() => defineConfig(config as AskDbConfig)).toThrow(`askdb.config: the config has no ${block} block;`);
  });
});

describe("optional rag block (#226)", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function runtimeFor(config: AskDbConfig) {
    setAskDbRuntimeForTests(config);
    return getAskDbRuntimeConfig();
  }

  /** Only the keys the `rag` block writes. */
  function ragKeys<V>(env: Record<string, V>): Record<string, V> {
    return Object.fromEntries(
      Object.entries(env).filter(([key]) => key.startsWith("ASKDB_RAG_") || key.startsWith("ASKDB_PGVECTOR_")),
    );
  }

  const { rag: _rag, ...noRag } = minimalConfig();

  it("flattens a config without a rag block to the mock embedder, with no store keys", () => {
    expect(ragKeys(flattenAskDbConfig(noRag))).toEqual({ ASKDB_RAG_EMBEDDER: "mock" });
  });

  it("treats an omitted rag block exactly like an explicit mock + memory block, with no deprecations", () => {
    expect(flattenAskDbConfig(noRag)).toEqual(
      flattenAskDbConfig({ ...noRag, rag: { embedder: "mock", store: "memory", storeConfig: {} } }),
    );
    expect(defineConfig(noRag).deprecations).toEqual([]);
  });

  it("loads a null rag block, as a JS config can write it, like an omitted one", () => {
    const nullRag = { ...noRag, rag: null as unknown as AskDbConfig["rag"] };
    expect(flattenAskDbConfig(nullRag)).toEqual(flattenAskDbConfig(noRag));
    expect(defineConfig(nullRag).deprecations).toEqual([]);
    expect(runtimeFor(nullRag).rag).toMatchObject({ store: "memory", storeConfig: {} });
  });

  it.each([
    ["omitted", noRag],
    ["null, as a JS config can write it", { ...noRag, rag: null as unknown as AskDbConfig["rag"] }],
  ])("refuses an ai.embedding model when the rag block is %s", (_name, config) => {
    expect(() =>
      defineConfig({ ...config, ai: { ...config.ai, embedding: { model: "text-embedding-3-small" } } }),
    ).toThrow(
      'askdb.config: ai.embedding is set but the config has no rag block; add rag: { embedder: "ai", store, storeConfig }, or remove ai.embedding.',
    );
  });

  it.each([
    ["empty", {}],
    ["an unset env() read", { model: undefined }],
    ["a blank model", { model: "  " }],
    ["a null model, as a JS config can write it", { model: null as unknown as string }],
  ] satisfies [string, NonNullable<AskDbConfig["ai"]["embedding"]>][])(
    "loads a config without a rag block when ai.embedding holds no value: %s",
    (_name, embedding) => {
      expect(defineConfig({ ...noRag, ai: { ...noRag.ai, embedding } }).deprecations).toEqual([]);
    },
  );

  it("still loads an explicit mock block next to an ai.embedding model, with no deprecation", () => {
    const { deprecations } = defineConfig({
      ...noRag,
      ai: { ...noRag.ai, embedding: { model: "text-embedding-3-small" } },
      rag: { embedder: "mock", store: "memory", storeConfig: {} },
    });
    expect(deprecations).toEqual([]);
  });

  it.each([
    [
      "the mock embedder with the pgvector store",
      {
        rag: {
          embedder: "mock",
          store: "pgvector",
          storeConfig: { pgvector: { databaseUrl: "postgres://pg/db", table: "askdb_chunks", indexStrategy: "ivfflat" } },
        },
      },
      {
        ASKDB_RAG_EMBEDDER: "mock",
        ASKDB_PGVECTOR_URL: "postgres://pg/db",
        ASKDB_RAG_EMBEDDER_DIMENSIONS: "64",
        ASKDB_PGVECTOR_INDEX_STRATEGY: "ivfflat",
      },
    ],
    [
      "the ai embedder with the pgvector store",
      {
        ai: {
          provider: "openai",
          providerConfig: { openai: { apiKey: "k" } },
          embedding: { model: "text-embedding-3-small", dimensions: 1536 },
        },
        rag: { embedder: "ai", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://pg/db" } } },
      },
      {
        ASKDB_RAG_EMBEDDER: "ai",
        ASKDB_RAG_EMBEDDER_MODEL: "text-embedding-3-small",
        ASKDB_RAG_EMBEDDER_DIMENSIONS: "1536",
        ASKDB_PGVECTOR_URL: "postgres://pg/db",
        ASKDB_PGVECTOR_INDEX_STRATEGY: "hnsw",
      },
    ],
    [
      "the mock embedder with the file store",
      { rag: { embedder: "mock", store: "file", storeConfig: { file: { basePath: "./data/rag" } } } },
      { ASKDB_RAG_EMBEDDER: "mock", ASKDB_RAG_FILE_BASE_PATH: "./data/rag" },
    ],
  ] satisfies [string, Partial<AskDbConfig>, Record<string, string>][])(
    "flattens a full rag block as before: %s",
    (_name, overrides, expected) => {
      expect(ragKeys(flattenAskDbConfig(minimalConfig(overrides)))).toEqual(expected);
    },
  );

  it("defaults the runtime store to memory, with an empty storeConfig, when the rag block is omitted", () => {
    const rt = runtimeFor(noRag);
    expect(rt.rag.store).toBe("memory");
    expect(rt.rag.storeConfig).toEqual({});
  });

  it("gives the runtime view an empty storeConfig for a memory block written without one", () => {
    // AskDbConfig types storeConfig as required, but config load accepts a memory store without it.
    const rt = runtimeFor(minimalConfig({ rag: { embedder: "mock", store: "memory" } as AskDbConfig["rag"] }));
    expect(rt.rag.store).toBe("memory");
    expect(rt.rag.storeConfig).toEqual({});
  });

  it.each([
    ["file", 'askdb.config: rag.store is "file" but `rag.storeConfig.file` is missing.'],
    ["pgvector", 'askdb.config: rag.store is "pgvector" but `rag.storeConfig.pgvector` is missing.'],
  ] as const)("names the missing branch when a %s block is written without storeConfig", (store, message) => {
    expect(() => flattenAskDbConfig(minimalConfig({ rag: { embedder: "mock", store } as AskDbConfig["rag"] }))).toThrow(
      message,
    );
  });

  it.each([
    ["a file store with a base path", { store: "file", storeConfig: { file: { basePath: "./data/rag" } } }],
    ["a file store without one", { store: "file", storeConfig: { file: {} } }],
    ["a pgvector store without an index strategy", { store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://pg/db" } } }],
  ] satisfies [string, Pick<NonNullable<AskDbConfig["rag"]>, "store" | "storeConfig">][])(
    "exposes the authored store and storeConfig on the runtime view, with no defaults filled in: %s",
    (_name, store) => {
      const rt = runtimeFor(minimalConfig({ rag: { embedder: "mock", ...store } }));
      expect(rt.rag.store).toBe(store.store);
      expect(rt.rag.storeConfig).toEqual(store.storeConfig);
    },
  );
});

describe("rag.storeConfig.file.autoFlush (#676)", () => {
  const deprecated =
    "askdb.config: rag.storeConfig.file.autoFlush is deprecated and ignored (the file store writes its files after every change); remove it.";

  it.each([
    ["set to true", true, [deprecated]],
    ["set to false", false, [deprecated]],
    ["unset", undefined, []],
  ] satisfies [string, boolean | undefined, string[]][])("warns only when autoFlush is set: %s", (_name, autoFlush, expected) => {
    const { deprecations } = defineConfig(
      minimalConfig({
        rag: { embedder: "mock", store: "file", storeConfig: { file: { basePath: "./data/rag", autoFlush } } },
      }),
    );
    expect(deprecations).toEqual(expected);
  });
});

describe("ai config sections: provider connections, ai.language, ai.embedding (#435)", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function runtimeFor(config: AskDbConfig) {
    setAskDbRuntimeForTests(config);
    return getAskDbRuntimeConfig();
  }

  /** The env map without the RAG and introspection keys, which no `ai` section writes. */
  function aiKeys<V>(env: Record<string, V>): Record<string, V> {
    return Object.fromEntries(
      Object.entries(env).filter(([key]) => !key.startsWith("ASKDB_RAG_") && !key.startsWith("ASKDB_INTROSPECT_")),
    );
  }

  describe("regressions", () => {
    it("refuses to move a legacy RAG key to a provider other than openai, azure, foundry or gateway (#345)", () => {
      const config = minimalConfig({
        ai: { provider: "google", providerConfig: { google: { apiKey: "google-key" } } },
        rag: {
          embedder: "ai-sdk",
          embedderConfig: { openai: { apiKey: "sk-rag-secret", model: "text-embedding-3-small" } },
          store: "memory",
          storeConfig: { memory: {} },
        },
      });
      let message = "";
      try {
        flattenAskDbConfig(config);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/rag\.embedderConfig\.openai\.apiKey/);
      expect(message).toMatch(/"google"/);
      expect(message).toMatch(/ai\.embedding/);
      expect(message).not.toContain("sk-rag-secret");
    });

    it("builds the embedding env from the embedding connection only, leaving the language view unchanged", () => {
      const ai: AskDbConfig["ai"] = {
        provider: "anthropic",
        providerConfig: {
          anthropic: { apiKey: "ant-key" },
          openai: { apiKey: "oai-key" },
        },
      };
      const withEmbedding = runtimeFor(
        minimalConfig({
          ai: { ...ai, embedding: { provider: "openai", model: "text-embedding-3-small" } },
          rag: { embedder: "ai", store: "memory", storeConfig: { memory: {} } },
        }),
      );
      expect(withEmbedding.ai.embedding?.env).toEqual({
        ASKDB_AI_PROVIDER: "openai",
        OPENAI_API_KEY: "oai-key",
        ASKDB_AI_EMBEDDING_MODEL: "text-embedding-3-small",
      });
      const languageOnly = runtimeFor(minimalConfig({ ai }));
      expect(aiKeys(withEmbedding.ai.aiEnv)).toEqual(aiKeys(languageOnly.ai.aiEnv));
    });

    it("gives the RAG CLI no key or base URL from a custom language provider", () => {
      const rt = runtimeFor(
        minimalConfig({
          ai: {
            provider: "mistral",
            providerConfig: { custom: { apiKey: "mistral-key", baseUrl: "https://api.mistral.ai/v1" } },
          },
        }),
      );
      expect(rt.rag.embedder.apiKey).toBeUndefined();
      expect(rt.rag.embedder.baseURL).toBeUndefined();
    });
  });

  describe("compatibility", () => {
    const MOCK_RAG: AskDbConfig["rag"] = { embedder: "mock", store: "memory", storeConfig: { memory: {} } };
    const OPENAI_AI: AskDbConfig["ai"] = {
      provider: "openai",
      providerConfig: { openai: { apiKey: "oai-key", baseUrl: "https://oai.example/v1", model: "gpt-4o" } },
    };
    const OPENAI_LANGUAGE_KEYS = {
      ASKDB_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "oai-key",
      OPENAI_BASE_URL: "https://oai.example/v1",
      OPENAI_MODEL: "gpt-4o",
      ASKDB_MODEL: "gpt-4o",
    };

    function config(ai: AskDbConfig["ai"], rag: AskDbConfig["rag"] = MOCK_RAG): AskDbConfig {
      return { ...minimalConfig(), ai, rag };
    }

    // Expected maps are what `flattenAskDbConfig` produced on main before the sections existed.
    it.each<[string, AskDbConfig["ai"], AskDbConfig["rag"], Record<string, string>]>([
      ["openai", OPENAI_AI, MOCK_RAG, OPENAI_LANGUAGE_KEYS],
      [
        "openai with a legacy rag.embedder and its own key",
        OPENAI_AI,
        { embedder: "openai", embedderConfig: { openai: { apiKey: "rag-key" } }, store: "memory", storeConfig: { memory: {} } },
        OPENAI_LANGUAGE_KEYS,
      ],
      [
        "azure with modelFamily",
        {
          provider: "azure",
          providerConfig: {
            azure: {
              apiKey: "az-key",
              secondaryApiKey: "az-key-2",
              resourceName: "eastus-chat",
              baseUrl: "https://eastus-chat.openai.azure.com/openai",
              apiVersion: "2025-04-01-preview",
              model: "askdb-reporting",
              modelFamily: "gpt-5",
            },
          },
        },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "azure",
          AZURE_OPENAI_API_KEY: "az-key",
          AZURE_OPENAI_API_KEY_SECONDARY: "az-key-2",
          AZURE_OPENAI_DEPLOYMENT: "askdb-reporting",
          AZURE_DEPLOYMENT_NAME: "askdb-reporting",
          ASKDB_AI_MODEL: "askdb-reporting",
          ASKDB_AI_AZURE_RESOURCE_NAME: "eastus-chat",
          AZURE_OPENAI_BASE_URL: "https://eastus-chat.openai.azure.com/openai",
          AZURE_OPENAI_API_VERSION: "2025-04-01-preview",
          ASKDB_AI_AZURE_MODEL_FAMILY: "gpt-5",
        },
      ],
      [
        "foundry with the default deployment",
        { provider: "foundry", providerConfig: { foundry: { apiKey: "fd-key", resourceName: "my-foundry" } } },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "foundry",
          AZURE_OPENAI_API_KEY: "fd-key",
          AZURE_OPENAI_DEPLOYMENT: "gpt-4o-mini",
          AZURE_DEPLOYMENT_NAME: "gpt-4o-mini",
          ASKDB_AI_MODEL: "gpt-4o-mini",
          ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        },
      ],
      [
        "anthropic",
        { provider: "anthropic", providerConfig: { anthropic: { apiKey: "ant-key", baseUrl: "https://ant.example", model: "claude-opus-4-8" } } },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "anthropic",
          ANTHROPIC_API_KEY: "ant-key",
          ANTHROPIC_BASE_URL: "https://ant.example",
          ASKDB_AI_MODEL: "claude-opus-4-8",
        },
      ],
      [
        "google with the default model",
        { provider: "google", providerConfig: { google: { apiKey: "g-key", baseUrl: "https://g.example" } } },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "google",
          GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
          GOOGLE_AI_BASE_URL: "https://g.example",
          ASKDB_AI_MODEL: "gemini-2.0-flash",
        },
      ],
      [
        "gateway",
        {
          provider: "gateway",
          providerConfig: { gateway: { apiKey: "gw-key", baseUrl: "https://gw.example/v3/ai", model: "anthropic/claude-sonnet-4-6" } },
        },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "gateway",
          AI_GATEWAY_API_KEY: "gw-key",
          ASKDB_AI_BASE_URL: "https://gw.example/v3/ai",
          ASKDB_AI_MODEL: "anthropic/claude-sonnet-4-6",
        },
      ],
      [
        "a custom provider under providerConfig.custom",
        {
          provider: "mistral",
          providerConfig: { custom: { apiKey: "mistral-key", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-2" } },
        },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "mistral",
          ASKDB_AI_API_KEY: "mistral-key",
          ASKDB_AI_BASE_URL: "https://api.mistral.ai/v1",
          ASKDB_AI_MODEL: "mistral-large-2",
        },
      ],
      [
        "ai.reasoning",
        {
          provider: "openai",
          providerConfig: { openai: { apiKey: "oai-key" } },
          reasoning: { effort: "low", nlToSql: "high", enrichment: "minimal" },
        },
        MOCK_RAG,
        {
          ASKDB_AI_PROVIDER: "openai",
          OPENAI_API_KEY: "oai-key",
          OPENAI_MODEL: "gpt-4o-mini",
          ASKDB_MODEL: "gpt-4o-mini",
          ASKDB_AI_REASONING_EFFORT: "low",
          ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "high",
          ASKDB_AI_REASONING_EFFORT_ENRICHMENT: "minimal",
        },
      ],
    ])("a legacy %s config flattens to the same language keys as before", (_name, ai, rag, expected) => {
      expect(aiKeys(flattenAskDbConfig(config(ai, rag)))).toEqual(expected);
    });

    it.each([
      ["no openai connection", { provider: "anthropic", providerConfig: { anthropic: { apiKey: "ant-key" } } }, "rag-key", "default", undefined],
      ["the language connection's key", OPENAI_AI, "oai-key", "default", "https://oai.example/v1"],
      ["a key of its own", OPENAI_AI, "rag-key", "rag-embeddings", "https://oai.example/v1"],
    ] satisfies [string, AskDbConfig["ai"], string, string, string | undefined][])(
      'rag.embedder "openai" with %s embeds through the right openai connection',
      (_name, ai, ragKey, connection, baseUrl) => {
        const rt = runtimeFor(
          config(ai, {
            embedder: "openai",
            embedderConfig: { openai: { apiKey: ragKey } },
            store: "memory",
            storeConfig: { memory: {} },
          }),
        );
        expect(rt.ai.embedding).toMatchObject({ provider: "openai", connection, model: "text-embedding-3-small" });
        expect(rt.ai.embedding?.env.OPENAI_API_KEY).toBe(ragKey);
        expect(rt.ai.embedding?.env.OPENAI_BASE_URL).toBe(baseUrl);
        expect(rt.rag.embedder.apiKey).toBe(ragKey);
      },
    );

    it("embeds through a second connection of the same provider", () => {
      const designExample = {
        ...minimalConfig(),
        ai: {
          provider: "anthropic",
          providerConfig: {
            anthropic: { apiKey: "ant-key" },
            azure: [
              { resourceName: "eastus-chat", apiKey: "chat-key" },
              { name: "westus", resourceName: "westus-embed", apiKey: "embed-key" },
            ],
          },
          language: { model: "claude-sonnet-4-6", reasoning: { effort: "low", nlToSql: "medium" } },
          embedding: { provider: "azure", connection: "westus", model: "text-embedding-3-small", dimensions: 1536 },
        },
        rag: { embedder: "ai", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://pgvector/db" } } },
      } satisfies AskDbConfig;
      const rt = runtimeFor(designExample);
      expect(rt.ai.embedding?.env).toEqual({
        ASKDB_AI_PROVIDER: "azure",
        AZURE_OPENAI_API_KEY: "embed-key",
        ASKDB_AI_AZURE_RESOURCE_NAME: "westus-embed",
        ASKDB_AI_EMBEDDING_MODEL: "text-embedding-3-small",
      });
      expect(rt.ai.language).toMatchObject({ provider: "anthropic", connection: "default", model: "claude-sonnet-4-6" });
      expect(rt.ai.language.env.ASKDB_AI_REASONING_EFFORT_NL_TO_SQL).toBe("medium");
      expect(rt.ai.embedding?.dimensions).toBe(1536);
      expect(rt.deprecations).toEqual([]);
    });

    it("translates the documented gateway setup (an openai/ embedding model id)", () => {
      const rt = runtimeFor(
        config(
          { provider: "gateway", providerConfig: { gateway: { apiKey: "gw-key" } } },
          {
            embedder: "ai-sdk",
            embedderConfig: { openai: { model: "openai/text-embedding-3-small" } },
            store: "memory",
            storeConfig: { memory: {} },
          },
        ),
      );
      expect(rt.ai.embedding).toMatchObject({ provider: "gateway", model: "openai/text-embedding-3-small" });
      expect(rt.ai.embedding?.env).toEqual({
        ASKDB_AI_PROVIDER: "gateway",
        AI_GATEWAY_API_KEY: "gw-key",
        ASKDB_AI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      });
      expect(rt.ai.embedding?.dimensions).toBeUndefined();
    });

    // Earlier versions assumed a width for a legacy embedder: 3072 for text-embedding-3-large, else 1536.
    it.each<[string, AskDbConfig["ai"], string, number]>([
      [
        "an Azure deployment name",
        { provider: "azure", providerConfig: { azure: { apiKey: "az-key", resourceName: "eastus" } } },
        "my-embedding-deployment",
        1536,
      ],
      [
        "an Azure deployment named after an OpenAI model",
        { provider: "azure", providerConfig: { azure: { apiKey: "az-key", resourceName: "eastus" } } },
        "text-embedding-3-small",
        1536,
      ],
      [
        "an openai/ id on the gateway",
        { provider: "gateway", providerConfig: { gateway: { apiKey: "gw-key" } } },
        "openai/text-embedding-3-large",
        1536,
      ],
      [
        "an OpenAI model id on a custom provider",
        { provider: "mistral", providerConfig: { mistral: { apiKey: "m-key" } } },
        "text-embedding-3-large",
        3072,
      ],
      ["an OpenAI model on openai", OPENAI_AI, "text-embedding-3-large", 3072],
    ])("a legacy embedder assumes no width for %s, and names the one earlier versions assumed", (_name, ai, model, earlier) => {
      const rt = runtimeFor(
        config(ai, { embedder: "ai-sdk", embedderConfig: { openai: { model } }, store: "memory", storeConfig: { memory: {} } }),
      );
      expect(rt.ai.embedding).toMatchObject({ model, dimensions: undefined });
      const asksToPin = rt.deprecations.filter((message) => message.includes("set ai.embedding.dimensions:"));
      expect(asksToPin).toEqual([expect.stringContaining(`set ai.embedding.dimensions: ${earlier}.`)]);
    });

    it.each<[string, AskDbConfig["ai"], AskDbConfig["rag"]]>([
      [
        "an embedding model of any width",
        { provider: "google", providerConfig: { google: { apiKey: "k" } }, embedding: { model: "gemini-embedding-001" } },
        { embedder: "ai", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://pg/db" } } },
      ],
      [
        "a legacy embedder",
        { provider: "azure", providerConfig: { azure: { apiKey: "k", resourceName: "eastus" } } },
        {
          embedder: "ai-sdk",
          embedderConfig: { openai: { model: "my-embedding-deployment" } },
          store: "pgvector",
          storeConfig: { pgvector: { databaseUrl: "postgres://pg/db" } },
        },
      ],
    ])("loads pgvector with %s and no width set: the width comes from the model when the index is built", (_case, ai, rag) => {
      const rt = runtimeFor(config(ai, rag));
      expect(rt.ai.embedding?.dimensions).toBeUndefined();
    });

    it.each<[string, AskDbConfig["rag"]]>([
      [
        "rag.storeConfig.pgvector.dimensions",
        { embedder: "openai", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://pg/db", dimensions: "abc" } } },
      ],
      [
        "rag.embedderConfig.openai.dimension",
        { embedder: "openai", embedderConfig: { openai: { dimension: "0" } }, store: "memory", storeConfig: { memory: {} } },
      ],
    ])("reports an invalid legacy %s as ignored", (key, rag) => {
      const rt = runtimeFor(config(OPENAI_AI, rag));
      expect(rt.ai.embedding?.dimensions).toBeUndefined();
      expect(rt.deprecations.some((message) => message.includes(key) && message.includes("isn't a positive integer"))).toBe(
        true,
      );
    });

    it.each<[string, AskDbConfig, RegExp]>([
      [
        "duplicate connection names",
        config({ provider: "azure", providerConfig: { azure: [{ resourceName: "a" }, { name: "default", resourceName: "b" }] } }),
        /ai\.providerConfig\.azure has more than one connection named "default"/,
      ],
      [
        "an unknown connection",
        config({ provider: "openai", providerConfig: { openai: { apiKey: "k" } }, language: { connection: "eu" } }),
        /ai\.language\.connection is "eu", but ai\.providerConfig\.openai has no connection by that name \(it has: "default"\)/,
      ],
      [
        "no default connection among several",
        config({ provider: "azure", providerConfig: { azure: [{ name: "westus", resourceName: "w" }] } }),
        /ai\.providerConfig\.azure has no connection named "default" \(it has: "westus"\)/,
      ],
      [
        "an ai.embedding provider with no connection",
        config(
          { provider: "anthropic", providerConfig: { anthropic: { apiKey: "k" } }, embedding: { provider: "openai", model: "text-embedding-3-small" } },
          { embedder: "ai", store: "memory", storeConfig: { memory: {} } },
        ),
        /ai\.providerConfig\.openai is required when ai\.embedding\.provider is "openai"/,
      ],
      [
        "a custom provider with only named connections",
        config({ provider: "mistral", providerConfig: { mistral: [{ name: "eu", apiKey: "k" }] }, language: { model: "m" } }),
        /ai\.providerConfig\.mistral has no connection named "default" \(it has: "eu"\)/,
      ],
      [
        "no provider for the language section",
        config({ providerConfig: { openai: { apiKey: "k" } } }),
        /ai\.language has no provider; set ai\.language\.provider or ai\.provider/,
      ],
      [
        "anthropic as the ai.embedding provider",
        config(
          { provider: "anthropic", providerConfig: { anthropic: { apiKey: "k" } }, embedding: { model: "voyage-3" } },
          { embedder: "ai", store: "memory", storeConfig: { memory: {} } },
        ),
        /anthropic has no embeddings API; set ai\.embedding\.provider/,
      ],
      [
        'rag.embedder "ai" without a model',
        config(OPENAI_AI, { embedder: "ai", store: "memory", storeConfig: { memory: {} } }),
        /rag\.embedder is "ai" but ai\.embedding\.model is not set/,
      ],
      [
        'a legacy "ai-sdk" embedder on a provider with no default embedding model',
        config(
          { provider: "google", providerConfig: { google: { apiKey: "k" } } },
          { embedder: "ai-sdk", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
        ),
        /rag\.embedder "ai-sdk" embeds with "google", which has no default embedding model/,
      ],
      [
        'a legacy "openai" embedder whose provider has only named connections',
        config(
          { provider: "anthropic", providerConfig: { anthropic: { apiKey: "k" }, openai: [{ name: "eu", apiKey: "k" }] } },
          { embedder: "openai", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
        ),
        /ai\.providerConfig\.openai has no connection named "default" \(it has: "eu"\)/,
      ],
      [
        "pgvector dimensions that disagree with ai.embedding.dimensions",
        config(
          { ...OPENAI_AI, embedding: { model: "text-embedding-3-small", dimensions: 1536 } },
          { embedder: "ai", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://pg/db", dimensions: 768 } } },
        ),
        /ai\.embedding\.dimensions is 1536 but rag\.storeConfig\.pgvector\.dimensions is 768/,
      ],
      [
        "ai.reasoning plus ai.language.reasoning",
        config({ ...OPENAI_AI, reasoning: { effort: "low" }, language: { reasoning: { effort: "high" } } }),
        /ai\.reasoning and ai\.language\.reasoning are both set/,
      ],
      [
        "ai.embedding with a legacy rag.embedder",
        config(
          { ...OPENAI_AI, embedding: { model: "text-embedding-3-small" } },
          { embedder: "openai", store: "memory", storeConfig: { memory: {} } },
        ),
        /ai\.embedding is set but rag\.embedder is "openai"; set rag\.embedder: "ai"/,
      ],
      [
        'rag.embedderConfig with rag.embedder "ai"',
        config(
          { ...OPENAI_AI, embedding: { model: "text-embedding-3-small" } },
          { embedder: "ai", embedderConfig: { openai: { dimension: 512 } }, store: "memory", storeConfig: { memory: {} } },
        ),
        /rag\.embedderConfig is set but rag\.embedder is "ai"/,
      ],
    ])("refuses %s at load", (_name, input, error) => {
      expect(() => flattenAskDbConfig(input)).toThrow(error);
    });

    it("names a wrong ai.embedding.dimensions without echoing the value it holds", () => {
      const embedding = { model: "text-embedding-3-small", dimensions: { apiKey: "sk-live-secret" } as unknown as number };
      let message = "";
      try {
        defineConfig(config({ ...OPENAI_AI, embedding }, { embedder: "ai", store: "memory", storeConfig: { memory: {} } }));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe("askdb.config: ai.embedding.dimensions must be a positive integer (got an object).");
    });

    it("names each legacy key once in its deprecation message, and never a value", () => {
      const legacy = {
        ai: {
          provider: "azure",
          providerConfig: {
            azure: { apiKey: "az-secret", resourceName: "eastus", model: "askdb-reporting", modelFamily: "gpt-5" },
          },
          reasoning: { effort: "low" },
        },
        introspection: { provider: "postgres", providerConfig: { postgres: {} } },
        rag: {
          embedder: "ai-sdk",
          embedderConfig: {
            openai: {
              model: "embedding-deployment",
              dimension: 1536,
              apiKey: "rag-secret",
              baseUrl: "https://westus-secret.openai.azure.com/openai",
            },
          },
          store: "pgvector",
          storeConfig: { pgvector: { databaseUrl: "postgres://pg-secret@db/rag", dimensions: 1536 } },
        },
      } satisfies AskDbConfig;
      const { deprecations } = defineConfig(legacy);
      for (const key of [
        "ai.providerConfig.azure.model",
        "ai.providerConfig.azure.modelFamily",
        "ai.reasoning",
        'rag.embedder "ai-sdk"',
        "rag.embedderConfig.openai.model",
        "rag.embedderConfig.openai.dimension",
        "rag.embedderConfig.openai.apiKey",
        "rag.embedderConfig.openai.baseUrl",
        "rag.storeConfig.pgvector.dimensions",
      ]) {
        expect(deprecations?.filter((message) => message.includes(`${key} `)), key).toHaveLength(1);
      }
      for (const secret of ["secret", "askdb-reporting", "embedding-deployment"]) {
        expect(deprecations?.join("\n")).not.toContain(secret);
      }
      // The legacy keys still drive the same settings.
      const { language } = runtimeFor(legacy).ai;
      expect(language.model).toBe("askdb-reporting");
      expect(language.modelFamily).toBe("gpt-5");
      expect(language.env.ASKDB_AI_REASONING_EFFORT).toBe("low");
    });

    it("prefers ai.language.model over a legacy provider model, and says the legacy one is ignored", () => {
      const { deprecations } = defineConfig(config({ ...OPENAI_AI, language: { model: "gpt-5" } }));
      expect(runtimeFor(config({ ...OPENAI_AI, language: { model: "gpt-5" } })).ai.language.model).toBe("gpt-5");
      expect(deprecations).toEqual([
        "askdb.config: ai.providerConfig.openai.model is deprecated and ignored because ai.language.model is set; remove it.",
      ]);
    });

    it.each([
      ["an empty rag.embedderConfig", {}, []],
      [
        "a rag.embedderConfig with values",
        { openai: { model: "text-embedding-3-small" } },
        ['askdb.config: rag.embedderConfig is ignored because rag.embedder is "mock"; remove it.'],
      ],
    ] satisfies [string, NonNullable<NonNullable<AskDbConfig["rag"]>["embedderConfig"]>, string[]][])(
      'warns about %s with rag.embedder "mock" only when it holds a value',
      (_name, embedderConfig, expected) => {
        const ai = { provider: "openai", providerConfig: { openai: { apiKey: "k" } } } satisfies AskDbConfig["ai"];
        const { deprecations } = defineConfig(
          config(ai, { embedder: "mock", embedderConfig, store: "memory", storeConfig: { memory: {} } }),
        );
        expect(deprecations).toEqual(expected);
      },
    );

    it.each([
      [
        "the pgvector store with a width",
        { store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://x/db", dimensions: 128 } } },
        [
          'askdb.config: rag.storeConfig.pgvector.dimensions is ignored because rag.embedder is "mock" (its vectors are always 64 wide); remove it.',
        ],
      ],
      ["the pgvector store without one", { store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://x/db" } } }, []],
      [
        "another store, with an unused pgvector branch",
        { store: "memory", storeConfig: { memory: {}, pgvector: { dimensions: 128 } } },
        [],
      ],
    ] satisfies [string, Pick<NonNullable<AskDbConfig["rag"]>, "store" | "storeConfig">, string[]][])(
      'warns that rag.storeConfig.pgvector.dimensions does nothing with rag.embedder "mock": %s',
      (_name, store, expected) => {
        const ai = { provider: "openai", providerConfig: { openai: { apiKey: "k" } } } satisfies AskDbConfig["ai"];
        const { deprecations } = defineConfig(config(ai, { embedder: "mock", ...store }));
        expect(deprecations).toEqual(expected);
      },
    );

    it('writes the mock embedder\'s own width to the flat map, not rag.storeConfig.pgvector.dimensions', () => {
      const ai = { provider: "openai", providerConfig: { openai: { apiKey: "k" } } } satisfies AskDbConfig["ai"];
      const { entries } = defineConfig(
        config(ai, { embedder: "mock", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://x/db", dimensions: 128 } } }),
      );
      expect(entries.ASKDB_RAG_EMBEDDER_DIMENSIONS).toBe("64");
    });
  });
});

describe("loadAskDbConfigProjectionSync", () => {
  let dir: string;
  afterEach(() => {
    resetAskDbRuntimeForTests();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each(ASKDB_AI_PROVIDERS)(
    "the scaffolded %s ai block loads and reads every env var it lists",
    (provider) => {
      dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
      linkWorkspacePackage(dir);
      const scaffold = renderAskDbAiConfigScaffold({ provider, keyEnv: "MY_KEY", modelEnv: "MY_MODEL" });
      writeFileSync(
        join(dir, "askdb.config.ts"),
        `import { defineConfig, env, type AskDbConfig } from "@askdb/config";
export default defineConfig({
${scaffold.source}
  introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://x/y" } }, outputDir: "./out/" },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
} satisfies AskDbConfig);
`,
        "utf8",
      );
      const names = scaffold.envVars.map((v) => v.name);
      for (const name of names) process.env[name] = `value-of-${name}`;
      try {
        const { projection } = loadAskDbConfigProjectionSync(dir);
        expect(projection?.entries.ASKDB_AI_PROVIDER).toBe(provider);
        expect(projection?.deprecations).toEqual([]);
        const values = Object.values(projection?.entries ?? {});
        for (const name of names) expect(values).toContain(`value-of-${name}`);
        // Azure / Foundry can't start without a resource name or endpoint.
        const isAzure = provider === "azure" || provider === "foundry";
        expect(names.includes("AZURE_RESOURCE_NAME")).toBe(isAzure);
        if (isAzure) {
          expect(projection?.entries.ASKDB_AI_AZURE_RESOURCE_NAME).toBe("value-of-AZURE_RESOURCE_NAME");
        }
      } finally {
        for (const name of names) delete process.env[name];
      }
    },
  );

  // #265: a plain object goes through the same normalizing step as defineConfig. Its deprecated
  // keys must be translated and listed on the projection, which bootstrapAskDbEnv() warns from.
  it("normalizes a plain object like defineConfig: deprecated keys are translated and listed", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `export default {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "k" } }, reasoning: { effort: "low" } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
};
`,
      "utf8",
    );
    const { projection } = loadAskDbConfigProjectionSync(dir);
    expect(projection?.deprecations).toEqual([
      "askdb.config: ai.reasoning is deprecated; move it to ai.language.reasoning.",
    ]);
    expect(projection?.entries.ASKDB_AI_REASONING_EFFORT).toBe("low");
  });

  // #626: a config that can't load fails with an error that names the file and what is wrong,
  // whether the error is thrown inside the file (defineConfig), while loading it, or by the loader.
  const BLOCKS = `ai: { provider: "openai", providerConfig: { openai: { apiKey: "k" } } }, introspection: { provider: "postgres" }`;
  it.each([
    [
      "defineConfig without an ai block",
      "askdb.config.ts",
      `import { defineConfig } from "@askdb/config";\nexport default defineConfig({ dialect: "postgres" });\n`,
      "the config has no ai block;",
    ],
    [
      "a plain object without an introspection block",
      "askdb.config.ts",
      `export default { ai: { provider: "openai", providerConfig: { openai: { apiKey: "k" } } } };\n`,
      "the config has no introspection block;",
    ],
    ["a default export that isn't an object", "askdb.config.ts", `export default "openai";\n`, "the default export isn't a config object;"],
    ["a null default export", "askdb.config.ts", `export default null;\n`, "the default export isn't a config object;"],
    ["a file with no default export", "askdb.config.ts", `export const config = { ${BLOCKS} };\n`, "the file has no default export;"],
    ["a Promise default export", "askdb.config.ts", `export default Promise.resolve({ ${BLOCKS} });\n`, "the default export is a Promise;"],
    [
      "top-level await",
      "askdb.config.mjs",
      `await Promise.resolve();\nexport default { ${BLOCKS} };\n`,
      "AskDB loads the config file synchronously, so it can't use top-level await",
    ],
    [
      "an unknown pgvector indexStrategy",
      "askdb.config.ts",
      `export default { ${BLOCKS}, rag: { embedder: "mock", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "postgres://x/y", indexStrategy: "bogus" } } } };\n`,
      'invalid rag.storeConfig.pgvector.indexStrategy "bogus"',
    ],
  ])("names the file when %s fails to load", (_case, file, source, message) => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    writeFileSync(join(dir, file), source, "utf8");
    expect(() => loadAskDbConfigProjectionSync(dir)).toThrow(`AskDB config at ${join(dir, file)}: ${message}`);
  });

  // A config may default-import a CommonJS package (`import dotenv from "dotenv"`, as the installable
  // smoke's config does), which needs jiti's default interop on. Reading the file's own default export
  // must not turn it off.
  it("loads a config that default-imports a CommonJS module", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    writeFileSync(join(dir, "key.cjs"), `module.exports = { apiKey: "from-cjs" };\n`, "utf8");
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import key from "./key.cjs";\nexport default { ai: { provider: "openai", providerConfig: { openai: { apiKey: key.apiKey } } }, introspection: { provider: "postgres" } };\n`,
      "utf8",
    );
    const { projection } = loadAskDbConfigProjectionSync(dir);
    expect(projection?.entries.OPENAI_API_KEY).toBe("from-cjs");
  });

  // The async loader imports .mjs with native import(), not jiti, so its own path gets its own cases.
  it("loadAskDbConfigProjection, the async loader, loads a plain-object askdb.config.mjs", async () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    writeFileSync(
      join(dir, "askdb.config.mjs"),
      `export default { ai: { provider: "openai", providerConfig: { openai: { apiKey: "k" } } }, introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/async" } } } };\n`,
      "utf8",
    );
    const { projection } = await loadAskDbConfigProjection(dir);
    expect(projection?.entries.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://localhost/async");
  });

  it.each([
    ["no ai block", `export default { introspection: { provider: "postgres" } };\n`, "the config has no ai block;"],
    ["no default export", `export const config = { ${BLOCKS} };\n`, "the file has no default export;"],
  ])("loadAskDbConfigProjection names the file when an askdb.config.mjs has %s", async (_case, source, message) => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    writeFileSync(join(dir, "askdb.config.mjs"), source, "utf8");
    await expect(loadAskDbConfigProjection(dir)).rejects.toThrow(
      `AskDB config at ${join(dir, "askdb.config.mjs")}: ${message}`,
    );
  });

  it("the ai scaffold rejects an unknown provider, which it would emit as an object key", () => {
    expect(() =>
      renderAskDbAiConfigScaffold({ provider: "__proto__" as "openai", keyEnv: "MY_KEY" }),
    ).toThrow('Unknown AI provider: "__proto__"');
  });

});

describe("getAskDbRuntimeConfig — introspection", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  it("resolves only the active engine's connection", () => {
    setAskDbRuntimeForTests(
      minimalConfig({
        introspection: {
          provider: "postgres",
          providerConfig: {
            postgres: { databaseUrl: "postgres://localhost/db" },
            mysql: { databaseUrl: "mysql://nope/db" },
            sqlite: { file: "./nope.db" },
            sqlserver: { databaseUrl: "Server=nope;Database=app;" },
          },
        },
      }),
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.provider).toBe("postgres");
    expect(rt.introspection.postgresDatabaseUrl).toBe("postgres://localhost/db");
    expect(rt.introspection.mysqlDatabaseUrl).toBeUndefined();
    expect(rt.introspection.sqliteFile).toBeUndefined();
    expect(rt.introspection.sqlserverDatabaseUrl).toBeUndefined();
  });
});

describe("getAskDbRuntimeConfig — studio execute branches", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function installStudio(
    studio: AskDbConfig["studio"],
    intro: AskDbConfig["introspection"] = { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  ): void {
    setAskDbRuntimeForTests(minimalConfig({ introspection: intro, studio }));
  }

  it("uses explicit studio.execute.provider when set", () => {
    installStudio(
      { execute: { provider: "mysql", databaseUrl: "mysql://host/db" } },
      { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("mysql");
    expect(rt.studio.execute.databaseUrl).toBe("mysql://host/db");
  });

  it("falls back to introspection provider when no execute provider is set", () => {
    installStudio(
      { execute: { useIntrospectionConnection: true } },
      { provider: "mysql", providerConfig: { mysql: { databaseUrl: "mysql://intro/db" } }, outputDir: "./askdb/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("mysql");
    expect(rt.studio.execute.databaseUrl).toBe("mysql://intro/db");
  });

  it("falls back to introspection provider for sqlserver", () => {
    installStudio(
      { execute: { useIntrospectionConnection: true } },
      { provider: "sqlserver", providerConfig: { sqlserver: { databaseUrl: "Server=localhost;Database=app;" } }, outputDir: "./askdb/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("sqlserver");
    expect(rt.studio.execute.databaseUrl).toBe("Server=localhost;Database=app;");
  });

  it("falls back to postgres when introspection is prisma (schema-only provider)", () => {
    installStudio(
      undefined,
      { provider: "prisma", providerConfig: { prisma: {} }, outputDir: "./askdb/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("postgres");
  });

  it("resolves sqlite file from studio.execute.file", () => {
    installStudio(
      { execute: { provider: "sqlite", file: "./local.db" } },
      { provider: "sqlite", providerConfig: { sqlite: { file: "./introspect.db" } }, outputDir: "./askdb/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("sqlite");
    expect(rt.studio.execute.file).toBe("./local.db");
    expect(rt.studio.execute.databaseUrl).toBeUndefined();
  });

  it("falls back to introspection sqlite file when studio.execute.file is absent", () => {
    installStudio(
      { execute: { useIntrospectionConnection: true } },
      { provider: "sqlite", providerConfig: { sqlite: { file: "./data/app.db" } }, outputDir: "./askdb/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("sqlite");
    expect(rt.studio.execute.file).toBe("./data/app.db");
  });
});

describe("getAskDbRuntimeConfig — studio execute safety defaults", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function install(studio: AskDbConfig["studio"]): void {
    setAskDbRuntimeForTests(
      minimalConfig({
        introspection: {
          provider: "postgres",
          providerConfig: { postgres: { databaseUrl: "postgres://introspect/db" } },
          outputDir: "./askdb/",
        },
        studio,
      }),
    );
  }

  it("does not reuse introspection credentials unless useIntrospectionConnection is on", () => {
    install({ execute: { enabled: true } });
    const exec = getAskDbRuntimeConfig().studio.execute;
    expect(exec.enabled).toBe(true);
    expect(exec.databaseUrl).toBeUndefined();
    expect(exec.introspectionConnectionAvailable).toBe(true);

    install({ execute: { enabled: true, useIntrospectionConnection: true } });
    const reused = getAskDbRuntimeConfig().studio.execute;
    expect(reused.databaseUrl).toBe("postgres://introspect/db");
    expect(reused.introspectionConnectionAvailable).toBe(false);
  });

  it("prefers an explicit execute connection over the introspection one", () => {
    install({ execute: { enabled: true, useIntrospectionConnection: true, databaseUrl: "postgres://readonly/db" } });
    expect(getAskDbRuntimeConfig().studio.execute.databaseUrl).toBe("postgres://readonly/db");
  });

  it("flattens enabled, timeoutMs, and maxRows to canonical keys", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        studio: { execute: { enabled: true, useIntrospectionConnection: false, timeoutMs: 5000, maxRows: 25 } },
      }),
    );
    expect(flat.ASKDB_STUDIO_EXECUTE_ENABLED).toBe("true");
    expect(flat.ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION).toBe("false");
    expect(flat.ASKDB_STUDIO_EXECUTE_TIMEOUT_MS).toBe("5000");
    expect(flat.ASKDB_STUDIO_EXECUTE_MAX_ROWS).toBe("25");
  });
});

describe("bootstrapAskDbEnv", () => {
  let dir: string;
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevMyAi = process.env.MY_AI;
  const prevDb = process.env.MY_DB;

  afterEach(() => {
    resetAskDbRuntimeForTests();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevMyAi === undefined) delete process.env.MY_AI;
    else process.env.MY_AI = prevMyAi;
    if (prevDb === undefined) delete process.env.MY_DB;
    else process.env.MY_DB = prevDb;
  });

  it("loads .env then installs runtime from nested askdb.config", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    writeFileSync(join(dir, ".env"), "MY_AI=dog\nMY_DB=postgres://localhost/db\n", "utf8");
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import { defineConfig, env, type AskDbConfig } from "@askdb/config";
       export default defineConfig({
         ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_AI") } }, language: { model: "gpt-4o-mini" } },
         introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: env("MY_DB") } }, outputDir: "./askdb/" },
         rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
       } satisfies AskDbConfig);
    `,
      "utf8",
    );

    expect(isAskDbRuntimeInitialized()).toBe(false);
    bootstrapAskDbEnv({ cwd: dir });
    expect(isAskDbRuntimeInitialized()).toBe(true);
    const rt = getAskDbRuntimeConfig();
    expect(rt.ai.aiEnv.OPENAI_API_KEY).toBe("dog");
    expect(rt.introspection.postgresDatabaseUrl).toBe("postgres://localhost/db");
    delete process.env.MY_AI;
    delete process.env.MY_DB;
  });

  // The docs list ts → mts → cts → js → mjs → cjs and show a plain `export default { … }`
  // with `env` imported from @askdb/config (guides/switch-engines, guides/bring-your-own-model).
  // Before #264 the synchronous loader threw for .mjs; before #265 it rejected any plain object.
  it.each(["ts", "mts", "cts", "js", "mjs", "cjs"])(
    "loads a plain-object askdb.config.%s, the form the guides show",
    (ext) => {
      dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
      linkWorkspacePackage(dir);
      const body = `{
  ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_AI") } } },
  introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/${ext}" } } },
}`;
      writeFileSync(
        join(dir, `askdb.config.${ext}`),
        ext === "cjs"
          ? `const { env } = require("@askdb/config");\nmodule.exports = ${body};\n`
          : `import { env } from "@askdb/config";\nexport default ${body};\n`,
        "utf8",
      );
      process.env.MY_AI = `key-${ext}`;

      bootstrapAskDbEnv({ cwd: dir });
      const rt = getAskDbRuntimeConfig();
      expect(rt.ai.aiEnv.OPENAI_API_KEY).toBe(`key-${ext}`);
      expect(rt.introspection.postgresDatabaseUrl).toBe(`postgres://localhost/${ext}`);
      expect(rt.introspection.outputDir).toBe("./askdb/");
    },
  );

  it("reports each deprecated key once per process as a DeprecationWarning", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    // Deliberately the legacy shape: `ai.reasoning` instead of `ai.language.reasoning`.
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import { defineConfig, type AskDbConfig } from "@askdb/config";
       export default defineConfig({
         ai: { provider: "openai", providerConfig: { openai: { apiKey: "k" } }, reasoning: { effort: "low" } },
         introspection: { provider: "postgres", providerConfig: { postgres: {} } },
         rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
       } satisfies AskDbConfig);
    `,
      "utf8",
    );
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      bootstrapAskDbEnv({ cwd: dir });
      bootstrapAskDbEnv({ cwd: dir });
      const message = "askdb.config: ai.reasoning is deprecated; move it to ai.language.reasoning.";
      expect(emitWarning.mock.calls).toEqual([
        [message, { type: "DeprecationWarning", code: "ASKDB_CONFIG_DEPRECATED" }],
      ]);
      expect(getAskDbRuntimeConfig().deprecations).toEqual([message]);
      expect(getAskDbRuntimeConfig().ai.language.env.ASKDB_AI_REASONING_EFFORT).toBe("low");
    } finally {
      emitWarning.mockRestore();
    }
  });
});

describe("getAskDbRuntimeConfig — httpApi", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function install(httpApi: AskDbConfig["httpApi"]): void {
    setAskDbRuntimeForTests(minimalConfig(httpApi ? { httpApi } : {}));
  }

  // A JavaScript config isn't type-checked; these used to throw a bare TypeError from `.trim()`.
  it("rejects a requestTimeoutMs that is neither a number nor a string with an error naming the key", () => {
    for (const requestTimeoutMs of [true, null, {}]) {
      expect(() =>
        defineConfig(minimalConfig({ httpApi: { requestTimeoutMs } as unknown as AskDbConfig["httpApi"] })),
      ).toThrow(/askdb\.config: invalid httpApi\.requestTimeoutMs/);
    }
  });

  // Node timers cap at 2^31 - 1 ms: a larger AbortSignal.timeout() fires after ~1 ms
  // (or throws ERR_OUT_OF_RANGE past 2^32 - 1), so every request would fail.
  it("accepts requestTimeoutMs up to the Node timer maximum and rejects anything larger at load", () => {
    install({ requestTimeoutMs: 2_147_483_647 });
    expect(getAskDbRuntimeConfig().httpApi.requestTimeoutMs).toBe(2_147_483_647);
    for (const requestTimeoutMs of [2_147_483_648, 3e9, 5e9]) {
      expect(() => defineConfig(minimalConfig({ httpApi: { requestTimeoutMs } }))).toThrow(
        /httpApi\.requestTimeoutMs.*at most 2147483647/,
      );
    }
  });

  // `Number(env("PORT"))` with PORT unset is NaN, which used to reach listen() (#676).
  it("treats a NaN listen.port as unset", () => {
    install({ listen: { port: Number(env("ASKDB_TEST_PORT_676_NEVER_SET")) } });
    expect(getAskDbRuntimeConfig().httpApi.listen.port).toBe(3000);
  });

  it("accepts a listen.port from 0 to 65535, or a string holding one", () => {
    for (const [port, expected] of [
      [0, 0],
      [8080, 8080],
      [65535, 65535],
      ["8080", 8080],
      [" 4000 ", 4000],
    ] as const) {
      install({ listen: { port } as unknown as NonNullable<AskDbConfig["httpApi"]>["listen"] });
      expect(getAskDbRuntimeConfig().httpApi.listen.port).toBe(expected);
    }
  });

  it("rejects any other listen.port when the config loads, naming the key", () => {
    for (const port of [65536, 70000, -1, 1.5, Infinity, "abc", "", "80.5", true, null]) {
      const httpApi = { listen: { port } } as unknown as AskDbConfig["httpApi"];
      expect(() => defineConfig(minimalConfig({ httpApi }))).toThrow(/askdb\.config: invalid httpApi\.listen\.port/);
    }
  });
});

// A child process's env is built from the flat map (`mergeAskDbFlatIntoEnvMap`), so a key the
// config doesn't set must not appear there with its default: `PORT=3000` would reach every child.
describe("flattenAskDbConfig — optional keys", () => {
  const OPTIONAL_KEYS = [
    "PORT",
    "HOST",
    "ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE",
    "ASKDB_HTTP_REQUEST_TIMEOUT_MS",
    "ASKDB_STUDIO_EXECUTE_PROVIDER",
    "ASKDB_STUDIO_EXECUTE_ENABLED",
    "ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION",
    "ASKDB_STUDIO_EXECUTE_TIMEOUT_MS",
    "ASKDB_STUDIO_EXECUTE_MAX_ROWS",
    "ASKDB_LOG_STDOUT",
    "ASKDB_OMIT_SENSITIVE_FROM_PROMPT",
  ];

  it.each([
    ["unset", minimalConfig()],
    [
      "set to undefined or NaN, as an unset env() read gives",
      minimalConfig({
        httpApi: { listen: { port: Number(env("ASKDB_TEST_PORT_711_NEVER_SET")), host: env("ASKDB_TEST_HOST_711_NEVER_SET") } },
        studio: { execute: { provider: undefined, enabled: undefined, timeoutMs: undefined } },
      }),
    ],
  ])("writes none of them when they are %s", (_name, config) => {
    const flat = flattenAskDbConfig(config);
    expect(OPTIONAL_KEYS.filter((key) => key in flat)).toEqual([]);
  });

  it("writes each one the config sets, with its resolved value", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        httpApi: { listen: { port: " 8080 " as unknown as number, host: " 0.0.0.0 " }, allowSchemaOverride: true, requestTimeoutMs: 1500 },
        studio: { execute: { provider: "mysql", enabled: false, useIntrospectionConnection: true, timeoutMs: 1000, maxRows: 25 } },
        logging: { logStdout: true },
        modes: { omitSensitiveFromPrompt: true },
      }),
    );
    expect(Object.fromEntries(OPTIONAL_KEYS.map((key) => [key, flat[key]]))).toEqual({
      PORT: "8080",
      HOST: "0.0.0.0",
      ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE: "true",
      ASKDB_HTTP_REQUEST_TIMEOUT_MS: "1500",
      ASKDB_STUDIO_EXECUTE_PROVIDER: "mysql",
      ASKDB_STUDIO_EXECUTE_ENABLED: "false",
      ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION: "true",
      ASKDB_STUDIO_EXECUTE_TIMEOUT_MS: "1000",
      ASKDB_STUDIO_EXECUTE_MAX_ROWS: "25",
      ASKDB_LOG_STDOUT: "true",
      ASKDB_OMIT_SENSITIVE_FROM_PROMPT: "true",
    });
  });
});

describe("getAskDbRuntimeConfig — each setting resolves once, from the authored config (#711)", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  type Setting = {
    /** The config key, as load errors name it. */
    key: string;
    /** The config with this setting at `value`; `undefined` is what an unset `env()` read gives. */
    config: (value: unknown) => AskDbConfig;
    /** Omitted for a key with no runtime section, which only the load check covers. */
    read?: (rt: AskDbRuntimeConfig) => unknown;
    valid?: readonly [authored: unknown, resolved: unknown];
    /** A value of the wrong type or outside the key's values. Omitted for keys AskDB doesn't check. */
    wrong?: unknown;
    /** The runtime value when the setting is unset. */
    unset?: unknown;
    /** `null` counts as unset, as a JavaScript config writes it. True for string keys. */
    nullIsUnset?: true;
  };

  const withLogging = (field: string) => (value: unknown) => minimalConfig({ logging: { [field]: value } as never });
  const withModes = (field: string) => (value: unknown) => minimalConfig({ modes: { [field]: value } as never });
  const withIntrospection =
    (provider: AskDbConfig["introspection"]["provider"], field: string) => (value: unknown) =>
      minimalConfig({ introspection: { provider, providerConfig: { [provider]: { [field]: value } } } as never });
  const withExecute = (field: string, extra: object = {}) => (value: unknown) =>
    minimalConfig({ studio: { execute: { ...extra, [field]: value } } as never });
  const withHttpApi = (field: string) => (value: unknown) => minimalConfig({ httpApi: { [field]: value } as never });
  const withListen = (field: string) => (value: unknown) =>
    minimalConfig({ httpApi: { listen: { [field]: value } } as never });

  const SETTINGS: Setting[] = [
    { key: "logging.level", config: withLogging("level"), read: (rt) => rt.logging.level, valid: ["debug", "debug"], wrong: "verbose", unset: undefined , nullIsUnset: true },
    { key: "logging.correlationId", config: withLogging("correlationId"), read: (rt) => rt.logging.correlationId, valid: [" run-1 ", "run-1"], wrong: 7, unset: undefined , nullIsUnset: true },
    { key: "logging.logFile", config: withLogging("logFile"), read: (rt) => rt.logging.logFile, valid: ["./askdb.log", "./askdb.log"], wrong: true, unset: undefined , nullIsUnset: true },
    { key: "logging.logStdout", config: withLogging("logStdout"), read: (rt) => rt.logging.logStdout, valid: [true, true], wrong: "true", unset: false },
    { key: "modes.askdbMode", config: withModes("askdbMode"), read: (rt) => rt.modes.askdbMode, valid: ["bounded_results", "bounded_results"], wrong: "results", unset: undefined , nullIsUnset: true },
    // The string "false" is truthy: before #711 it turned omission on without a word.
    { key: "modes.omitSensitiveFromPrompt", config: withModes("omitSensitiveFromPrompt"), read: (rt) => rt.modes.omitSensitiveFromPrompt, valid: [true, true], wrong: "false", unset: false },
    { key: "dev.mockSql", config: (value) => minimalConfig({ dev: { mockSql: value } as never }), read: (rt) => rt.dev.mockSql, valid: ["select 1", "select 1"], wrong: 1, unset: undefined , nullIsUnset: true },
    { key: "dialect", config: (value) => minimalConfig({ dialect: value as never }), read: (rt) => rt.nlToSql.dialect, valid: ["mysql", "mysql"], unset: undefined },
    {
      key: "introspection.outputDir",
      config: (value) => minimalConfig({ introspection: { provider: "postgres", outputDir: value } as never }),
      read: (rt) => rt.introspection.outputDir,
      valid: ["./schema/", "./schema/"],
      wrong: 1,
      unset: "./askdb/",
      nullIsUnset: true,
    },
    {
      key: "introspection.schemas",
      config: (value) => minimalConfig({ introspection: { provider: "postgres", schemas: value } as never }),
      read: (rt) => rt.introspection.schemas,
      valid: [[" public ", "sales"], ["public", "sales"]],
      wrong: "public",
      unset: undefined,
      nullIsUnset: true,
    },
    { key: "introspection.providerConfig.postgres.databaseUrl", config: withIntrospection("postgres", "databaseUrl"), read: (rt) => rt.introspection.postgresDatabaseUrl, valid: [" postgres://h/db ", "postgres://h/db"], wrong: 1, unset: undefined , nullIsUnset: true },
    { key: "introspection.providerConfig.mysql.databaseUrl", config: withIntrospection("mysql", "databaseUrl"), read: (rt) => rt.introspection.mysqlDatabaseUrl, valid: ["mysql://h/db", "mysql://h/db"], wrong: 1, unset: undefined , nullIsUnset: true },
    { key: "introspection.providerConfig.sqlite.file", config: withIntrospection("sqlite", "file"), read: (rt) => rt.introspection.sqliteFile, valid: ["./app.db", "./app.db"], wrong: 1, unset: undefined , nullIsUnset: true },
    { key: "introspection.providerConfig.sqlserver.databaseUrl", config: withIntrospection("sqlserver", "databaseUrl"), read: (rt) => rt.introspection.sqlserverDatabaseUrl, valid: ["Server=h;Database=app;", "Server=h;Database=app;"], wrong: 1, unset: undefined , nullIsUnset: true },
    { key: "introspection.providerConfig.prisma.schemaPath", config: withIntrospection("prisma", "schemaPath"), read: (rt) => rt.introspection.prismaSchemaPath, valid: ["./prisma/schema.prisma", "./prisma/schema.prisma"], wrong: 1, unset: undefined , nullIsUnset: true },
    {
      key: "rag.store",
      // Unset is a config without a rag block.
      config: (value) =>
        minimalConfig({ rag: value === undefined ? undefined : ({ embedder: "mock", store: value, storeConfig: { file: {} } } as never) }),
      read: (rt) => rt.rag.store,
      valid: ["file", "file"],
      wrong: "redis",
      unset: "memory",
    },
    { key: "httpApi.listen.port", config: withListen("port"), read: (rt) => rt.httpApi.listen.port, valid: ["8080", 8080], wrong: "abc", unset: 3000 },
    { key: "httpApi.listen.host", config: withListen("host"), read: (rt) => rt.httpApi.listen.host, valid: [" 0.0.0.0 ", "0.0.0.0"], wrong: 1, unset: "127.0.0.1" , nullIsUnset: true },
    { key: "httpApi.allowSchemaOverride", config: withHttpApi("allowSchemaOverride"), read: (rt) => rt.httpApi.allowSchemaOverride, valid: [true, true], wrong: "false", unset: false },
    { key: "httpApi.requestTimeoutMs", config: withHttpApi("requestTimeoutMs"), read: (rt) => rt.httpApi.requestTimeoutMs, valid: ["1500", 1500], wrong: 0, unset: 60_000 },
    { key: "studio.execute.enabled", config: withExecute("enabled"), read: (rt) => rt.studio.execute.enabled, valid: [true, true], wrong: "true", unset: false },
    { key: "studio.execute.useIntrospectionConnection", config: withExecute("useIntrospectionConnection"), read: (rt) => rt.studio.execute.useIntrospectionConnection, valid: [true, true], wrong: 1, unset: false },
    { key: "studio.execute.timeoutMs", config: withExecute("timeoutMs"), read: (rt) => rt.studio.execute.timeoutMs, valid: ["1000", 1000], wrong: 0, unset: 30_000 },
    { key: "studio.execute.maxRows", config: withExecute("maxRows"), read: (rt) => rt.studio.execute.maxRows, valid: [25, 25], wrong: 1.5, unset: 500 },
    // An unknown provider falls back like an unset one; only the type is checked.
    { key: "studio.execute.provider", config: withExecute("provider"), read: (rt) => rt.studio.execute.provider, valid: ["mysql", "mysql"], wrong: 3, unset: "postgres" , nullIsUnset: true },
    { key: "studio.execute.databaseUrl", config: withExecute("databaseUrl"), read: (rt) => rt.studio.execute.databaseUrl, valid: [" postgres://ro/db ", "postgres://ro/db"], wrong: 1, unset: undefined , nullIsUnset: true },
    { key: "studio.execute.file", config: withExecute("file", { provider: "sqlite" }), read: (rt) => rt.studio.execute.file, valid: ["./ro.db", "./ro.db"], wrong: 1, unset: undefined , nullIsUnset: true },
    // No runtime section: `createAskDb` and Studio read these from the structured config as written,
    // so a wrong type must fail at load rather than at the first call.
    { key: "host.schemaJson", config: (value) => minimalConfig({ host: { schemaJson: value } as never }), wrong: false },
    { key: "host.schemaPath", config: (value) => minimalConfig({ host: { schemaPath: value } as never }), wrong: {} },
    { key: "studio.listen.host", config: (value) => minimalConfig({ studio: { listen: { host: value } } as never }), wrong: 42 },
  ];

  const runtimeFor = (config: AskDbConfig): AskDbRuntimeConfig => {
    setAskDbRuntimeForTests(config);
    return getAskDbRuntimeConfig();
  };

  const WITH_RUNTIME = SETTINGS.filter((s) => s.read !== undefined).map((s) => [s.key, s] as const);

  it.each(WITH_RUNTIME)("resolves a valid %s", (_key, s) => {
    expect(s.read!(runtimeFor(s.config(s.valid![0])))).toEqual(s.valid![1]);
  });

  it.each(WITH_RUNTIME)("defaults an unset %s", (_key, s) => {
    expect(s.read!(runtimeFor(s.config(undefined)))).toEqual(s.unset);
  });

  it.each(WITH_RUNTIME.filter(([, s]) => s.nullIsUnset))("treats a null %s as unset", (_key, s) => {
    expect(s.read!(runtimeFor(s.config(null)))).toEqual(s.unset);
  });

  it.each(SETTINGS.filter((s) => "wrong" in s).map((s) => [s.key, s] as const))(
    "refuses a wrong %s at load, naming the config key",
    (key, s) => {
      let message = "";
      try {
        defineConfig(s.config(s.wrong));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message.startsWith("askdb.config: ")).toBe(true);
      expect(message).toContain(key);
      expect(message).not.toMatch(/\b(ASKDB_[A-Z_]+|PORT|HOST)\b/);
    },
  );

  // A function's text, or an object's, could hold a credential, so a load error describes it by type.
  it.each([
    ["a function", () => "postgres://admin:hunter2@db/prod", "a function"],
    ["an object", { url: "postgres://admin:hunter2@db/prod" }, "an object"],
  ])("names a databaseUrl set to %s without printing it", (_name, databaseUrl, described) => {
    const config = minimalConfig({
      introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: databaseUrl as never } } },
    });
    expect(() => defineConfig(config)).toThrow(
      `askdb.config: invalid introspection.providerConfig.postgres.databaseUrl ${described} (expected a string).`,
    );
  });

  it.each([undefined, "  "])("refuses a pgvector store whose databaseUrl is %j, naming the config key", (databaseUrl) => {
    const config = minimalConfig({
      rag: { embedder: "mock", store: "pgvector", storeConfig: { pgvector: { databaseUrl } } },
    });
    expect(() => defineConfig(config)).toThrow(
      'askdb.config: rag.store is "pgvector" but `rag.storeConfig.pgvector.databaseUrl` is missing; set it, for example `databaseUrl: env("PGVECTOR_URL")`.',
    );
  });

  // ADR 0005: every copy of @askdb/config in a process shares the store, and an older copy's
  // flat map can say something its structured config doesn't. This copy reads only `structured`.
  it("resolves a store another copy installed from its structured config, never from its flat map", () => {
    const structured = minimalConfig({ dev: { mockSql: "select 1" }, httpApi: { listen: { port: 8080 } } });
    (globalThis as Record<symbol, unknown>)[Symbol.for("askdb.runtimeStore")] = {
      structured,
      flat: {
        OPENAI_API_KEY: "flat-key",
        ASKDB_MOCK_SQL: "select 2",
        PORT: "9000",
        ASKDB_LOG_LEVEL: "debug",
        ASKDB_OMIT_SENSITIVE_FROM_PROMPT: "true",
      },
    };
    const rt = getAskDbRuntimeConfig();
    expect(rt.dev.mockSql).toBe("select 1");
    expect(rt.httpApi.listen.port).toBe(8080);
    expect(rt.logging.level).toBeUndefined();
    expect(rt.modes.omitSensitiveFromPrompt).toBe(false);
    expect(rt.ai.language.env.OPENAI_API_KEY).toBe("k");
    // The env maps are this copy's projection of `structured` too.
    expect(rt.ai.aiEnv.OPENAI_API_KEY).toBe("k");
    expect(rt.flat).toMatchObject({ ASKDB_MOCK_SQL: "select 1", PORT: "8080" });
    expect(rt.flat.ASKDB_LOG_LEVEL).toBeUndefined();
  });
});
