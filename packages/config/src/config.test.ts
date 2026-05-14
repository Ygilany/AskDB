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
  mergeAskDbConfigIntoEnvSync,
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
    database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } } },
    introspection: {
      provider: "postgres",
      providerConfig: { postgres: {} },
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
  it("env throws when missing", () => {
    delete process.env.ASKDB_CONFIG_TEST_MISSING;
    expect(() => env("ASKDB_CONFIG_TEST_MISSING")).toThrow(/ASKDB_CONFIG_TEST_MISSING/);
  });
});

describe("flattenAskDbConfig", () => {
  it("maps openai + mock rag + memory store", () => {
    const flat = flattenAskDbConfig(minimalConfig());
    expect(flat.OPENAI_API_KEY).toBe("k");
    expect(flat.DATABASE_URL).toBe("postgres://localhost/db");
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

  it("overrides DATABASE_URL when introspection postgres sets databaseUrl", () => {
    const flat = flattenAskDbConfig(
      minimalConfig({
        introspection: {
          provider: "postgres",
          providerConfig: { postgres: { databaseUrl: "postgres://introspect/db" } },
          outputDir: "./askdb/",
        },
      }),
    );
    expect(flat.DATABASE_URL).toBe("postgres://introspect/db");
  });
});

describe("mergeAskDbConfigIntoEnvSync (projection)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("merges defineConfig projection from disk", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import { defineConfig, env, type AskDbConfig } from "@askdb/config";
       export default defineConfig({
         ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_KEY"), model: "gpt-4o-mini" } } },
         database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: env("MY_DB") } } },
         introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./out/" },
         rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
       } satisfies AskDbConfig);
    `,
      "utf8",
    );
    process.env.MY_KEY = "secret";
    process.env.MY_DB = "postgres://x/y";
    mergeAskDbConfigIntoEnvSync(dir);
    expect(process.env.OPENAI_API_KEY).toBe("secret");
    expect(process.env.DATABASE_URL).toBe("postgres://x/y");
    expect(process.env.ASKDB_INTROSPECT_OUT).toBe("./out/");
    delete process.env.MY_KEY;
    delete process.env.MY_DB;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.ASKDB_INTROSPECT_OUT;
  });
});

describe("bootstrapAskDbEnv", () => {
  let dir: string;
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevMyAi = process.env.MY_AI;
  const prevDb = process.env.MY_DB;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevMyAi === undefined) delete process.env.MY_AI;
    else process.env.MY_AI = prevMyAi;
    if (prevDb === undefined) delete process.env.MY_DB;
    else process.env.MY_DB = prevDb;
  });

  it("loads .env then merges nested askdb.config", () => {
    dir = mkdtempSync(join(tmpdir(), "askdb-config-"));
    linkWorkspacePackage(dir);
    writeFileSync(join(dir, ".env"), "MY_AI=dog\nMY_DB=postgres://localhost/db\n", "utf8");
    writeFileSync(
      join(dir, "askdb.config.ts"),
      `import { defineConfig, env, type AskDbConfig } from "@askdb/config";
       export default defineConfig({
         ai: { provider: "openai", providerConfig: { openai: { apiKey: env("MY_AI"), model: "gpt-4o-mini" } } },
         database: { provider: "postgres", providerConfig: { postgres: { databaseUrl: env("MY_DB") } } },
         introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
         rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
       } satisfies AskDbConfig);
    `,
      "utf8",
    );

    bootstrapAskDbEnv({ cwd: dir });
    expect(process.env.OPENAI_API_KEY).toBe("dog");
    expect(process.env.DATABASE_URL).toBe("postgres://localhost/db");
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.ASKDB_INTROSPECT_OUT;
    delete process.env.MY_AI;
    delete process.env.MY_DB;
  });
});
