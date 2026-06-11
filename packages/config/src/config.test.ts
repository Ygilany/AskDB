import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
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
import type { AskDbConfig } from "./types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function linkWorkspacePackage(projectDir: string): void {
  const nmAskdb = join(projectDir, "node_modules", "@askdb");
  mkdirSync(nmAskdb, { recursive: true });
  symlinkSync(pkgRoot, join(nmAskdb, "config"), "dir");
}

function minimalConfig(overrides: Partial<AskDbConfig> = {}): AskDbConfig {
  const base: AskDbConfig = {
    ai: {
      provider: "openai",
      providerConfig: {
        openai: { apiKey: "k", model: "gpt-4o-mini" },
      },
    },
    introspection: {
      provider: "postgres",
      providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } },
      outputDir: "./askdb/",
    },
    rag: {
      embedder: "mock",
      embedderConfig: {},
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

  it("defaults OpenAI chat model when model omitted", () => {
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
          embedderConfig: {},
          store: "file",
          storeConfig: { file: {} },
        },
      }),
    );
    expect(flat.ASKDB_RAG_FILE_BASE_PATH).toBe("./askdb/rag");
  });
});

describe("loadAskDbConfigProjectionSync", () => {
  let dir: string;
  afterEach(() => {
    resetAskDbRuntimeForTests();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("loads defineConfig projection from disk", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import { defineConfig, env, type AskDbConfig } from "@askdb/config";
       export default defineConfig({
         ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_KEY"), model: "gpt-4o-mini" } } },
         introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: env("MY_DB") } }, outputDir: "./out/" },
         rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
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
         ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_AI"), model: "gpt-4o-mini" } } },
         introspection: { provider: "postgres", providerConfig: { postgres: { databaseUrl: env("MY_DB") } }, outputDir: "./askdb/" },
         rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
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
});
