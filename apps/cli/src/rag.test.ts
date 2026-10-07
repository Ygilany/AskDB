import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flattenAskDbConfig,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
  type AskDbConfig,
} from "@askdb/config";
import { formatSupportedAskDbLogLevels } from "@askdb/core";
import type { CreatePgvectorStoreOptions } from "@askdb/rag";
import { runRagCli } from "./rag.js";

/**
 * What the CLI did to the pgvector store: the options it built it with, then each call. When
 * `tableDimensions` is set, `ensureSchema` refuses another width the way the real store does.
 */
const pgvector = vi.hoisted(() => ({
  options: [] as CreatePgvectorStoreOptions[],
  calls: [] as string[],
  tableDimensions: undefined as number | undefined,
}));
vi.mock("@askdb/rag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/rag")>();
  return {
    ...actual,
    createPgvectorStore: (options: CreatePgvectorStoreOptions) => {
      pgvector.options.push(options);
      const call = (name: string) => async () => {
        pgvector.calls.push(name);
      };
      return {
        ensureSchema: async () => {
          pgvector.calls.push("ensureSchema");
          const table = pgvector.tableDimensions;
          if (table !== undefined && options.dimensions !== undefined && options.dimensions !== table) {
            throw new actual.PgvectorDimensionMismatchError("askdb_rag_chunks", table, options.dimensions);
          }
        },
        upsert: call("upsert"),
        delete: call("delete"),
        close: call("close"),
        query: async () => [],
        count: async () => 0,
        hashesByPrefix: async () => ({}),
        idsBySchema: async () => [],
        describe: () => ({ kind: "pgvector", location: "askdb_rag_chunks" }),
      };
    },
  };
});

const FIXTURE_DIR = resolve(__dirname, "../../../fixtures/schemas/orders-users.schema");
const PG_URL = "postgres://localhost/db";

const BASE_CONFIG: AskDbConfig = {
  ai: {
    provider: "openai",
    providerConfig: { openai: { apiKey: "test-key" } },
    language: { model: "gpt-4o-mini" },
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: { databaseUrl: PG_URL } },
    outputDir: "./askdb/",
  },
  rag: { embedder: "mock", store: "file", storeConfig: { file: {} } },
};

/** `rag.embedder: "ai"` with an OpenAI `ai.embedding` pointed at a local embeddings server. */
function aiEmbeddingConfig(
  baseUrl: string,
  embedding: NonNullable<AskDbConfig["ai"]["embedding"]> = { model: "text-embedding-3-small", dimensions: 4 },
): AskDbConfig {
  return {
    ...BASE_CONFIG,
    ai: { ...BASE_CONFIG.ai, providerConfig: { openai: { apiKey: "test-key", baseUrl } }, embedding },
    rag: { embedder: "ai", store: "file", storeConfig: { file: {} } },
  };
}

function installRuntime(structured: AskDbConfig = BASE_CONFIG): void {
  setAskDbRuntimeForTests({ structured, flat: flattenAskDbConfig(structured) });
}

const tempDirs: string[] = [];
const servers: Server[] = [];
let stdout: string[];
let stderr: string[];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-rag-cli-"));
  tempDirs.push(dir);
  return dir;
}

function copyFixture(): string {
  const schemaDir = join(tempDir(), "orders-users.schema");
  cpSync(FIXTURE_DIR, schemaDir, { recursive: true });
  return schemaDir;
}

function readLock(schemaDir: string): { embedderId?: string; dimensions?: number } {
  return JSON.parse(readFileSync(join(schemaDir, "schema.lock.json"), "utf8")) as {
    embedderId?: string;
    dimensions?: number;
  };
}

/**
 * An OpenAI-compatible `/embeddings` endpoint: 4-wide vectors unless the request asks for a width.
 * Records each request's model and input count.
 */
async function startEmbeddingServer(): Promise<{ baseUrl: string; requests: { model: string; inputs: number }[] }> {
  const requests: { model: string; inputs: number }[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model: string;
      input?: string[];
      dimensions?: number;
    };
    const input = body.input ?? [];
    requests.push({ model: body.model, inputs: input.length });
    const dim = body.dimensions ?? 4;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: input.map((text, index) => ({ index, embedding: lexicalVector(text, dim) })),
        usage: { prompt_tokens: input.length, total_tokens: input.length },
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

function lexicalVector(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    vector[token.length % dim] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

beforeEach(() => {
  installRuntime();
  pgvector.options.length = 0;
  pgvector.calls.length = 0;
  pgvector.tableDimensions = undefined;
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetAskDbRuntimeForTests();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

describe("askdb rag", () => {
  it("mock embedder honors --dimensions", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir, "--dimensions", "16"])).toBe(0);
    const meta = JSON.parse(readFileSync(join(schemaDir, "schema.embeddings.json"), "utf8")) as {
      dimensions: number;
    };
    expect(meta.dimensions).toBe(16);
    expect(readLock(schemaDir)).toMatchObject({ embedderId: "mock:lexical-16", dimensions: 16 });
  });

  it.each<[string, string[], number]>([
    ["8 chunks by default", [], 8],
    ["the top -k chunks", ["-k", "1"], 1],
    ["only the --types asked for", ["--types", "column", "-k", "3"], 3],
  ])("query prints %s", async (_case, flags, count) => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    stdout = [];
    expect(await runRagCli(["query", schemaDir, "--question", "paid orders", ...flags])).toBe(0);
    const out = JSON.parse(stdout.join("")) as { question: string; k: number; results: { type: string }[] };
    expect(out).toMatchObject({ question: "paid orders", k: count });
    expect(out.results).toHaveLength(count);
    if (flags.includes("--types")) expect(new Set(out.results.map((result) => result.type))).toEqual(new Set(["column"]));
  });

  it("query searches only its own schema in a store two schemas share", async () => {
    const vectors = join(tempDir(), "shared");
    const ordersDir = copyFixture();
    const otherDir = copyFixture();
    const schemaJson = join(otherDir, "schema.json");
    writeFileSync(schemaJson, readFileSync(schemaJson, "utf8").replace('"schemaId": "orders-users"', '"schemaId": "other-copy"'));
    expect(await runRagCli(["index", ordersDir, "--file-path", vectors])).toBe(0);
    expect(await runRagCli(["index", otherDir, "--file-path", vectors])).toBe(0);

    stdout = [];
    expect(await runRagCli(["query", ordersDir, "--file-path", vectors, "--question", "paid orders", "-k", "20"])).toBe(0);
    const { results } = JSON.parse(stdout.join("")) as { results: { schemaId: string }[] };
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results.map((result) => result.schemaId))).toEqual(new Set(["orders-users"]));
  });

  it("query requires --question", async () => {
    expect(await runRagCli(["query", copyFixture()])).toBe(1);
    expect(stderr.join("")).toBe("Missing --question for query command.\n");
  });

  it("query refuses an embedder that differs from the one the index was built with", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    expect(await runRagCli(["query", schemaDir, "--question", "paid orders"])).toBe(0);

    stderr = [];
    expect(
      await runRagCli(["query", schemaDir, "--question", "paid orders", "--dimensions", "32"]),
    ).toBe(1);
    expect(stderr.join("")).toBe(
      'The index was built with embedder "mock:lexical-64" but this query uses "mock:lexical-32". ' +
        "Pass the same --embedder/--embedder-model/--dimensions used for `index`, or re-run `index`.\n",
    );
  });

  it("query refuses an index whose lock records no embedder id", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    const lockPath = join(schemaDir, "schema.lock.json");
    const { embedderId: _, ...lock } = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
    writeFileSync(lockPath, JSON.stringify(lock));

    expect(await runRagCli(["query", schemaDir, "--question", "paid orders"])).toBe(1);
    expect(stderr.join("")).toMatch(/built without an embedder id, so its embedder is unknown, but this query uses "mock:lexical-64"/);
  });

  it.each([
    ["--embedder", "opanai", "Unknown embedder: opanai (expected 'mock' or 'ai')."],
    ["--store", "pgvctor", "Unknown store: pgvctor (expected 'memory', 'file', or 'pgvector')."],
  ])("index rejects an unknown %s before opening a store", async (flag, value, message) => {
    // A configured pgvector URL, so an unvalidated store name would reach createPgvectorStore.
    installRuntime({
      ...BASE_CONFIG,
      rag: { embedder: "mock", store: "file", storeConfig: { file: {}, pgvector: { databaseUrl: PG_URL } } },
    });
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir, flag, value])).toBe(1);
    expect(stderr.join("")).toBe(`${message}\n`);
    expect(pgvector.options).toEqual([]);
    expect(existsSync(join(schemaDir, "schema.lock.json"))).toBe(false);
  });

  it.each<[string, string[], AskDbConfig]>([
    ["--store memory", ["--store", "memory"], BASE_CONFIG],
    ["rag.store: \"memory\"", [], { ...BASE_CONFIG, rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } } }],
  ])("query with %s explains the store is per-process", async (_case, flags, config) => {
    installRuntime(config);
    const schemaDir = copyFixture();
    expect(await runRagCli(["query", schemaDir, "--question", "x", ...flags])).toBe(1);
    expect(stderr.join("")).toMatch(/memory store lives only inside one process/);
  });

  it("index --force re-embeds everything", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    stdout = [];
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ chunksIndexed: 0 });
    stdout = [];
    expect(await runRagCli(["index", schemaDir, "--force"])).toBe(0);
    const forced = JSON.parse(stdout.join("")) as { chunksIndexed: number; chunksTotal: number };
    expect(forced.chunksIndexed).toBe(forced.chunksTotal);
  });

  it("index --store memory leaves the committed lock alone", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    const lockPath = join(schemaDir, "schema.lock.json");
    const before = readFileSync(lockPath, "utf8");

    expect(await runRagCli(["index", schemaDir, "--store", "memory", "--dimensions", "16"])).toBe(0);
    expect(readFileSync(lockPath, "utf8")).toBe(before);
    expect(await runRagCli(["query", schemaDir, "--question", "paid orders"])).toBe(0);
  });

  it.each([
    ["-k", "abc"],
    ["-k", "0"],
    ["-k", "1.5"],
    ["--dimensions", "0"],
    ["--dimensions", "1.5"],
  ])("rejects %s %s: it must be a positive integer", async (flag, value) => {
    expect(await runRagCli(["query", "./schema", "--question", "x", flag, value])).toBe(1);
    expect(stderr.join("")).toBe(`${flag} must be a positive integer (got ${value}).\n`);
  });

  it("rejects an unknown --types value instead of returning no results", async () => {
    expect(await runRagCli(["query", "./schema", "--question", "x", "--types", "table,tabel"])).toBe(1);
    expect(stderr.join("")).toBe(
      "Unknown --types value: tabel (expected table, column, cql, question, concept, relationship, tenant-policy).\n",
    );
  });

  it.each<[string, string[], string]>([
    ["an unknown --flag=value", ["index", "./schema", "--pg-urll=postgres://u:secret@h/db"], "Unknown option: --pg-urll\n"],
    [
      "--api-key=value",
      ["index", "./schema", "--api-key=sk-secret"],
      "--api-key was removed; set the key on a connection in ai.providerConfig in askdb.config.*.\n",
    ],
    [
      "a stray positional",
      ["index", "./schema", "postgres://u:secret@h/db"],
      "Unexpected extra argument: askdb rag takes one [schema-dir]. Pass other values with their flag, such as --pg-url <conn>.\n",
    ],
    ["an unknown command", ["postgres://u:secret@h/db"], "Unknown command (expected 'index', 'query', or 'setup-store')\n"],
    [
      "a connection string as [schema-dir]",
      ["index", "--store", "pgvector", "postgres://u:secret@h/db"],
      "The [schema-dir] argument looks like a connection string; pass a connection string with --pg-url.\n",
    ],
    [
      "a connection string given to --store",
      ["index", "./schema", "--store", "postgres://u:secret@h/db"],
      "Unknown store (expected 'memory', 'file', or 'pgvector').\n",
    ],
    ["a connection string given to --embedder", ["index", "./schema", "--embedder", "postgres://u:secret@h/db"], "Unknown embedder (expected 'mock' or 'ai').\n"],
  ])("never repeats %s in its error", async (_case, args, message) => {
    expect(await runRagCli(args)).toBe(1);
    expect(stderr.join("")).toBe(message);
  });

  it.each<[string, string[], string]>([
    ["an unknown command", ["idnex"], "Unknown command: idnex (expected 'index', 'query', or 'setup-store')"],
    ["an unknown option", ["index", "./schema", "--nope"], "Unknown option: --nope"],
    ["a flag without its value", ["index", "./schema", "--store"], "--store requires a value."],
    ["a value on a switch", ["index", "./schema", "--force=yes"], "--force takes no value."],
    [
      "an unknown --log-level",
      ["index", "./schema", "--log-level", "loud"],
      `Invalid --log-level: loud (expected one of ${formatSupportedAskDbLogLevels()})`,
    ],
  ])("rejects %s", async (_case, args, message) => {
    expect(await runRagCli(args)).toBe(1);
    expect(stderr.join("")).toBe(`${message}\n`);
  });

  it("query on a lock from an older @askdb/rag says to re-run askdb rag index", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir])).toBe(0);
    const lockPath = join(schemaDir, "schema.lock.json");
    writeFileSync(lockPath, JSON.stringify({ ...JSON.parse(readFileSync(lockPath, "utf8")), version: 1 }));

    expect(await runRagCli(["query", schemaDir, "--question", "paid orders"])).toBe(1);
    expect(stderr.join("")).toBe(
      "schema.lock.json was written by an older @askdb/rag (unscoped chunk ids); rebuild the index. " +
        "Re-run `askdb rag index` before querying.\n",
    );
  });

  it("takes --flag=value like --flag value", async () => {
    expect(await runRagCli(["index", copyFixture(), "--store=pgvector", `--pg-url=${PG_URL}`, "--pg-table=chunks"])).toBe(0);
    expect(pgvector.options).toEqual([expect.objectContaining({ connectionString: PG_URL, table: "chunks" })]);
  });

  it("rejects --api-key: keys come from ai.providerConfig, never argv", async () => {
    const schemaDir = copyFixture();
    expect(await runRagCli(["index", schemaDir, "--api-key", "sk-secret"])).toBe(1);
    expect(stderr.join("")).toBe(
      "--api-key was removed; set the key on a connection in ai.providerConfig in askdb.config.*.\n",
    );
  });

  describe("logging", () => {
    function readEvents(path: string): Record<string, unknown>[] {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    it("--log-file and --correlation-id tag every event, query's included", async () => {
      const schemaDir = copyFixture();
      const logFile = join(tempDir(), "rag.log");
      const flags = ["--log-file", logFile, "--correlation-id", "cid-1"];
      expect(await runRagCli(["index", schemaDir, ...flags])).toBe(0);
      expect(await runRagCli(["query", schemaDir, "--question", "paid orders", ...flags])).toBe(0);
      const events = readEvents(logFile);
      expect(events.filter((event) => String(event.event).startsWith("askdb.rag.index")).length).toBeGreaterThan(0);
      expect(events.every((event) => event.correlationId === "cid-1")).toBe(true);
      // Once per event: a second copy from the indexer's own context would be a duplicate JSON key.
      const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
      expect(lines.every((line) => line.split('"correlationId"').length === 2)).toBe(true);
      expect(events).toContainEqual(
        expect.objectContaining({ event: "askdb.rag.cli.query", k: 8, resultCount: expect.any(Number) }),
      );
    });

    // `LOG` stands for the run's log file, in config or on the command line.
    it.each<[string, NonNullable<AskDbConfig["logging"]>, string[], string | undefined]>([
      ["logging.* from config", { logFile: "LOG", level: "info", correlationId: "cfg-cid" }, [], "cfg-cid"],
      ["logging.level over the info --log-file implies", { level: "warn" }, ["--log-file", "LOG"], undefined],
      ["--log-level in upper case", {}, ["--log-file", "LOG", "--log-level", "WARN"], undefined],
    ])("honours %s", async (_case, logging, flags, correlationId) => {
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir])).toBe(0);
      const logFile = join(tempDir(), "rag.log");
      const withLog = (value: string | undefined) => (value === "LOG" ? logFile : value);
      installRuntime({ ...BASE_CONFIG, logging: { ...logging, logFile: withLog(logging.logFile) } });

      const args = ["query", schemaDir, "--question", "paid orders", ...flags.map((flag) => withLog(flag)!)];
      expect(await runRagCli(args)).toBe(0);
      const queryEvents = readEvents(logFile).filter((event) => event.event === "askdb.rag.cli.query");
      expect(queryEvents).toEqual(correlationId ? [expect.objectContaining({ correlationId })] : []);
    });
  });

  describe("config fallbacks", () => {
    it("index reads the schema dir from introspection.outputDir and the file store path from rag.storeConfig.file", async () => {
      const schemaDir = copyFixture();
      const basePath = join(tempDir(), "orders");
      installRuntime({
        ...BASE_CONFIG,
        introspection: { ...BASE_CONFIG.introspection, outputDir: schemaDir },
        rag: { embedder: "mock", store: "file", storeConfig: { file: { basePath } } },
      });
      expect(await runRagCli(["index"])).toBe(0);
      expect(existsSync(`${basePath}.embeddings.json`)).toBe(true);
      expect(readLock(schemaDir)).toMatchObject({ embedderId: "mock:lexical-64" });

      const flagPath = join(tempDir(), "flag");
      expect(await runRagCli(["index", "--file-path", flagPath])).toBe(0);
      expect(existsSync(`${flagPath}.embeddings.json`)).toBe(true);
    });

    it("a memory store configured without rag.storeConfig indexes", async () => {
      // AskDbConfig types storeConfig as required, but config load accepts a memory store without it.
      installRuntime({ ...BASE_CONFIG, rag: { embedder: "mock", store: "memory" } as AskDbConfig["rag"] });
      expect(await runRagCli(["index", copyFixture()])).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({ schemaId: "orders-users" });
    });

    it("pgvector settings come from rag.storeConfig.pgvector, and flags win", async () => {
      installRuntime({
        ...BASE_CONFIG,
        rag: {
          embedder: "mock",
          store: "pgvector",
          storeConfig: { pgvector: { databaseUrl: " postgres://config/db ", table: "config_chunks", indexStrategy: "ivfflat" } },
        },
      });
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir])).toBe(0);
      expect(await runRagCli(["index", schemaDir, "--pg-url", PG_URL, "--pg-table", "flag_chunks"])).toBe(0);
      expect(pgvector.options).toEqual([
        expect.objectContaining({ connectionString: "postgres://config/db", table: "config_chunks", indexStrategy: "ivfflat" }),
        expect.objectContaining({ connectionString: PG_URL, table: "flag_chunks" }),
      ]);
    });

    it("--store pgvector and setup-store read rag.storeConfig.pgvector when another store is configured", async () => {
      installRuntime({
        ...BASE_CONFIG,
        rag: {
          embedder: "mock",
          store: "file",
          storeConfig: { file: {}, pgvector: { databaseUrl: PG_URL, indexStrategy: "none" } },
        },
      });
      expect(await runRagCli(["index", copyFixture(), "--store", "pgvector"])).toBe(0);
      expect(await runRagCli(["setup-store", "--dimensions", "16"])).toBe(0);
      expect(pgvector.options).toEqual([
        expect.objectContaining({ connectionString: PG_URL, indexStrategy: "none" }),
        expect.objectContaining({ connectionString: PG_URL, indexStrategy: "none", dimensions: 16 }),
      ]);
    });

    it("rejects an unknown rag.storeConfig.pgvector.indexStrategy that config load didn't check", async () => {
      installRuntime({
        ...BASE_CONFIG,
        rag: { embedder: "mock", store: "file", storeConfig: { file: {}, pgvector: { indexStrategy: "hsnw" } } },
      });
      expect(await runRagCli(["setup-store", "--pg-url", PG_URL, "--dimensions", "16"])).toBe(1);
      expect(stderr.join("")).toBe(
        'Invalid rag.storeConfig.pgvector.indexStrategy "hsnw" (expected ivfflat, hnsw, none).\n',
      );
      expect(pgvector.options).toEqual([]);
    });

    it.each<[string, string[], AskDbConfig, string]>([
      [
        "--file-path on the configured pgvector store",
        ["--file-path", "./vectors"],
        { ...BASE_CONFIG, rag: { embedder: "mock", store: "pgvector", storeConfig: { pgvector: { databaseUrl: PG_URL } } } },
        "--file-path applies to the file store, but this run uses the pgvector store (from rag.store). Pass --store file, or drop --file-path.",
      ],
      [
        "--pg-url on the configured file store",
        ["--pg-url", PG_URL],
        BASE_CONFIG,
        "--pg-url applies to the pgvector store, but this run uses the file store (from rag.store). Pass --store pgvector, or drop --pg-url.",
      ],
      [
        "--pg-table with --store file",
        ["--store", "file", "--pg-table", "chunks"],
        BASE_CONFIG,
        "--pg-table applies to the pgvector store, but this run uses the file store (from --store). Pass --store pgvector, or drop --pg-table.",
      ],
    ])("index refuses %s instead of ignoring it", async (_case, flags, config, message) => {
      installRuntime(config);
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir, ...flags])).toBe(1);
      expect(stderr.join("")).toBe(`${message}\n`);
      expect(pgvector.options).toEqual([]);
      expect(existsSync(join(schemaDir, "schema.lock.json"))).toBe(false);
    });

    it("a pgvector store without a URL names the flag and the config key", async () => {
      expect(await runRagCli(["index", copyFixture(), "--store", "pgvector"])).toBe(1);
      expect(stderr.join("")).toMatch(
        /pgvector store requires --pg-url, or rag\.storeConfig\.pgvector\.databaseUrl in askdb\.config\.\*/,
      );
    });
  });

  describe("the ai embedder", () => {
    it.each<[string, string[], NonNullable<AskDbConfig["ai"]["embedding"]>, string, string]>([
      ["ai.embedding", [], { model: "text-embedding-3-small", dimensions: 4 }, "text-embedding-3-small", "ai-sdk:openai:text-embedding-3-small:4"],
      [
        "--embedder-model over ai.embedding.model",
        ["--embedder-model", "text-embedding-3-large"],
        { model: "text-embedding-3-small", dimensions: 4 },
        "text-embedding-3-large",
        "ai-sdk:openai:text-embedding-3-large:4",
      ],
      [
        "a padded --embedder-model",
        ["--embedder-model", " text-embedding-3-large "],
        { model: "text-embedding-3-small", dimensions: 4 },
        "text-embedding-3-large",
        "ai-sdk:openai:text-embedding-3-large:4",
      ],
      ["the model's own width", [], { model: "text-embedding-3-small" }, "text-embedding-3-small", "ai-sdk:openai:text-embedding-3-small:default"],
    ])("indexes and queries with %s, under Studio's embedder id", async (_case, flags, embedding, model, embedderId) => {
      const server = await startEmbeddingServer();
      installRuntime(aiEmbeddingConfig(server.baseUrl, embedding));
      const schemaDir = copyFixture();

      expect(await runRagCli(["index", schemaDir, ...flags])).toBe(0);
      expect(readLock(schemaDir)).toMatchObject({ embedderId, dimensions: 4 });
      // A file store learns the width from the first vector: every text embedded is a chunk, with no width probe.
      const { chunksIndexed } = JSON.parse(stdout.join("")) as { chunksIndexed: number };
      expect(server.requests.reduce((total, request) => total + request.inputs, 0)).toBe(chunksIndexed);
      expect(await runRagCli(["query", schemaDir, "--question", "paid orders", ...flags])).toBe(0);
      expect(new Set(server.requests.map((request) => request.model))).toEqual(new Set([model]));
    });

    it('falls back to rag.embedder, including its deprecated "openai"', async () => {
      const server = await startEmbeddingServer();
      installRuntime({
        ...BASE_CONFIG,
        ai: { ...BASE_CONFIG.ai, providerConfig: { openai: { apiKey: "test-key", baseUrl: server.baseUrl } } },
        rag: { embedder: "openai", store: "file", storeConfig: { file: {} } },
      });
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir])).toBe(0);
      expect(readLock(schemaDir)).toMatchObject({ embedderId: "ai-sdk:openai:text-embedding-3-small:default" });
    });

    it.each<[string, string[], string, number]>([
      ["--dimensions over ai.embedding.dimensions", ["--dimensions", "6"], "ai-sdk:openai:text-embedding-3-small:6", 6],
      ['--embedder mock over rag.embedder: "ai"', ["--embedder", "mock"], "mock:lexical-64", 64],
    ])("%s", async (_case, flags, embedderId, dimensions) => {
      const server = await startEmbeddingServer();
      installRuntime(aiEmbeddingConfig(server.baseUrl, { model: "text-embedding-3-small", dimensions: 4 }));
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir, ...flags])).toBe(0);
      expect(readLock(schemaDir)).toMatchObject({ embedderId, dimensions });
    });

    it("--embedder ai with rag.embedder: \"mock\" (no ai.embedding) says how to configure it", async () => {
      expect(await runRagCli(["index", copyFixture(), "--embedder", "ai"])).toBe(1);
      expect(stderr.join("")).toMatch(/needs ai\.embedding in askdb\.config\.\*: set rag\.embedder: "ai" and ai\.embedding\.model/);
    });

    it.each([[["--embedder-model", " "]], [["--embedder-model=  "]]])("a blank --embedder-model fails: %j", async (flags) => {
      const server = await startEmbeddingServer();
      installRuntime(aiEmbeddingConfig(server.baseUrl));
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir, ...flags])).toBe(1);
      expect(stderr.join("")).toBe("--embedder-model requires a value.\n");
      expect(existsSync(join(schemaDir, "schema.lock.json"))).toBe(false);
      expect(server.requests).toEqual([]);
    });

    it.each([
      ["rag.embedder", []],
      ["--embedder", ["--embedder", "mock"]],
    ])("--embedder-model with the mock embedder from %s fails instead of indexing with the lexical hash", async (source, flags) => {
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir, ...flags, "--embedder-model", "text-embedding-3-large"])).toBe(1);
      expect(stderr.join("")).toBe(
        `--embedder-model applies to the ai embedder, but this run uses the mock embedder (from ${source}). ` +
          'Drop --embedder-model, or embed with ai.embedding (rag.embedder: "ai" in askdb.config.*).\n',
      );
      expect(existsSync(join(schemaDir, "schema.lock.json"))).toBe(false);
    });

    it("an ai.embedding connection without an API key names the connection", async () => {
      installRuntime({
        ...BASE_CONFIG,
        ai: { provider: "openai", providerConfig: { openai: {} }, embedding: { model: "text-embedding-3-small" } },
        rag: { embedder: "ai", store: "file", storeConfig: { file: {} } },
      });
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir])).toBe(1);
      expect(stderr.join("")).toBe(
        'askdb rag: embeddings need an API key on the ai.embedding connection ("default" in ai.providerConfig.openai). ' +
          "Set it in askdb.config.*, or pass --embedder mock.\n",
      );
      expect(existsSync(join(schemaDir, "schema.lock.json"))).toBe(false);
    });

    it.each([
      ["openai", 'askdb rag: --embedder "openai" is deprecated; use --embedder ai with ai.embedding: { provider: "openai", model }.'],
      ["ai-sdk", 'askdb rag: --embedder "ai-sdk" is deprecated; use --embedder ai.'],
    ])("--embedder %s is a deprecated alias of ai", async (alias, warning) => {
      const server = await startEmbeddingServer();
      installRuntime(aiEmbeddingConfig(server.baseUrl));
      const schemaDir = copyFixture();

      expect(await runRagCli(["index", schemaDir, "--embedder", alias])).toBe(0);
      expect(stderr.join("")).toBe(`${warning}\n`);
      expect(readLock(schemaDir)).toMatchObject({ embedderId: "ai-sdk:openai:text-embedding-3-small:4" });
    });

    it("--embedder openai refuses an ai.embedding on another provider", async () => {
      installRuntime({
        ...BASE_CONFIG,
        ai: {
          ...BASE_CONFIG.ai,
          providerConfig: { openai: { apiKey: "test-key" }, google: { apiKey: "google-key" } },
          embedding: { provider: "google", model: "gemini-embedding-001" },
        },
        rag: { embedder: "ai", store: "file", storeConfig: { file: {} } },
      });
      expect(await runRagCli(["index", copyFixture(), "--embedder", "openai"])).toBe(1);
      expect(stderr.join("")).toMatch(/--embedder openai embeds with OpenAI, but ai\.embedding\.provider is "google"; use --embedder ai\./);
    });
  });

  describe("vector width", () => {
    it("setup-store requires --dimensions and fails before building the store", async () => {
      expect(await runRagCli(["setup-store", "--pg-url", PG_URL])).toBe(1);
      expect(stderr.join("")).toMatch(/setup-store requires --dimensions <n>: the vector width of your embedding model/);
      expect(pgvector.options).toEqual([]);
    });

    it.each([
      ["--store memory", ["--store", "memory"], "setup-store provisions only the pgvector store; drop --store memory.\n"],
      ["--store file", ["--store", "file"], "setup-store provisions only the pgvector store; drop --store file.\n"],
      ["--file-path", ["--file-path", "./vectors"], "setup-store provisions only the pgvector store; drop --file-path.\n"],
      [
        "a positional",
        ["my_chunks"],
        "setup-store takes no [schema-dir]; pass the connection string with --pg-url and the table with --pg-table.\n",
      ],
    ])("setup-store refuses %s before connecting", async (_case, flags, message) => {
      // A configured pgvector URL, so setup-store would connect if it ignored the flag.
      installRuntime({
        ...BASE_CONFIG,
        rag: { embedder: "mock", store: "file", storeConfig: { file: {}, pgvector: { databaseUrl: PG_URL } } },
      });
      expect(await runRagCli(["setup-store", "--dimensions", "16", ...flags])).toBe(1);
      expect(stderr.join("")).toBe(message);
      expect(pgvector.options).toEqual([]);
    });

    it.each([[[]], [["--store", "pgvector"]]])("setup-store %j provisions the table at --dimensions", async (flags) => {
      expect(await runRagCli(["setup-store", "--pg-url", PG_URL, "--dimensions", "16", ...flags])).toBe(0);
      expect(pgvector.options).toEqual([expect.objectContaining({ connectionString: PG_URL, dimensions: 16 })]);
      expect(pgvector.calls).toEqual(["ensureSchema", "close"]);
    });

    it("index --store pgvector provisions the table before writing to it", async () => {
      expect(await runRagCli(["index", copyFixture(), "--store", "pgvector", "--pg-url", PG_URL])).toBe(0);
      expect(pgvector.options).toEqual([expect.objectContaining({ dimensions: 64 })]);
      expect(pgvector.calls[0]).toBe("ensureSchema");
      expect(pgvector.calls).toContain("upsert");
      expect(pgvector.calls.at(-1)).toBe("close");
    });

    it.each<[string, string[], number, string]>([
      ["the width the model returns", [], 4, "ai-sdk:openai:text-embedding-3-small:default"],
      ["--dimensions", ["--dimensions", "6"], 6, "ai-sdk:openai:text-embedding-3-small:6"],
    ])("index --store pgvector with the ai embedder creates the table at %s", async (_case, flags, dimensions, embedderId) => {
      const server = await startEmbeddingServer();
      installRuntime(aiEmbeddingConfig(server.baseUrl, { model: "text-embedding-3-small" }));
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir, "--store", "pgvector", "--pg-url", PG_URL, ...flags])).toBe(0);
      expect(pgvector.options).toEqual([expect.objectContaining({ dimensions })]);
      expect(readLock(schemaDir)).toMatchObject({ embedderId, dimensions });
    });

    it("query on pgvector with no width neither probes the model nor provisions the table", async () => {
      const server = await startEmbeddingServer();
      installRuntime(aiEmbeddingConfig(server.baseUrl, { model: "text-embedding-3-small" }));
      const schemaDir = copyFixture();
      expect(await runRagCli(["index", schemaDir, "--store", "pgvector", "--pg-url", PG_URL])).toBe(0);
      pgvector.options.length = 0;
      pgvector.calls.length = 0;
      server.requests.length = 0;

      expect(await runRagCli(["query", schemaDir, "--question", "paid orders", "--store", "pgvector", "--pg-url", PG_URL])).toBe(0);
      expect(pgvector.options).toHaveLength(1);
      expect(pgvector.options[0]).not.toHaveProperty("dimensions");
      expect(pgvector.calls).toEqual(["close"]);
      // One request: the question. No width probe.
      expect(server.requests).toEqual([{ model: "text-embedding-3-small", inputs: 1 }]);
    });

    it("a table of another width fails before any chunk is embedded, with the fix in flags", async () => {
      pgvector.tableDimensions = 8;
      const server = await startEmbeddingServer();
      const runs: [string[], AskDbConfig, string][] = [
        [["setup-store", "--pg-url", PG_URL, "--dimensions", "16"], BASE_CONFIG, "--dimensions asks for 16"],
        [["index", copyFixture(), "--store", "pgvector", "--pg-url", PG_URL], BASE_CONFIG, "the mock embedder writes 64"],
        [
          ["index", copyFixture(), "--store", "pgvector", "--pg-url", PG_URL, "--dimensions", "16"],
          BASE_CONFIG,
          "--dimensions asks for 16",
        ],
        [
          ["index", copyFixture(), "--store", "pgvector", "--pg-url", PG_URL],
          aiEmbeddingConfig(server.baseUrl, { model: "text-embedding-3-small" }),
          "embedding model text-embedding-3-small returns 4",
        ],
        [
          ["index", copyFixture(), "--store", "pgvector", "--pg-url", PG_URL],
          aiEmbeddingConfig(server.baseUrl, { model: "text-embedding-3-small", dimensions: 4 }),
          "ai.embedding.dimensions asks for 4",
        ],
      ];
      for (const [args, config, source] of runs) {
        installRuntime(config);
        stderr = [];
        expect(await runRagCli(args)).toBe(1);
        expect(stderr.join("")).toBe(
          `pgvector table "askdb_rag_chunks" holds 8-dimension vectors, but ${source}. ` +
            'Drop the table (DROP TABLE "askdb_rag_chunks";) and run again, pass --pg-table <name> for a new table, ' +
            "or pass --dimensions 8 if your embedding model supports that width.\n",
        );
      }
      expect(pgvector.calls).toEqual(Array.from({ length: runs.length }, () => ["ensureSchema", "close"]).flat());
      // The only embedding call is the width probe of the run with no width set.
      expect(server.requests).toEqual([{ model: "text-embedding-3-small", inputs: 1 }]);
    });
  });
});
