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
  loadAskDbConfigProjectionSync,
  requiredEnv,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
} from "./index.js";
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

  it("flattens postgres introspection databaseUrl to ASKDB_INTROSPECT_POSTGRES_URL", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        introspection: {
          provider: "postgres",
          providerConfig: { postgres: { databaseUrl: "postgres://introspect/db" } },
          outputDir: "./askdb/",
        },
      }),
    );
    expect(flat.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://introspect/db");
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

  it("defaults file-store base path when basePath omitted", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        rag: {
          embedder: "mock",
          store: "file",
          storeConfig: { file: {} },
        },
      }),
    );
    expect(flat.ASKDB_RAG_FILE_BASE_PATH).toBe("./askdb/rag");
  });

  it("flattens anthropic provider branch to correct env keys", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "anthropic",
          providerConfig: {
            anthropic: { apiKey: "ant-key" },
          },
          language: { model: "claude-opus-4-8" },
        },
      }),
    );
    expect(flat.ASKDB_AI_PROVIDER).toBe("anthropic");
    expect(flat.ANTHROPIC_API_KEY).toBe("ant-key");
    expect(flat.ASKDB_AI_MODEL).toBe("claude-opus-4-8");
  });

  it("flattens gateway provider branch to AI_GATEWAY_API_KEY and the universal model/base URL keys", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "gateway",
          providerConfig: {
            gateway: {
              apiKey: "gw-key",
              baseUrl: "https://gateway.example/v3/ai",
            },
          },
          language: { model: "anthropic/claude-sonnet-4-6" },
        },
      }),
    );
    expect(flat.ASKDB_AI_PROVIDER).toBe("gateway");
    expect(flat.AI_GATEWAY_API_KEY).toBe("gw-key");
    expect(flat.ASKDB_AI_MODEL).toBe("anthropic/claude-sonnet-4-6");
    expect(flat.ASKDB_AI_BASE_URL).toBe("https://gateway.example/v3/ai");
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

  it("flattens anthropic baseUrl when provided", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "anthropic",
          providerConfig: {
            anthropic: { apiKey: "ant-key", baseUrl: "https://custom.anthropic.endpoint/v1" },
          },
        },
      }),
    );
    expect(flat.ANTHROPIC_BASE_URL).toBe("https://custom.anthropic.endpoint/v1");
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

  it("throws a clear error when foundry provider has an empty providerConfig", () => {
    expect(() =>
      flattenAskDbConfig(
        minimalConfig({
          ai: {
            provider: "foundry",
            providerConfig: {},
          } as unknown as AskDbConfig["ai"],
        }),
      ),
    ).toThrow(/ai\.providerConfig\.foundry is required/);
  });

  it("known providers are unaffected by the custom-provider branch", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        ai: {
          provider: "openai",
          providerConfig: {
            openai: { apiKey: "oai-key" },
          },
          language: { model: "gpt-4o" },
        },
      }),
    );
    expect(flat.OPENAI_API_KEY).toBe("oai-key");
    expect(flat.OPENAI_MODEL).toBe("gpt-4o");
    // No ASKDB_AI_API_KEY set for openai branch
    expect(flat.ASKDB_AI_API_KEY).toBeUndefined();
  });

  describe("ai.language.reasoning", () => {
    it("emits no reasoning env keys when unset (preserves current behavior)", () => {
      const flat = flattenAskDbConfig(minimalConfig());
      expect(flat.ASKDB_AI_REASONING_EFFORT).toBeUndefined();
      expect(flat.ASKDB_AI_REASONING_EFFORT_NL_TO_SQL).toBeUndefined();
      expect(flat.ASKDB_AI_REASONING_EFFORT_ENRICHMENT).toBeUndefined();
    });

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

describe("optional rag block (#226)", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function runtimeFor(config: AskDbConfig) {
    setAskDbRuntimeForTests({ structured: config, flat: flattenAskDbConfig(config) });
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

describe("ai config sections: provider connections, ai.language, ai.embedding (#435)", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function runtimeFor(config: AskDbConfig) {
    setAskDbRuntimeForTests({ structured: config, flat: flattenAskDbConfig(config) });
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
      expect(rt.flat.ASKDB_AI_REASONING_EFFORT_NL_TO_SQL).toBe("medium");
      expect(rt.flat.ASKDB_RAG_EMBEDDER_DIMENSIONS).toBe("1536");
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
      expect(rt.flat.ASKDB_RAG_EMBEDDER_DIMENSIONS).toBeUndefined();
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
      const { deprecations, entries } = defineConfig(legacy);
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
      expect(entries.AZURE_OPENAI_DEPLOYMENT).toBe("askdb-reporting");
      expect(entries.ASKDB_AI_AZURE_MODEL_FAMILY).toBe("gpt-5");
      expect(entries.ASKDB_AI_REASONING_EFFORT).toBe("low");
    });

    it("prefers ai.language.model over a legacy provider model, and says the legacy one is ignored", () => {
      const { deprecations, entries } = defineConfig(config({ ...OPENAI_AI, language: { model: "gpt-5" } }));
      expect(entries.OPENAI_MODEL).toBe("gpt-5");
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

  it("the ai scaffold rejects an unknown provider, which it would emit as an object key", () => {
    expect(() =>
      renderAskDbAiConfigScaffold({ provider: "__proto__" as "openai", keyEnv: "MY_KEY" }),
    ).toThrow('Unknown AI provider: "__proto__"');
  });

  it("loads defineConfig projection from disk", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import { defineConfig, env, type AskDbConfig } from "@askdb/config";
       export default defineConfig({
         ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_KEY") } }, language: { model: "gpt-4o-mini" } },
         introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: env("MY_DB") } }, outputDir: "./out/" },
         rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
       } satisfies AskDbConfig);
    `,
      "utf8",
    );
    process.env.MY_KEY = "secret";
    process.env.MY_DB = "postgres://x/y";
    const { projection } = loadAskDbConfigProjectionSync(dir);
    expect(projection?.entries.OPENAI_API_KEY).toBe("secret");
    expect(projection?.entries.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://x/y");
    expect(projection?.entries.ASKDB_INTROSPECT_OUT).toBe("./out/");
    delete process.env.MY_KEY;
    delete process.env.MY_DB;
  });
});

describe("getAskDbRuntimeConfig — introspection branches", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function installRuntime(intro: AskDbConfig["introspection"], flat: Record<string, string>): void {
    const structured = minimalConfig({ introspection: intro });
    setAskDbRuntimeForTests({ structured, flat });
  }

  it("resolves postgresDatabaseUrl from the structured branch first", () => {
    installRuntime(
      {
        provider: "postgres",
        providerConfig: { postgres: { databaseUrl: "postgres://structured/host" } },
        outputDir: "./askdb/",
      },
      { ASKDB_INTROSPECT_POSTGRES_URL: "postgres://flat/host" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.provider).toBe("postgres");
    expect(rt.introspection.postgresDatabaseUrl).toBe("postgres://structured/host");
    expect(rt.introspection.mysqlDatabaseUrl).toBeUndefined();
    expect(rt.introspection.sqliteFile).toBeUndefined();
    expect(rt.introspection.sqlserverDatabaseUrl).toBeUndefined();
  });

  it("falls back to ASKDB_INTROSPECT_POSTGRES_URL when the structured field is blank", () => {
    installRuntime(
      { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
      { ASKDB_INTROSPECT_POSTGRES_URL: "postgres://flat/host" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.postgresDatabaseUrl).toBe("postgres://flat/host");
  });

  it("resolves outputDir from the flattened runtime snapshot", () => {
    installRuntime(
      { provider: "postgres", providerConfig: { postgres: {} } },
      { ASKDB_INTROSPECT_OUT: "./configured-schema/" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.outputDir).toBe("./configured-schema/");
  });

  it("defaults outputDir when config does not provide one", () => {
    installRuntime(
      { provider: "postgres", providerConfig: { postgres: {} } },
      {},
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.outputDir).toBe("./askdb/");
  });

  it("falls back to structured outputDir when tests install runtime without a flat projection", () => {
    installRuntime(
      { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./structured-schema/" },
      {},
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.outputDir).toBe("./structured-schema/");
  });

  it("resolves mysqlDatabaseUrl from the structured branch first", () => {
    installRuntime(
      {
        provider: "mysql",
        providerConfig: { mysql: { databaseUrl: "mysql://structured/host" } },
        outputDir: "./askdb/",
      },
      { ASKDB_INTROSPECT_MYSQL_URL: "mysql://flat/host" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.provider).toBe("mysql");
    expect(rt.introspection.postgresDatabaseUrl).toBeUndefined();
    expect(rt.introspection.mysqlDatabaseUrl).toBe("mysql://structured/host");
    expect(rt.introspection.sqliteFile).toBeUndefined();
    expect(rt.introspection.sqlserverDatabaseUrl).toBeUndefined();
  });

  it("falls back to ASKDB_INTROSPECT_MYSQL_URL when the structured field is blank", () => {
    installRuntime(
      { provider: "mysql", providerConfig: { mysql: {} }, outputDir: "./askdb/" },
      { ASKDB_INTROSPECT_MYSQL_URL: "mysql://flat/host" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.mysqlDatabaseUrl).toBe("mysql://flat/host");
  });

  it("returns undefined mysqlDatabaseUrl when neither structured nor env key is set", () => {
    installRuntime(
      { provider: "mysql", providerConfig: { mysql: {} }, outputDir: "./askdb/" },
      {},
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.mysqlDatabaseUrl).toBeUndefined();
  });

  it("resolves sqliteFile from the structured branch", () => {
    installRuntime(
      {
        provider: "sqlite",
        providerConfig: { sqlite: { file: "./data/app.db" } },
        outputDir: "./askdb/",
      },
      {},
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.sqliteFile).toBe("./data/app.db");
  });

  it("returns undefined sqliteFile when neither structured nor env key is set", () => {
    installRuntime(
      { provider: "sqlite", providerConfig: { sqlite: {} }, outputDir: "./askdb/" },
      {},
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.sqliteFile).toBeUndefined();
  });

  it("falls back to ASKDB_INTROSPECT_SQLITE_FILE when the structured field is blank", () => {
    installRuntime(
      { provider: "sqlite", providerConfig: { sqlite: {} }, outputDir: "./askdb/" },
      { ASKDB_INTROSPECT_SQLITE_FILE: "/var/db/app.db" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.sqliteFile).toBe("/var/db/app.db");
  });

  it("resolves sqlserverDatabaseUrl from the structured branch", () => {
    installRuntime(
      {
        provider: "sqlserver",
        providerConfig: { sqlserver: { databaseUrl: "Server=structured;Database=app;" } },
        outputDir: "./askdb/",
      },
      {},
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.sqlserverDatabaseUrl).toBe("Server=structured;Database=app;");
  });

  it("falls back to ASKDB_INTROSPECT_SQLSERVER_URL when the structured field is blank", () => {
    installRuntime(
      { provider: "sqlserver", providerConfig: { sqlserver: {} }, outputDir: "./askdb/" },
      { ASKDB_INTROSPECT_SQLSERVER_URL: "Server=flat;Database=app;" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.introspection.sqlserverDatabaseUrl).toBe("Server=flat;Database=app;");
  });

  it("leaves non-active engine fields undefined", () => {
    installRuntime(
      {
        provider: "postgres",
        providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } },
        outputDir: "./askdb/",
      },
      { ASKDB_INTROSPECT_MYSQL_URL: "mysql://nope/db" },
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
    flatExtra: Record<string, string> = {},
  ): void {
    const structured = minimalConfig({ introspection: intro, studio });
    const flat = { ...flattenAskDbConfig(structured), ...flatExtra };
    setAskDbRuntimeForTests({ structured, flat });
  }

  it("defaults to postgres when no provider is configured", () => {
    installStudio(undefined, { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" });
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("postgres");
  });

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

  it("reads ASKDB_STUDIO_EXECUTE_PROVIDER from env", () => {
    installStudio(
      undefined,
      { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
      { ASKDB_STUDIO_EXECUTE_PROVIDER: "mysql", ASKDB_STUDIO_DATABASE_URL: "mysql://env/db" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("mysql");
    expect(rt.studio.execute.databaseUrl).toBe("mysql://env/db");
  });

  it("reads ASKDB_STUDIO_SQLITE_FILE from env when provider is sqlite", () => {
    installStudio(
      undefined,
      { provider: "sqlite", providerConfig: { sqlite: {} }, outputDir: "./askdb/" },
      { ASKDB_STUDIO_SQLITE_FILE: "./env-file.db" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("sqlite");
    expect(rt.studio.execute.file).toBe("./env-file.db");
  });

  it("preserves backward-compatible postgres databaseUrl via ASKDB_STUDIO_DATABASE_URL", () => {
    installStudio(
      undefined,
      { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
      { ASKDB_STUDIO_DATABASE_URL: "postgres://legacy/db" },
    );
    const rt = getAskDbRuntimeConfig();
    expect(rt.studio.execute.provider).toBe("postgres");
    expect(rt.studio.execute.databaseUrl).toBe("postgres://legacy/db");
  });
});

describe("getAskDbRuntimeConfig — studio execute safety defaults", () => {
  afterEach(() => resetAskDbRuntimeForTests());

  function install(studio: AskDbConfig["studio"], flatExtra: Record<string, string> = {}): void {
    const structured = minimalConfig({
      introspection: {
        provider: "postgres",
        providerConfig: { postgres: { databaseUrl: "postgres://introspect/db" } },
        outputDir: "./askdb/",
      },
      studio,
    });
    setAskDbRuntimeForTests({ structured, flat: { ...flattenAskDbConfig(structured), ...flatExtra } });
  }

  it("is disabled by default with 30s timeout and 500-row cap", () => {
    install(undefined);
    const exec = getAskDbRuntimeConfig().studio.execute;
    expect(exec.enabled).toBe(false);
    expect(exec.useIntrospectionConnection).toBe(false);
    expect(exec.timeoutMs).toBe(30_000);
    expect(exec.maxRows).toBe(500);
  });

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

  it("reads the canonical flat keys", () => {
    install(undefined, {
      ASKDB_STUDIO_EXECUTE_ENABLED: "true",
      ASKDB_STUDIO_EXECUTE_TIMEOUT_MS: "1000",
      ASKDB_STUDIO_EXECUTE_MAX_ROWS: "10",
    });
    const exec = getAskDbRuntimeConfig().studio.execute;
    expect(exec.enabled).toBe(true);
    expect(exec.timeoutMs).toBe(1000);
    expect(exec.maxRows).toBe(10);
  });

  it("rejects non-positive-integer timeoutMs / maxRows", () => {
    expect(() =>
      flattenAskDbConfig(minimalConfig({ studio: { execute: { timeoutMs: 0 } } })),
    ).toThrow(/studio\.execute\.timeoutMs/);
    expect(() =>
      flattenAskDbConfig(minimalConfig({ studio: { execute: { maxRows: 1.5 } } })),
    ).toThrow(/studio\.execute\.maxRows/);
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

    bootstrapAskDbEnv({ cwd: dir });
    const rt = getAskDbRuntimeConfig();
    expect(rt.ai.aiEnv.OPENAI_API_KEY).toBe("dog");
    expect(rt.ai.aiEnv.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://localhost/db");
    delete process.env.MY_AI;
    delete process.env.MY_DB;
  });
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
      expect(getAskDbRuntimeConfig().flat.ASKDB_AI_REASONING_EFFORT).toBe("low");
    } finally {
      emitWarning.mockRestore();
    }
  });
});
