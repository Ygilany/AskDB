import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createAskDbLogger,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  type AskDbLogger,
  type AskDbLogLevel,
} from "@askdb/core";
import { env } from "@askdb/config";
import { buildSchemaIndex } from "./indexer/index.js";
import { loadChunkerSourcesFromDir } from "./chunker/sources.js";
import { createOpenAiEmbedder as createAiSdkOpenAiEmbedder } from "./embedders/openai.js";
import { createMemoryStore } from "./stores/memory.js";
import { createFileStore } from "./stores/file.js";
import {
  createPgvectorStore,
  type CreatePgvectorStoreOptions,
} from "./stores/pgvector.js";
import type {
  Embedder,
  Filter,
  QueryResult,
  VectorStore,
} from "./types.js";

type CliOptions = {
  command?: "index" | "query";
  schemaDir?: string;
  store?: "memory" | "file" | "pgvector";
  embedder?: "mock" | "openai";
  question?: string;
  k?: number;
  pgUrl?: string;
  pgTable?: string;
  dimensions?: number;
  filterTypes?: string[];
  verbose?: boolean;
  logLevel?: string;
  logFile?: string;
  logStdout?: boolean;
  correlationId?: string;
  filePath?: string;
  embedderModel?: string;
  apiKey?: string;
};

export async function runRagCli(argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes("--version") || argv.includes("-V")) {
      process.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    }
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      printHelp();
      return 0;
    }
    const cmd = argv[0];
    if (cmd !== "index" && cmd !== "query") {
      throw new Error(`Unknown command: ${cmd} (expected 'index' or 'query')`);
    }
    const opts = parseOptions(argv.slice(1));
    opts.command = cmd;
    if (!opts.schemaDir) {
      throw new Error("Missing positional <schema-dir>.");
    }
    const logger = buildLogger(opts);
    if (cmd === "index") return await runIndex(opts, logger);
    return await runQuery(opts, logger);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

async function runIndex(opts: CliOptions, logger: AskDbLogger): Promise<number> {
  const sources = loadChunkerSourcesFromDir(opts.schemaDir!);
  const embedder = buildEmbedder(opts);
  const dimensions = embedderDimensions(opts);
  const store = await buildStore(opts, dimensions);

  const result = await buildSchemaIndex({
    schema: sources,
    embedder,
    store,
    embedderId: embedderId(opts),
    lockFilePath: join(resolve(opts.schemaDir!), "schema.lock.json"),
    correlationId: opts.correlationId,
    logger,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaId: sources.schema.schemaId,
        chunksTotal: result.stats.chunksTotal,
        chunksIndexed: result.stats.chunksIndexed,
        chunksReused: result.stats.chunksReused,
        sensitiveExcluded: result.stats.sensitiveExcluded,
        sensitiveIncluded: result.stats.sensitiveIncluded,
      },
      null,
      2,
    )}\n`,
  );

  await closeStore(store);
  return 0;
}

async function runQuery(opts: CliOptions, logger: AskDbLogger): Promise<number> {
  if (!opts.question) {
    throw new Error("Missing --question for query command.");
  }
  const sources = loadChunkerSourcesFromDir(opts.schemaDir!);
  const embedder = buildEmbedder(opts);
  const dimensions = embedderDimensions(opts);
  const store = await buildStore(opts, dimensions);

  const filter: Filter = { schemaId: sources.schema.schemaId };
  if (opts.filterTypes && opts.filterTypes.length > 0) {
    filter.types = opts.filterTypes as Filter["types"];
  }

  const [vector] = await embedder([opts.question]);
  const k = opts.k ?? 8;
  const results = await store.query(vector, k, filter);

  logger.info(
    {
      event: "askdb.rag.cli.query",
      questionChars: opts.question.length,
      k,
      resultCount: results.length,
    },
    "rag query completed",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        question: opts.question,
        k,
        results: results.map((r: QueryResult) => ({
          id: r.id,
          score: Number(r.score.toFixed(6)),
          type: r.payload.type,
          schemaId: r.payload.schemaId,
          refs: r.payload.refs,
          textPreview: r.payload.text.slice(0, 200),
        })),
      },
      null,
      2,
    )}\n`,
  );

  await closeStore(store);
  return 0;
}

function buildEmbedder(opts: CliOptions): Embedder {
  const choice = opts.embedder ?? "mock";
  if (choice === "mock") return createMockEmbedder();
  if (choice === "openai") return createOpenAiEmbedder(opts);
  throw new Error(`Unknown embedder: ${choice}`);
}

function embedderId(opts: CliOptions): string {
  const choice = opts.embedder ?? "mock";
  if (choice === "openai") {
    const base = `openai:${opts.embedderModel ?? "text-embedding-3-small"}`;
    return opts.dimensions ? `${base}:${opts.dimensions}` : base;
  }
  return `mock:lexical-${embedderDimensions(opts)}`;
}

function embedderDimensions(opts: CliOptions): number {
  if (opts.dimensions) return opts.dimensions;
  const choice = opts.embedder ?? "mock";
  if (choice === "openai") {
    const model = opts.embedderModel ?? "text-embedding-3-small";
    if (model === "text-embedding-3-small") return 1536;
    if (model === "text-embedding-3-large") return 3072;
    if (model === "text-embedding-ada-002") return 1536;
    throw new Error(`Pass --dimensions for unknown embedder model: ${model}`);
  }
  return 64;
}

/**
 * Deterministic mock embedder used for tests, CI, and quick smoke-checks.
 *
 * Produces a stable lexical bag-of-words vector by hashing normalized tokens;
 * same text always yields the same vector. Not a real embedder, but useful for
 * local smoke tests because shared terms like "revenue" can rank related chunks.
 */
export function createMockEmbedder(dim = 64): Embedder {
  return async (texts: string[]) => {
    return texts.map((text) => {
      const v = new Array<number>(dim).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
      for (const token of tokens) {
        v[stableTokenHash(token) % dim] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  };
}

function stableTokenHash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createOpenAiEmbedder(opts: CliOptions): Embedder {
  const apiKey = opts.apiKey ?? env("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "createOpenAiEmbedder: set OPENAI_API_KEY or pass --api-key. The OpenAI embedder uses the AI SDK optional peers (`ai` and `@ai-sdk/openai`).",
    );
  }
  return createAiSdkOpenAiEmbedder({
    apiKey,
    model: opts.embedderModel ?? "text-embedding-3-small",
    baseURL: env("OPENAI_BASE_URL"),
    dimensions: opts.dimensions,
  });
}

async function buildStore(
  opts: CliOptions,
  dimensions: number,
): Promise<VectorStore & { close?: () => Promise<void>; flush?: () => void }> {
  const choice = opts.store ?? "file";
  if (choice === "memory") return createMemoryStore();
  if (choice === "file") {
    const path = opts.filePath
      ? opts.filePath
      : join(resolve(opts.schemaDir!), "schema");
    return createFileStore({ basePath: path });
  }
  if (choice === "pgvector") {
    if (!opts.pgUrl) {
      throw new Error(
        "pgvector store requires --pg-url (or set PGURL/DATABASE_URL via your shell).",
      );
    }
    const pgOptions: CreatePgvectorStoreOptions = {
      connectionString: opts.pgUrl,
      table: opts.pgTable,
      dimensions,
    };
    return createPgvectorStore(pgOptions);
  }
  throw new Error(`Unknown store: ${choice}`);
}

async function closeStore(store: VectorStore & { close?: () => Promise<void>; flush?: () => void }): Promise<void> {
  if (typeof store.flush === "function") store.flush();
  if (typeof store.close === "function") await store.close();
}

function buildLogger(opts: CliOptions): AskDbLogger {
  const level = resolveLogLevel(opts);
  return createAskDbLogger({
    correlationId:
      opts.correlationId ?? env("ASKDB_CORRELATION_ID") ?? randomUUID(),
    level,
    logFile: opts.logFile,
    logStdout: opts.logStdout,
  });
}

function resolveLogLevel(opts: CliOptions): AskDbLogLevel {
  if (opts.logLevel !== undefined && opts.logLevel !== "") {
    const lvl = opts.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(lvl)) {
      throw new Error(
        `Invalid --log-level: ${opts.logLevel} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return lvl;
  }
  const envLevel = env("ASKDB_LOG_LEVEL")?.toLowerCase();
  if (envLevel && isSupportedAskDbLogLevel(envLevel)) return envLevel;
  if (opts.verbose || opts.logFile || opts.logStdout) return "info";
  return "silent";
}

function parseOptions(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {};
  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      if (positional === 0) opts.schemaDir = arg;
      else throw new Error(`Unexpected positional argument: ${arg}`);
      positional++;
      continue;
    }
    switch (arg) {
      case "--store":
        opts.store = readValue(argv, ++i, arg) as CliOptions["store"];
        break;
      case "--embedder":
        opts.embedder = readValue(argv, ++i, arg) as CliOptions["embedder"];
        break;
      case "--embedder-model":
        opts.embedderModel = readValue(argv, ++i, arg);
        break;
      case "--api-key":
        opts.apiKey = readValue(argv, ++i, arg);
        break;
      case "--question":
        opts.question = readValue(argv, ++i, arg);
        break;
      case "-k":
      case "--k":
        opts.k = Number(readValue(argv, ++i, arg));
        break;
      case "--pg-url":
        opts.pgUrl = readValue(argv, ++i, arg);
        break;
      case "--pg-table":
        opts.pgTable = readValue(argv, ++i, arg);
        break;
      case "--dimensions":
        opts.dimensions = Number(readValue(argv, ++i, arg));
        break;
      case "--types":
        opts.filterTypes = readValue(argv, ++i, arg).split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--file-path":
        opts.filePath = readValue(argv, ++i, arg);
        break;
      case "-v":
      case "--verbose":
        opts.verbose = true;
        break;
      case "--log-level":
        opts.logLevel = readValue(argv, ++i, arg);
        break;
      case "--log-file":
        opts.logFile = readValue(argv, ++i, arg);
        break;
      case "--log-stdout":
        opts.logStdout = true;
        break;
      case "--correlation-id":
        opts.correlationId = readValue(argv, ++i, arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function readValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || (value.startsWith("--") && value !== flag)) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readPackageVersion(): string {
  const pkgPath = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function printHelp(): void {
  process.stdout.write(
    [
      "askdb-rag - Chunk + index + query a Schema v2 directory.",
      "",
      "Usage:",
      "  askdb-rag index <schema-dir>  [--store memory|file|pgvector] [--embedder mock|openai] [--dimensions <n>]",
      "  askdb-rag query <schema-dir>  --question \"...\" [-k 8] [--types table,column,cql]",
      "",
      "Stores:",
      "  memory     in-memory cosine. Ephemeral. Default for `query`-only smoke checks against `index --store memory`.",
      "  file       persisted as <schema-dir>/schema.embeddings.{bin,json} (default).",
      "  pgvector   --pg-url <conn> [--pg-table askdb_rag_chunks] [--dimensions <n>]",
      "",
      "Embedders:",
      "  mock       deterministic lexical hash. Default. CI-safe.",
      "  openai     AI SDK OpenAI embeddings; OPENAI_API_KEY (or --api-key); --embedder-model text-embedding-3-small (default).",
      "",
      "Logging matches `askdb`:",
      "  --log-level <level> --log-file <path> --log-stdout --correlation-id <id> -v/--verbose",
      "",
    ].join("\n"),
  );
}
