import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { createAiRegistry, type AiConfig } from "@askdb/ai";
import {
  createAskDbLogger,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  type AskDbLogger,
  type AskDbLogLevel,
} from "@askdb/core";
import { getAskDbRuntimeConfig, type AskDbRuntimeConfig } from "@askdb/config";
import {
  buildSchemaIndex,
  checkIndexMatches,
  createAiSdkEmbedder,
  createFileStore,
  createMemoryStore,
  createPgvectorStore,
  detectEmbeddingDimensions,
  loadChunkerSourcesFromDir,
  PgvectorDimensionMismatchError,
  type Embedder,
  type Filter,
  type PgvectorIndexStrategy,
  type QueryResult,
  type VectorStore,
} from "@askdb/rag";
import { readCliVersion } from "./version.js";

// Every built-in provider is registered and loads its @ai-sdk/* package only when first used,
// so ai.embedding alone selects the provider.
const ai = createAiRegistry();

const CLI_EMBEDDERS = ["mock", "ai"] as const;
/** Aliases of `ai` that mirror the deprecated `rag.embedder` values; removed at 1.0. */
const DEPRECATED_EMBEDDERS = {
  openai: 'askdb rag: --embedder "openai" is deprecated; use --embedder ai with ai.embedding: { provider: "openai", model }.',
  "ai-sdk": 'askdb rag: --embedder "ai-sdk" is deprecated; use --embedder ai.',
} as const;
type CliEmbedder = (typeof CLI_EMBEDDERS)[number] | keyof typeof DEPRECATED_EMBEDDERS;

function isCliEmbedder(value: string): value is CliEmbedder {
  return (CLI_EMBEDDERS as readonly string[]).includes(value) || Object.hasOwn(DEPRECATED_EMBEDDERS, value);
}

const CLI_STORES = ["memory", "file", "pgvector"] as const;
type CliStoreKind = (typeof CLI_STORES)[number];

function isCliStore(value: string): value is CliStoreKind {
  return (CLI_STORES as readonly string[]).includes(value);
}

/** The mock embedder is AskDB's own, so its width is the only one the CLI knows. */
const DEFAULT_MOCK_DIMENSIONS = 64;
const DEFAULT_PGVECTOR_TABLE = "askdb_rag_chunks";

type CliOptions = {
  schemaDir?: string;
  store?: CliStoreKind;
  embedder?: CliEmbedder;
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
  force?: boolean;
};

export async function runRagCli(argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes("--version") || argv.includes("-V")) {
      process.stdout.write(`${readCliVersion()}\n`);
      return 0;
    }
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      printHelp();
      return 0;
    }
    const cmd = argv[0]!;
    if (cmd !== "index" && cmd !== "query" && cmd !== "setup-store") {
      // Named only when it looks like a command: a misplaced value can be a secret.
      const named = /^[a-z][a-z-]*$/.test(cmd) ? `: ${cmd}` : "";
      throw new Error(`Unknown command${named} (expected 'index', 'query', or 'setup-store')`);
    }
    const opts = parseOptions(argv.slice(1));
    const runtimeConfig = getAskDbRuntimeConfig();
    if (cmd === "setup-store") return await runSetupStore(opts, runtimeConfig);
    const logger = buildLogger(opts, runtimeConfig);
    if (cmd === "index") return await runIndex(opts, logger, runtimeConfig);
    return await runQuery(opts, logger, runtimeConfig);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

async function runIndex(opts: CliOptions, logger: AskDbLogger, runtimeConfig: AskDbRuntimeConfig): Promise<number> {
  const schemaDir = resolveSchemaDir(opts, runtimeConfig);
  const sources = loadChunkerSourcesFromDir(schemaDir);
  const storeConfig = resolveStoreConfig(opts, runtimeConfig, schemaDir);
  const embedderConfig = resolveEmbedderConfig(opts, runtimeConfig);
  const embedder = await createEmbedder(embedderConfig);
  // A new pgvector table needs its width up front: the requested one, else the model's own. The
  // memory and file stores learn it from the first vector.
  const dimensions =
    storeConfig.kind === "pgvector"
      ? (embedderConfig.dimensions ?? (await detectEmbeddingDimensions(embedder)))
      : undefined;
  // Provision (idempotent) and verify the table's vector dimensions up front
  // so a mismatch fails with a clear message before any chunk is embedded.
  const store = await openStore(storeConfig, {
    dimensions,
    provision: (width) => describeWidth(opts, embedderConfig, width),
  });

  const result = await buildSchemaIndex({
    schema: sources,
    embedder,
    store,
    embedderId: embedderConfig.id,
    // The indexer leaves the lock alone for an ephemeral (memory) store.
    lockFilePath: lockFilePathFor(schemaDir),
    force: opts.force,
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

async function runQuery(opts: CliOptions, logger: AskDbLogger, runtimeConfig: AskDbRuntimeConfig): Promise<number> {
  if (!opts.question) {
    throw new Error("Missing --question for query command.");
  }
  const schemaDir = resolveSchemaDir(opts, runtimeConfig);
  const storeConfig = resolveStoreConfig(opts, runtimeConfig, schemaDir);
  if (storeConfig.kind === "memory") {
    throw new Error(
      "query has nothing to search in the memory store: the memory store lives only inside one process, " +
        "so a separate `index` run cannot populate it. Use --store file or --store pgvector.",
    );
  }
  const sources = loadChunkerSourcesFromDir(schemaDir);
  const embedderConfig = resolveEmbedderConfig(opts, runtimeConfig);
  assertQueryMatchesIndex(schemaDir, sources.schema.schemaId, embedderConfig);
  const embedder = await createEmbedder(embedderConfig);
  // Never detect here: without a known width, the pgvector store reads the existing table as it is.
  const store = await openStore(storeConfig, { dimensions: embedderConfig.dimensions });

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

/** The positional `<schema-dir>`, else `introspection.outputDir`, the same fallback as `askdb ask --schema`. */
function resolveSchemaDir(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig): string {
  return resolve(opts.schemaDir ?? runtimeConfig.introspection.outputDir);
}

function lockFilePathFor(schemaDir: string): string {
  return join(schemaDir, "schema.lock.json");
}

/**
 * Refuse to query with a different embedder (or dimensions) than the index was
 * built with — the similarity scores would be meaningless.
 */
function assertQueryMatchesIndex(schemaDir: string, schemaId: string, embedderConfig: EmbedderConfig): void {
  const match = checkIndexMatches({
    lockFilePath: lockFilePathFor(schemaDir),
    schemaId,
    embedderId: embedderConfig.id,
    dimensions: embedderConfig.dimensions,
  });
  if (match.ok) return;
  const fix =
    match.reason === "lock-outdated"
      ? "Re-run `askdb rag index` before querying."
      : "Pass the same --embedder/--embedder-model/--dimensions used for `index`, or re-run `index`.";
  throw new Error(`${match.message} ${fix}`);
}

async function runSetupStore(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig): Promise<number> {
  // There's no embedder to ask, so the width has no default; fail before anything connects.
  const dimensions = opts.dimensions;
  if (dimensions === undefined) {
    throw new Error(
      "setup-store requires --dimensions <n>: the vector width of your embedding model " +
        "(the same value as ai.embedding.dimensions).",
    );
  }
  assertSetupStoreFlags(opts);
  const config = resolvePgvectorConfig(opts, readConfiguredStore(runtimeConfig));
  const store = await openStore(config, { dimensions, provision: (width) => `--dimensions asks for ${width}` });
  await closeStore(store);
  process.stdout.write(
    `pgvector schema ready: table "${config.table ?? DEFAULT_PGVECTOR_TABLE}" (dimensions=${dimensions})\n`,
  );
  return 0;
}

type EmbedderConfig =
  | { kind: "mock"; id: string; dimensions: number }
  | {
      kind: "ai";
      id: string;
      /** The width to request, from --dimensions or ai.embedding.dimensions; undefined leaves it to the model. */
      dimensions: number | undefined;
      model: string;
      aiConfig: AiConfig;
    };

/**
 * `--embedder`, else the configured one: `ai` when askdb.config.* sets `rag.embedder: "ai"` (the
 * only case the runtime resolves `ai.embedding`), else `mock`. The `ai` embedder takes the same
 * path and id as Studio's, so either accepts an index the other built.
 */
function resolveEmbedderConfig(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig): EmbedderConfig {
  const embedding = runtimeConfig.ai.embedding;
  const choice = opts.embedder ?? (embedding ? "ai" : "mock");
  if (choice === "mock") {
    const dimensions = opts.dimensions ?? DEFAULT_MOCK_DIMENSIONS;
    return { kind: "mock", id: `mock:lexical-${dimensions}`, dimensions };
  }
  if (choice !== "ai") process.stderr.write(`${DEPRECATED_EMBEDDERS[choice]}\n`);
  if (!embedding) {
    throw new Error(
      `--embedder ${choice} needs ai.embedding in askdb.config.*: set rag.embedder: "ai" and ai.embedding.model.`,
    );
  }
  if (choice === "openai" && embedding.provider !== "openai") {
    throw new Error(
      `--embedder openai embeds with OpenAI, but ai.embedding.provider is "${embedding.provider}"; use --embedder ai.`,
    );
  }
  // The registry reads ASKDB_AI_EMBEDDING_MODEL first, so --embedder-model overrides ai.embedding.model.
  const env = opts.embedderModel
    ? { ...embedding.env, ASKDB_AI_EMBEDDING_MODEL: opts.embedderModel }
    : embedding.env;
  const aiConfig = ai.resolveEmbeddingConfig(env);
  if (!aiConfig) {
    throw new Error(
      `askdb rag: embeddings need an API key on the ai.embedding connection ` +
        `("${embedding.connection}" in ai.providerConfig.${embedding.provider}). ` +
        "Set it in askdb.config.*, or pass --embedder mock.",
    );
  }
  const model = opts.embedderModel ?? embedding.model;
  const dimensions = opts.dimensions ?? embedding.dimensions;
  return {
    kind: "ai",
    // Studio's id. The adapter's canonical provider name (`foundry` resolves to `azure`) keeps ids stable.
    id: `ai-sdk:${aiConfig.provider}:${model}:${dimensions ?? "default"}`,
    dimensions,
    model,
    aiConfig,
  };
}

async function createEmbedder(config: EmbedderConfig): Promise<Embedder> {
  if (config.kind === "mock") return createMockEmbedder(config.dimensions);
  const model = await ai.createEmbeddingModel(config.aiConfig, { dimensions: config.dimensions });
  return createAiSdkEmbedder({ model });
}

/** Where the width a pgvector table refused came from, for the mismatch message. */
function describeWidth(opts: CliOptions, embedderConfig: EmbedderConfig, width: number): string {
  if (opts.dimensions !== undefined) return `--dimensions asks for ${width}`;
  if (embedderConfig.kind === "mock") return `the mock embedder writes ${width}`;
  if (embedderConfig.dimensions !== undefined) return `ai.embedding.dimensions asks for ${width}`;
  return `embedding model ${embedderConfig.model} returns ${width}`;
}

/**
 * Deterministic mock embedder used for tests, CI, and quick smoke-checks.
 *
 * Produces a stable lexical bag-of-words vector by hashing normalized tokens;
 * same text always yields the same vector. Not a real embedder, but useful for
 * local smoke tests because shared terms like "revenue" can rank related chunks.
 */
function createMockEmbedder(dim = DEFAULT_MOCK_DIMENSIONS): Embedder {
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

type PgvectorConfig = {
  kind: "pgvector";
  connectionString: string;
  table: string | undefined;
  indexStrategy: PgvectorIndexStrategy | undefined;
};

type StoreConfig = { kind: "memory" } | { kind: "file"; basePath: string } | PgvectorConfig;

type ConfiguredStore = {
  kind: CliStoreKind;
  fileBasePath: string | undefined;
  pgUrl: string | undefined;
  pgTable: string | undefined;
  pgIndexStrategy: string | undefined;
};

/**
 * Every store setting the CLI reads from askdb.config.*, in one place: the store, the file base
 * path, and the pgvector URL, table and index strategy. The pgvector settings come from the
 * structured config, so they also serve `--store pgvector` and `setup-store` when another store
 * is configured.
 */
function readConfiguredStore(runtimeConfig: AskDbRuntimeConfig): ConfiguredStore {
  const { store, storeConfig } = runtimeConfig.structured.rag;
  return {
    kind: store,
    fileBasePath: trimmed(storeConfig.file?.basePath),
    pgUrl: trimmed(storeConfig.pgvector?.databaseUrl),
    pgTable: trimmed(storeConfig.pgvector?.table),
    pgIndexStrategy: trimmed(storeConfig.pgvector?.indexStrategy),
  };
}

/** Flags first, then askdb.config.*, then the built-in default. */
function resolveStoreConfig(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig, schemaDir: string): StoreConfig {
  const configured = readConfiguredStore(runtimeConfig);
  const kind = opts.store ?? configured.kind;
  assertStoreFlagsApply(opts, kind);
  if (kind === "memory") return { kind };
  if (kind === "file") {
    const basePath =
      opts.filePath ?? (configured.fileBasePath ? resolve(configured.fileBasePath) : join(schemaDir, "schema"));
    return { kind, basePath };
  }
  return resolvePgvectorConfig(opts, configured);
}

function resolvePgvectorConfig(opts: CliOptions, configured: ConfiguredStore): PgvectorConfig {
  const connectionString = opts.pgUrl ?? configured.pgUrl;
  if (!connectionString) {
    throw new Error("pgvector store requires --pg-url, or rag.storeConfig.pgvector.databaseUrl in askdb.config.*.");
  }
  return {
    kind: "pgvector",
    connectionString,
    table: opts.pgTable ?? configured.pgTable,
    indexStrategy: parseIndexStrategy(configured.pgIndexStrategy),
  };
}

const STORE_FLAGS = [
  ["filePath", "--file-path", "file"],
  ["pgUrl", "--pg-url", "pgvector"],
  ["pgTable", "--pg-table", "pgvector"],
] as const;

/** A flag for another store than the one this run uses would be silently ignored, so refuse it. */
function assertStoreFlagsApply(opts: CliOptions, kind: CliStoreKind): void {
  for (const [key, flag, store] of STORE_FLAGS) {
    if (opts[key] === undefined || kind === store) continue;
    throw new Error(
      `${flag} applies to the ${store} store, but this run uses the ${kind} store ` +
        `(from ${opts.store ? "--store" : "rag.store"}). Pass --store ${store}, or drop ${flag}.`,
    );
  }
}

/** setup-store provisions only the pgvector store, whatever `rag.store` is, so another store's flag is a mistake. */
function assertSetupStoreFlags(opts: CliOptions): void {
  if (opts.store !== undefined && opts.store !== "pgvector") {
    throw new Error(`setup-store provisions only the pgvector store; drop --store ${opts.store}.`);
  }
  if (opts.filePath !== undefined) {
    throw new Error("setup-store provisions only the pgvector store; drop --file-path.");
  }
}

/** Validated here because config load checks it only when `rag.store` is `pgvector`. */
function parseIndexStrategy(raw: string | undefined): PgvectorIndexStrategy | undefined {
  const value = raw?.toLowerCase();
  if (value === undefined || value === "ivfflat" || value === "hnsw" || value === "none") return value;
  throw new Error(`Invalid rag.storeConfig.pgvector.indexStrategy "${raw}" (expected ivfflat, hnsw, or none).`);
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

type CliStore = VectorStore & {
  close?: () => Promise<void>;
  flush?: () => void;
};

/**
 * Opens the store. `dimensions` reaches only a pgvector store, and only when known. With
 * `provision`, a pgvector store creates its table when it's missing and refuses an existing table
 * of another width, with the fix in flags; `provision` says where the refused width came from.
 */
async function openStore(
  config: StoreConfig,
  { dimensions, provision }: { dimensions?: number; provision?: (width: number) => string },
): Promise<CliStore> {
  if (config.kind === "memory") return createMemoryStore();
  if (config.kind === "file") return createFileStore({ basePath: config.basePath });
  const store = createPgvectorStore({
    connectionString: config.connectionString,
    table: config.table,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(config.indexStrategy ? { indexStrategy: config.indexStrategy } : {}),
  });
  if (!provision) return store;
  try {
    await store.ensureSchema();
  } catch (error) {
    // The caller never receives this store, so close its pool here.
    await store.close().catch(() => {});
    if (!(error instanceof PgvectorDimensionMismatchError)) throw error;
    throw new Error(
      `pgvector table "${error.table}" holds ${error.tableDimensions}-dimension vectors, but ${provision(error.dimensions)}. ` +
        `Drop the table (DROP TABLE "${error.table}";) and run again, pass --pg-table <name> for a new table, ` +
        `or pass --dimensions ${error.tableDimensions} if your embedding model supports that width.`,
    );
  }
  return store;
}

async function closeStore(store: CliStore): Promise<void> {
  if (typeof store.flush === "function") store.flush();
  if (typeof store.close === "function") await store.close();
}

function buildLogger(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig): AskDbLogger {
  const level = resolveLogLevel(opts, runtimeConfig);
  return createAskDbLogger({
    correlationId:
      opts.correlationId ?? runtimeConfig.logging.correlationId ?? randomUUID(),
    level,
    logFile: opts.logFile ?? runtimeConfig.logging.logFile,
    logStdout: opts.logStdout ?? runtimeConfig.logging.logStdout,
  });
}

function resolveLogLevel(opts: CliOptions, runtimeConfig: AskDbRuntimeConfig): AskDbLogLevel {
  if (opts.logLevel !== undefined && opts.logLevel !== "") {
    const lvl = opts.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(lvl)) {
      throw new Error(
        `Invalid --log-level: ${opts.logLevel} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return lvl;
  }
  const envLevel = runtimeConfig.logging.level?.toLowerCase();
  if (envLevel && isSupportedAskDbLogLevel(envLevel)) return envLevel;
  if (opts.verbose || opts.logFile || opts.logStdout) return "info";
  return "silent";
}

function parseOptions(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      if (opts.schemaDir !== undefined) {
        // Not repeated: a stray value can be a secret, such as a connection string without its flag.
        throw new Error(
          "Unexpected extra argument: askdb rag takes one [schema-dir]. Pass other values with their flag, such as --pg-url <conn>.",
        );
      }
      opts.schemaDir = arg;
      continue;
    }
    // `--flag=value` works like `--flag value`. Errors name the flag, never the value.
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const value = (): string => {
      if (inline === undefined) return readValue(argv, ++i, flag);
      if (!inline) throw new Error(`${flag} requires a value.`);
      return inline;
    };
    const set = (): true => {
      if (inline !== undefined) throw new Error(`${flag} takes no value.`);
      return true;
    };
    switch (flag) {
      case "--store": {
        const raw = value();
        if (!isCliStore(raw)) {
          throw new Error(`Unknown store: ${raw} (expected 'memory', 'file', or 'pgvector').`);
        }
        opts.store = raw;
        break;
      }
      case "--embedder": {
        const raw = value();
        if (!isCliEmbedder(raw)) {
          throw new Error(
            `Unknown embedder: ${raw} (expected ${CLI_EMBEDDERS.map((e) => `'${e}'`).join(" or ")}).`,
          );
        }
        opts.embedder = raw;
        break;
      }
      case "--embedder-model": {
        // Trimmed as the registry trims it, so the embedder id names the model that embeds.
        const model = value().trim();
        if (!model) throw new Error(`${flag} requires a value.`);
        opts.embedderModel = model;
        break;
      }
      case "--api-key":
        // Secrets on argv leak through shell history and the process list.
        throw new Error("--api-key was removed; set the key on a connection in ai.providerConfig in askdb.config.*.");
      case "--question":
        opts.question = value();
        break;
      case "-k":
      case "--k": {
        const raw = value();
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`-k must be a positive integer (got ${raw}).`);
        }
        opts.k = n;
        break;
      }
      case "--pg-url":
        opts.pgUrl = value();
        break;
      case "--pg-table":
        opts.pgTable = value();
        break;
      case "--dimensions": {
        const raw = value();
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--dimensions must be a positive integer (got ${raw}).`);
        }
        opts.dimensions = n;
        break;
      }
      case "--force":
        opts.force = set();
        break;
      case "--types":
        opts.filterTypes = value().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--file-path":
        opts.filePath = value();
        break;
      case "-v":
      case "--verbose":
        opts.verbose = set();
        break;
      case "--log-level":
        opts.logLevel = value();
        break;
      case "--log-file":
        opts.logFile = value();
        break;
      case "--log-stdout":
        opts.logStdout = set();
        break;
      case "--correlation-id":
        opts.correlationId = value();
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
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

function printHelp(): void {
  process.stdout.write(
    [
      "askdb rag - Chunk, embed, and query a schema artifact directory.",
      "",
      "Usage:",
      "  askdb rag index [schema-dir]   [--store memory|file|pgvector] [--embedder mock|ai] [--embedder-model <id>] [--dimensions <n>] [--force]",
      "  askdb rag query [schema-dir]   --question \"...\" [-k 8] [--types table,column,cql] [--store file|pgvector] [--embedder mock|ai] [--embedder-model <id>] [--dimensions <n>]",
      "  askdb rag setup-store          --dimensions <n> [--pg-url <conn>] [--pg-table askdb_rag_chunks]",
      "",
      "Flags override askdb.config.*: [schema-dir] defaults to introspection.outputDir, --store to rag.store,",
      "--pg-url, --pg-table and --file-path to rag.storeConfig, and --embedder to rag.embedder.",
      "",
      "Commands:",
      "  index        Chunk and embed a schema directory into the store. Only chunks the store",
      "               doesn't already hold (same id + content hash) are embedded; --force re-embeds everything.",
      "  query        Run a similarity query against an indexed store. Use the same embedder/dimensions as `index`.",
      "  setup-store  Create the pgvector extension, table, and indexes at --dimensions, the vector width of",
      "               your embedding model. Idempotent — safe to re-run.",
      "",
      "Stores:",
      "  memory     in-memory cosine, lives only for one process. Useful for `index` dry runs (writes no schema.lock.json); `query` can't use it.",
      "  file       persisted as <schema-dir>/schema.embeddings.{bin,json}, or <path>.embeddings.{bin,json} with --file-path <path>.",
      "  pgvector   --pg-url <conn> [--pg-table askdb_rag_chunks]",
      "",
      "Embedders:",
      "  mock       deterministic lexical hash, 64 dimensions unless --dimensions. CI-safe.",
      "  ai         the ai.embedding model from askdb.config.* (needs rag.embedder: \"ai\"). --embedder-model",
      "             overrides its model; --dimensions requests a width.",
      "",
      "Logging matches `askdb`:",
      "  --log-level <level> --log-file <path> --log-stdout --correlation-id <id> -v/--verbose",
      "",
    ].join("\n"),
  );
}
