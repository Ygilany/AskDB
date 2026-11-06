import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASKDB_AI_PROVIDERS, loadAskDbConfigProjectionSync, resetAskDbRuntimeForTests, type AskDbConfig } from "../index.js";
import { linkWorkspacePackage } from "../test-utils.js";
import { AskDbScaffoldInputError, isAskDbScaffoldEnvName, planAskDbScaffold, type AskDbScaffoldAnswers } from "./index.js";

const VERSIONS = { config: "1.2.3", prisma: "0.9.0" };

/** Postgres + OpenAI + file store, no Studio execute; each test overrides what it's about. */
function answers(overrides: Partial<AskDbScaffoldAnswers> = {}): AskDbScaffoldAnswers {
  return {
    database: "postgres",
    connectionEnv: "PLAN_DB_URL",
    schemaOut: "./out",
    ai: { provider: "openai", keyEnv: "PLAN_KEY", modelEnv: "PLAN_MODEL" },
    rag: { store: "file" },
    ...overrides,
  };
}

type Case = {
  name: string;
  answers: AskDbScaffoldAnswers;
  /** The config's blocks other than `ai` once loaded, with each env var NAME set to `value-of-NAME`. */
  expected: Omit<AskDbConfig, "ai">;
};

const outputDir = "./out";
const ENGINES: [string, Partial<AskDbScaffoldAnswers>, AskDbConfig["introspection"]][] = [
  ["postgres", { database: "postgres", connectionEnv: "PLAN_DB_URL" }, { provider: "postgres", providerConfig: { postgres: { databaseUrl: "value-of-PLAN_DB_URL" } }, outputDir }],
  ["mysql", { database: "mysql", connectionEnv: "PLAN_DB_URL" }, { provider: "mysql", providerConfig: { mysql: { databaseUrl: "value-of-PLAN_DB_URL" } }, outputDir }],
  ["sqlserver", { database: "sqlserver", connectionEnv: "PLAN_DB_URL" }, { provider: "sqlserver", providerConfig: { sqlserver: { databaseUrl: "value-of-PLAN_DB_URL" } }, outputDir }],
  ["sqlite with a path", { database: "sqlite", sqliteFile: { path: "./shop.db" } }, { provider: "sqlite", providerConfig: { sqlite: { file: "./shop.db" } }, outputDir }],
  ["sqlite with an env var", { database: "sqlite", sqliteFile: { env: "PLAN_SQLITE_FILE" } }, { provider: "sqlite", providerConfig: { sqlite: { file: "value-of-PLAN_SQLITE_FILE" } }, outputDir }],
  ["prisma", { database: "prisma", prismaSchemaPath: "./prisma/schema.prisma" }, { provider: "prisma", providerConfig: { prisma: { schemaPath: "./prisma/schema.prisma" } }, outputDir }],
  ["prisma, schema auto-discovered", { database: "prisma" }, { provider: "prisma", providerConfig: { prisma: {} }, outputDir }],
];
const EXECUTES: [string, AskDbScaffoldAnswers["studioExecute"], AskDbConfig["studio"]][] = [
  ["no Studio execute", undefined, undefined],
  ["sqlite execute", { provider: "sqlite", sqliteFile: { path: "./exec.db" } }, { execute: { enabled: true, provider: "sqlite", file: "./exec.db" } }],
  ["mysql execute", { provider: "mysql", connectionEnv: "PLAN_EXEC_URL" }, { execute: { enabled: true, provider: "mysql", databaseUrl: "value-of-PLAN_EXEC_URL" } }],
];
const RAGS: [AskDbScaffoldAnswers["rag"], AskDbConfig["rag"]][] = [
  [{ store: "file" }, { embedder: "mock", store: "file", storeConfig: { file: {} } }],
  [{ store: "memory" }, { embedder: "mock", store: "memory", storeConfig: { memory: {} } }],
  [{ store: "pgvector", pgvectorEnv: "PLAN_PGVECTOR_URL" }, { embedder: "mock", store: "pgvector", storeConfig: { pgvector: { databaseUrl: "value-of-PLAN_PGVECTOR_URL" } } }],
];
/** Every engine × Studio execute × RAG store, with the AI provider taking turns. */
const CASES: Case[] = ENGINES.flatMap(([engine, engineAnswers, introspection]) =>
  EXECUTES.flatMap(([execute, studioExecute, studio]) =>
    RAGS.map(([rag, ragConfig]) => ({ engine, engineAnswers, introspection, execute, studioExecute, studio, rag, ragConfig })),
  ),
).map((c, i) => {
  const provider = ASKDB_AI_PROVIDERS[i % ASKDB_AI_PROVIDERS.length]!;
  return {
    name: `${c.engine}, ${c.execute}, ${c.rag.store} store, ${provider}`,
    answers: answers({
      ...c.engineAnswers,
      ai: { provider, keyEnv: "PLAN_KEY", modelEnv: "PLAN_MODEL" },
      rag: c.rag,
      ...(c.studioExecute ? { studioExecute: c.studioExecute } : {}),
    }),
    expected: { introspection: c.introspection, rag: c.ragConfig, ...(c.studio ? { studio: c.studio } : {}) },
  };
});

describe("planAskDbScaffold", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetAskDbRuntimeForTests();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Write `source` as a project's askdb.config.ts and load it with `env` set, as a user's project would. */
  function loadConfig(source: string, env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "askdb-scaffold-"));
    dirs.push(dir);
    linkWorkspacePackage(dir);
    writeFileSync(join(dir, "askdb.config.ts"), source, "utf8");
    const saved = Object.keys(env).map((name) => [name, process.env[name]] as const);
    Object.assign(process.env, env);
    try {
      return loadAskDbConfigProjectionSync(dir).projection!;
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it.each(CASES)("writes a config that loads and reads every env var it lists: $name", ({ answers, expected }) => {
    const plan = planAskDbScaffold(answers, VERSIONS);

    const projection = loadConfig(
      plan.configSource,
      Object.fromEntries(plan.envVars.map((v) => [v.name, `value-of-${v.name}`])),
    );

    expect(projection.deprecations).toEqual([]);
    const { ai, ...rest } = projection.config;
    expect(ai.provider).toBe(answers.ai.provider);
    expect(Object.keys(ai.providerConfig ?? {})).toEqual([answers.ai.provider]);
    expect(rest).toEqual(expected);
    const values = Object.values(projection.entries);
    for (const { name } of plan.envVars) expect(values).toContain(`value-of-${name}`);
  });

  // @askdb/core needs `ai` (a peer) and `zod`. Under Yarn Plug'n'Play a Prisma project must
  // provide both itself, or `askdb introspect --engine prisma` can't load @askdb/prisma (#760).
  // The project gets the newest `ai` major core accepts.
  const core = JSON.parse(readFileSync(join(import.meta.dirname, "../../../core/package.json"), "utf8")) as {
    peerDependencies: { ai: string };
    dependencies: { zod: string };
  };
  const coreAi = `ai@${core.peerDependencies.ai.split("||").at(-1)!.trim()}`;
  const coreZod = `zod@${core.dependencies.zod}`;

  it.each([
    ["postgres", answers(), ["@askdb/config@1.2.3", "pg"], []],
    ["mysql", answers({ database: "mysql" }), ["@askdb/config@1.2.3", "mysql2"], []],
    ["sqlserver", answers({ database: "sqlserver" }), ["@askdb/config@1.2.3", "mssql"], []],
    ["sqlite", answers({ database: "sqlite", sqliteFile: { path: "./shop.db" } }), ["@askdb/config@1.2.3", "better-sqlite3"], []],
    ["prisma", answers({ database: "prisma" }), ["@askdb/config@1.2.3", "@askdb/prisma@0.9.0", coreAi, coreZod], ["@prisma/engines"]],
    [
      "prisma with SQL Server execute",
      answers({ database: "prisma", studioExecute: { provider: "sqlserver", connectionEnv: "PLAN_DB_URL" } }),
      ["@askdb/config@1.2.3", "@askdb/prisma@0.9.0", coreAi, coreZod, "mssql"],
      ["@prisma/engines"],
    ],
    [
      "postgres with postgres execute",
      answers({ studioExecute: { provider: "postgres", connectionEnv: "PLAN_DB_URL" } }),
      ["@askdb/config@1.2.3", "pg"],
      [],
    ],
    [
      "sqlite with MySQL execute",
      answers({ database: "sqlite", sqliteFile: { path: "./shop.db" }, studioExecute: { provider: "mysql", connectionEnv: "PLAN_DB_URL" } }),
      ["@askdb/config@1.2.3", "better-sqlite3", "mysql2"],
      [],
    ],
  ] satisfies [string, AskDbScaffoldAnswers, string[], string[]][])(
    "installs @askdb/config and what %s needs",
    (_name, input, packages, allowBuilds) => {
      expect(planAskDbScaffold(input, VERSIONS).install).toEqual({ packages, allowBuilds });
    },
  );

  // `docker run --env-file` reads `NAME=VALUE` per line, everything after `=` as the value, and
  // skips `#` lines. An inline `NAME= # purpose` would set NAME to "# purpose".
  // The `mssql` driver reads only `TrustServerCertificate` without spaces, so a host that reuses
  // this DATABASE_URL for its own pool gets the same certificate setting AskDB does (#803).
  it("hints the SQL Server URL in the ADO.NET form both AskDB and mssql read", () => {
    const plan = planAskDbScaffold(answers({ database: "sqlserver", connectionEnv: "DATABASE_URL" }), VERSIONS);
    expect(plan.envExample.split("\n").find((line) => line.startsWith("# sqlserver"))).toBe(
      "# sqlserver connection URL, for introspection. Format: Data Source=<DATABASE_HOST>,<DATABASE_PORT>;" +
        "Initial Catalog=<DATABASE_NAME>;User ID=<USERNAME>;Password=<PASSWORD>;TrustServerCertificate=True;" +
        "Authentication=SqlPassword;",
    );
  });

  it("writes a .env.example that `--env-file` reads as the listed variables, each one empty", () => {
    for (const { name, answers } of CASES) {
      const plan = planAskDbScaffold(answers, VERSIONS);
      const lines = plan.envExample.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
      const parsed = lines.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]);
      expect(parsed, name).toEqual(plan.envVars.map((v) => [v.name, ""]));
    }
  });

  it("lists each env var once, database variables first, with what it is for and the URL format", () => {
    const plan = planAskDbScaffold(
      answers({
        database: "postgres",
        connectionEnv: "DATABASE_URL",
        ai: { provider: "azure", keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT" },
        rag: { store: "pgvector", pgvectorEnv: "ASKDB_PGVECTOR_URL" },
        studioExecute: { provider: "postgres", connectionEnv: "DATABASE_URL" },
      }),
      VERSIONS,
    );

    expect(plan.envVars).toEqual([
      { name: "DATABASE_URL", purpose: "postgres connection URL, for introspection and Studio execute", requiredForIntrospection: true },
      { name: "ASKDB_PGVECTOR_URL", purpose: "pgvector connection URL", requiredForIntrospection: false },
      { name: "AZURE_OPENAI_API_KEY", purpose: "azure API key", requiredForIntrospection: false },
      { name: "AZURE_OPENAI_DEPLOYMENT", purpose: "azure model override", requiredForIntrospection: false },
      {
        name: "AZURE_RESOURCE_NAME",
        purpose: 'Azure resource name, e.g. "my-resource" for https://my-resource.openai.azure.com',
        requiredForIntrospection: false,
      },
    ]);
    expect(plan.envExample).toBe(`# AskDB environment — copy to .env and fill in real values.
# .env is read by the CLI, Studio, and the HTTP API; never commit it.

# postgres connection URL, for introspection and Studio execute. Format: postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>
DATABASE_URL=
# pgvector connection URL. Format: postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>
ASKDB_PGVECTOR_URL=
# azure API key
AZURE_OPENAI_API_KEY=
# azure model override
AZURE_OPENAI_DEPLOYMENT=
# Azure resource name, e.g. "my-resource" for https://my-resource.openai.azure.com
AZURE_RESOURCE_NAME=
`);
  });

  it("lists a SQLite file variable once when introspection and Studio execute share it", () => {
    const plan = planAskDbScaffold(
      answers({
        database: "sqlite",
        sqliteFile: { env: "SQLITE_FILE" },
        studioExecute: { provider: "sqlite", sqliteFile: { env: "SQLITE_FILE" } },
      }),
      VERSIONS,
    );

    expect(plan.envVars[0]).toEqual({
      name: "SQLITE_FILE",
      purpose: "SQLite database file path, for introspection and Studio execute",
      requiredForIntrospection: true,
    });
    expect(plan.envVars.filter((v) => v.name === "SQLITE_FILE")).toHaveLength(1);
  });

  /** The error planning `input` throws. */
  function inputError(input: AskDbScaffoldAnswers): AskDbScaffoldInputError {
    try {
      planAskDbScaffold(input, VERSIONS);
    } catch (error) {
      expect(error).toBeInstanceOf(AskDbScaffoldInputError);
      return error as AskDbScaffoldInputError;
    }
    throw new Error("planAskDbScaffold accepted the input");
  }

  // Env var names follow POSIX, uppercase: a value pasted into a name field, or a quote that
  // would end the `env("…")` string, fails here instead of landing in the config.
  it.each([
    ["connectionEnv", answers({ connectionEnv: "my-url" })],
    ["connectionEnv", answers({ connectionEnv: "1DATABASE_URL" })],
    ["connectionEnv", answers({ connectionEnv: 'DATABASE_URL"), x: ("' })],
    ["sqliteFile", answers({ database: "sqlite", sqliteFile: { env: "sqlite_file" } })],
    ["ai.keyEnv", answers({ ai: { provider: "openai", keyEnv: "sk-this-looks-like-a-secret" } })],
    ["ai.modelEnv", answers({ ai: { provider: "openai", keyEnv: "OPENAI_API_KEY", modelEnv: "MY MODEL" } })],
    ["rag.pgvectorEnv", answers({ rag: { store: "pgvector", pgvectorEnv: "PGVECTOR-URL" } })],
    ["studioExecute.connectionEnv", answers({ studioExecute: { provider: "postgres", connectionEnv: "exec.url" } })],
    ["studioExecute.sqliteFile", answers({ studioExecute: { provider: "sqlite", sqliteFile: { env: "Exec_File" } } })],
  ] satisfies [string, AskDbScaffoldAnswers][])("rejects an env var name that isn't uppercase POSIX in %s", (field, input) => {
    expect(inputError(input).field).toBe(field);
  });

  it.each([
    ["DATABASE_URL", true],
    ["_PRIVATE_URL", true],
    ["A1", true],
    ["my-url", false],
    ["database_url", false],
    ["1DATABASE_URL", false],
    ["DATABASE URL", false],
    ["", false],
  ])("isAskDbScaffoldEnvName(%j) is %s", (name, expected) => {
    expect(isAskDbScaffoldEnvName(name)).toBe(expected);
  });

  it("accepts env var names with a leading underscore", () => {
    const plan = planAskDbScaffold(
      answers({ connectionEnv: "_DATABASE_URL", ai: { provider: "openai", keyEnv: "__KEY" } }),
      VERSIONS,
    );
    expect(plan.envVars.map((v) => v.name)).toEqual(["_DATABASE_URL", "__KEY"]);
  });

  it.each([
    ["schemaOut", (bad: string) => answers({ schemaOut: `./out${bad}` })],
    ["sqliteFile", (bad: string) => answers({ database: "sqlite", sqliteFile: { path: `./a${bad}.db` } })],
    ["prismaSchemaPath", (bad: string) => answers({ database: "prisma", prismaSchemaPath: `./schema${bad}.prisma` })],
    ["studioExecute.sqliteFile", (bad: string) => answers({ studioExecute: { provider: "sqlite", sqliteFile: { path: `./a${bad}.db` } } })],
  ] as const)("rejects control characters (newline, CR, NUL, tab, DEL, U+2028, U+2029) in %s", (field, withValue) => {
    for (const bad of ["\n", "\r", "\0", "\t", "\u007f", "\u2028", "\u2029"]) {
      expect(inputError(withValue(bad)).field, JSON.stringify(bad)).toBe(field);
    }
  });

  it.each([
    ["connectionEnv", answers({ connectionEnv: undefined })],
    ["connectionEnv", answers({ database: "sqlserver", connectionEnv: "" })],
    ["sqliteFile", answers({ database: "sqlite" })],
    ["sqliteFile", answers({ database: "sqlite", sqliteFile: { path: "" } })],
    ["sqliteFile", answers({ database: "sqlite", sqliteFile: {} as never })],
    ["prismaSchemaPath", answers({ database: "prisma", prismaSchemaPath: "" })],
    ["schemaOut", answers({ schemaOut: "" })],
    ["ai.keyEnv", answers({ ai: { provider: "openai", keyEnv: "" } })],
    ["rag.pgvectorEnv", answers({ rag: { store: "pgvector" } })],
    // Prisma reads no live database, so Studio execute must say which one to use.
    ["studioExecute.provider", answers({ database: "prisma", studioExecute: { connectionEnv: "DATABASE_URL" } as never })],
    ["studioExecute.connectionEnv", answers({ studioExecute: { provider: "postgres" } })],
    ["studioExecute.sqliteFile", answers({ studioExecute: { provider: "sqlite" } })],
  ] satisfies [string, AskDbScaffoldAnswers][])("rejects a missing answer: %s", (field, input) => {
    expect(inputError(input).field).toBe(field);
  });

  // Ids are written as object keys and literals: an unknown one must not reach the config.
  it.each([
    ["database", answers({ database: "oracle" as never })],
    ["database", answers({ database: "__proto__" as never })],
    ["ai.provider", answers({ ai: { provider: "constructor" as never, keyEnv: "KEY" } })],
    ["rag.store", answers({ rag: { store: "bogus" as never } })],
    ["studioExecute.provider", answers({ studioExecute: { provider: "prisma" as never, connectionEnv: "DATABASE_URL" } })],
    ["studioExecute.provider", answers({ studioExecute: { provider: 'x", injected: 1, y: "' as never, connectionEnv: "DATABASE_URL" } })],
  ] satisfies [string, AskDbScaffoldAnswers][])("rejects an unknown id in %s", (field, input) => {
    expect(inputError(input).field).toBe(field);
  });

  // A value that would end a `"…"` string literal and run code when the config loads.
  const HOSTILE = 'x", injected: (() => { throw new Error("pwned"); })(), y: "\\';

  it.each([
    [
      "sqlite",
      answers({
        database: "sqlite",
        sqliteFile: { path: `./data/${HOSTILE}.db` },
        schemaOut: `./out/${HOSTILE}`,
        studioExecute: { provider: "sqlite", sqliteFile: { path: `./exec/${HOSTILE}.db` } },
      }),
      {
        introspection: { provider: "sqlite", providerConfig: { sqlite: { file: `./data/${HOSTILE}.db` } }, outputDir: `./out/${HOSTILE}` },
        studio: { execute: { enabled: true, provider: "sqlite", file: `./exec/${HOSTILE}.db` } },
      },
    ],
    [
      "prisma",
      answers({ database: "prisma", prismaSchemaPath: `./prisma/${HOSTILE}.prisma`, schemaOut: `./askdb\\win\\"path"` }),
      {
        introspection: {
          provider: "prisma",
          providerConfig: { prisma: { schemaPath: `./prisma/${HOSTILE}.prisma` } },
          outputDir: `./askdb\\win\\"path"`,
        },
      },
    ],
  ] satisfies [string, AskDbScaffoldAnswers, Omit<AskDbConfig, "ai" | "rag">][])(
    "writes quotes and backslashes in %s paths as literal strings (no code injection)",
    (_name, input, expected) => {
      const plan = planAskDbScaffold(input, VERSIONS);

      const { ai: _ai, rag: _rag, ...rest } = loadConfig(plan.configSource, {}).config;

      expect(rest).toEqual(expected);
    },
  );
});
