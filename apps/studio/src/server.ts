import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, relative, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateText as defaultGenerateText } from "ai";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  ask,
  askDbAiKeyMissingMessage,
  createAskDbEmbeddingModel,
  createAskDbLanguageModelFromEnv,
  isBuiltInDialectId,
  loadSchema,
  resolveAskDbAiConfig,
  resolveAskDbEmbeddingConfig,
  suggestEnrichment,
  tenantScopeSchema,
  type AskDbAiConfig,
  type AskDbAiEnv,
  type AskDbAiProvider,
  type AskDialectInput,
  type AskGenerateDeps,
  type TenantScope,
  type TenantSqlOutputMode,
  type V2Concept,
} from "@askdb/core";
import {
  buildSchemaIndex,
  chunkContentHash,
  chunkSchema,
  createAiSdkEmbedder,
  createFileStore,
  createMemoryStore,
  createPgvectorStore,
  createRetriever,
  loadChunkerSourcesFromDir,
  type ChunkType,
  type Embedder,
  type QueryResult,
  type VectorStore,
} from "@askdb/rag";
import {
  buildDefaultTableBody,
  buildFrontmatter,
  buildSuggestionContext,
  buildSuggestionTarget,
  buildTableDraft,
  loadWorkspace,
  replaceH2Section,
  replaceTableDescription,
  saveConcepts,
  saveTable,
  type SuggestSource,
  type TableDraft,
  type Workspace,
} from "@askdb/enrich";
import type {
  AskResponse,
  RagIndexResponse,
  RagQueryResponse,
  StudioRequestUsageDto,
  StudioRagChunkDto,
  StudioRagStatusDto,
  StudioWorkspaceDto,
  SuggestResponse,
} from "./shared/api.js";

const CLIENT_DIR = fileURLToPath(new URL("./client/", import.meta.url));

export type StudioOptions = {
  schema: string;
  host?: string;
  port?: number;
};

export type StudioServer = ReturnType<typeof createServer>;

type StudioState = {
  schemaDir: string;
  workspace: Workspace;
  ragMemoryStore?: ReturnType<typeof createMemoryStore>;
};

type StudioRagEmbedderConfig =
  | {
      kind: "mock";
      embedderId: string;
      dimensions: number;
      configured: true;
      label: string;
    }
  | {
      kind: "ai-sdk";
      provider: AskDbAiProvider;
      embedderId: string;
      dimensions: number;
      configured: boolean;
      label: string;
      model: string;
      baseUrl?: string;
      aiConfig?: AskDbAiConfig;
      requestDimensions?: number;
    };

type StudioRequestUsageCollector = ReturnType<typeof createRequestUsageCollector>;

type StudioOpenRagStore = {
  kind: StudioRagStatusDto["store"]["kind"];
  store: VectorStore & {
    flush?: () => void;
    close?: () => Promise<void>;
    size?: () => number;
    count?: (filter?: { schemaId?: string }) => Promise<number>;
  };
  basePath?: string;
  table?: string;
  indexStrategy?: string;
  dispose: () => Promise<void>;
};

type StudioTokenUsageInput = {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  embeddingTokens?: number;
};

const STUDIO_RAG_MOCK_DIMENSIONS = 64;
const STUDIO_RAG_MOCK_EMBEDDER_ID = `studio:mock-lexical-${STUDIO_RAG_MOCK_DIMENSIONS}`;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
let studioPgvectorStoreFactoryForTests: typeof createPgvectorStore | undefined;

export function setStudioPgvectorStoreFactoryForTests(
  factory: typeof createPgvectorStore | undefined,
): void {
  studioPgvectorStoreFactoryForTests = factory;
}

export function createStudioServer(options: StudioOptions): StudioServer {
  const schemaDir = resolve(options.schema);
  if (!existsSync(schemaDir)) {
    throw new Error(`schema directory not found: ${schemaDir}`);
  }

  const state: StudioState = {
    schemaDir,
    workspace: loadWorkspace(schemaDir),
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/") {
        return serveClientFile(res, "index.html");
      }
      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        return serveClientFile(res, decodeURIComponent(url.pathname.slice(1)));
      }
      if (req.method === "GET" && url.pathname === "/api/workspace") {
        return writeJson(res, 200, serializeWorkspace(state.workspace));
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/tables/")) {
        const tableId = decodeURIComponent(url.pathname.slice("/api/tables/".length));
        const body = await readJson(req);
        const draft = parseTableDraftBody(body);
        saveDraft(state, tableId, draft);
        return writeJson(res, 200, serializeWorkspace(state.workspace));
      }
      if (req.method === "POST" && url.pathname === "/api/concepts") {
        const body = await readJson(req);
        const concepts = parseConceptsBody(body);
        saveConceptsDraft(state, concepts);
        return writeJson(res, 200, serializeWorkspace(state.workspace));
      }
      if (req.method === "POST" && url.pathname === "/api/suggest") {
        const body = await readJson(req);
        const source = parseSuggestSource(body);
        const candidates = await suggestForSource(state.workspace, source);
        return writeJson(res, 200, { candidates });
      }
      if (req.method === "GET" && url.pathname === "/api/rag/status") {
        return writeJson(res, 200, await getRagStatus(state));
      }
      if (req.method === "POST" && url.pathname === "/api/rag/index") {
        const result = await indexRag(state);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/rag/query") {
        const body = await readJson(req);
        const query = parseRagQuery(body);
        const result = await queryRag(state, query);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJson(req);
        const options = parseAskBody(body);
        const result = await askSampleQuestion(state, options);
        return writeJson(res, 200, result);
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveClientFile(res, "index.html");
      }
      writeJson(res, 404, { error: { message: "Not found" } });
    } catch (error) {
      const status = error instanceof StudioHttpError ? error.status : 500;
      writeJson(res, status, {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}

export function serializeWorkspace(workspace: Workspace): StudioWorkspaceDto {
  const rt = getAskDbRuntimeConfig();
  const aiConfig = (() => {
    try {
      return resolveAskDbAiConfig(rt.ai.aiEnv);
    } catch {
      // A misconfigured AI env (e.g. azure without resourceName) shouldn't crash the workspace
      // listing — surface it as "not configured" in the UI and let the user fix .env.
      return undefined;
    }
  })();
  return {
    schemaDir: workspace.schemaDir,
    schemaId: workspace.physical.schemaId,
    warnings: workspace.warnings,
    aiConfigured: Boolean(aiConfig),
    model: aiConfig?.model ?? "gpt-4o-mini",
    aiProvider: aiConfig?.provider ?? "openai",
    tables: workspace.tables.map((table) => {
      const draft = buildTableDraft(table.physical, table.parsed);
      return {
        physical: table.physical,
        filename: table.filename,
        hasDescribableFile: Boolean(table.parsed),
        draft,
        missingColumnIds: workspace.warnings
          .filter(
            (
              warning,
            ): warning is Extract<Workspace["warnings"][number], { kind: "missing_column_md" }> =>
              warning.kind === "missing_column_md" && warning.tableId === table.physical.id,
          )
          .map((warning) => warning.columnId),
      };
    }),
    concepts: workspace.concepts?.frontmatter.concepts ?? [],
    tenantPolicy: (() => {
      const schema = loadSchema(workspace.schemaDir);
      return schema.tenantPolicy ?? null;
    })(),
  };
}

function saveConceptsDraft(state: StudioState, concepts: V2Concept[]): void {
  saveConcepts(state.workspace, { concepts });
  state.workspace = loadWorkspace(state.schemaDir);
}

function saveDraft(state: StudioState, tableId: string, draft: TableDraft): void {
  const table = state.workspace.tables.find((candidate) => candidate.physical.id === tableId);
  if (!table) throw new StudioHttpError(404, `No such table: ${tableId}`);

  const frontmatter = buildFrontmatter(
    table.physical,
    state.workspace.physical.schemaId,
    draft,
  );
  let body = table.parsed
    ? replaceTableDescription(table.parsed.body, draft.description)
    : buildDefaultTableBody(table.physical.name, draft.description);
  if (draft.commonQueryLanguage !== undefined) {
    body = replaceH2Section(body, "Common query language", draft.commonQueryLanguage);
  }
  if (draft.exampleQuestions !== undefined) {
    body = replaceH2Section(body, "Example questions", draft.exampleQuestions);
  }

  saveTable(state.workspace, tableId, frontmatter, body);
  state.workspace = loadWorkspace(state.schemaDir);
}

async function suggestForSource(workspace: Workspace, source: SuggestSource): Promise<SuggestResponse["candidates"]> {
  const rt = getAskDbRuntimeConfig();
  const model = await createAskDbLanguageModelFromEnv(rt.ai.aiEnv);
  if (!model) {
    throw new StudioHttpError(400, askDbAiKeyMissingMessage("AI enrichment suggestions"));
  }
  const candidates = await suggestEnrichment(
    buildSuggestionTarget(workspace, source),
    buildSuggestionContext(workspace, source.tableId),
    model,
  );
  return candidates.map((candidate) => ({ text: candidate.text }));
}

async function askSampleQuestion(
  state: StudioState,
  options: {
    question: string;
    useRag: boolean;
    tenantScope?: TenantScope;
    tenantSqlMode?: TenantSqlOutputMode;
  },
): Promise<AskResponse> {
  const rt = getAskDbRuntimeConfig();
  const mockSql = rt.dev.mockSql;
  const aiConfig = mockSql ? undefined : resolveAskDbAiConfig(rt.ai.aiEnv);
  if (!mockSql && !aiConfig) {
    throw new StudioHttpError(
      400,
      `${askDbAiKeyMissingMessage("Sample NL-to-SQL generation")} Set ASKDB_MOCK_SQL to bypass the live model.`,
    );
  }

  const schema = loadSchema(state.schemaDir);
  const retrievedChunks: QueryResult[] = [];
  const usage = createRequestUsageCollector();
  const ragIndex = options.useRag
    ? await createCurrentStudioRagIndex(state, "using RAG for sample generation", usage)
    : undefined;
  type AskModel = Parameters<typeof ask>[0]["model"];
  const model: AskModel = mockSql
    ? (undefined as unknown as AskModel)
    : ((await createAskDbLanguageModelFromEnv(rt.ai.aiEnv)) as AskModel);

  const schemaProvider =
    "provider" in schema && typeof schema.provider === "string"
      ? schema.provider
      : undefined;
  const dialect: AskDialectInput =
    rt.nlToSql.dialect ??
    (schemaProvider && isBuiltInDialectId(schemaProvider) ? schemaProvider : "postgres");

  const result = await ask({
    question: options.question,
    schema,
    model,
    dialect,
    explain: true,
    ...(options.tenantScope ? { tenantScope: options.tenantScope } : {}),
    ...(options.tenantSqlMode ? { tenantSqlMode: options.tenantSqlMode } : {}),
    ...(ragIndex
      ? {
          retriever: async (params) => {
            let results: QueryResult[];
            try {
              results = await ragIndex.retriever(params);
            } catch (error) {
              throw formatStudioRagOperationError(error, ragIndex.config);
            }
            retrievedChunks.splice(0, retrievedChunks.length, ...results);
            return results;
          },
          retrievalK: 8,
          retrievalThresholdChunks: 0,
          totalSchemaChunkCount: ragIndex.status.chunksTotal,
        }
      : {}),
    deps:
      mockSql !== undefined
        ? {
            generateText: (async () => ({ text: mockSql } as any)) as NonNullable<
              AskGenerateDeps["generateText"]
            >,
          }
        : {
            generateText: createTrackedGenerateText(usage),
          },
  }).finally(async () => {
    await ragIndex?.dispose();
  });

  return {
    sql: result.sql,
    explain: result.explain ?? null,
    warnings: schema.warnings,
    rag: {
      enabled: options.useRag,
      chunks: options.useRag ? retrievedChunks.map(serializeRagResult) : [],
    },
    tenant: options.tenantScope
      ? {
          enabled: true,
          sqlMode: options.tenantSqlMode ?? "sql-only",
          bindings: result.tenantBindings ?? [],
          params: result.tenantParams ?? [],
        }
      : null,
    usage: usage.toDto(),
  };
}

async function getRagStatus(state: StudioState): Promise<StudioRagStatusDto> {
  const config = resolveStudioRagEmbedderConfig();
  const sources = loadChunkerSourcesFromDir(state.schemaDir);
  const chunkResult = chunkSchema(sources);
  const lockPath = join(state.schemaDir, "schema.lock.json");
  const lock = readOptionalJson(lockPath) as
    | { embedderId?: string; updatedAt?: string; hashes?: Record<string, string> }
    | undefined;
  const currentHashes = Object.fromEntries(
    chunkResult.chunks.map((chunk) => [chunk.id, chunkContentHash(chunk.text)]),
  );
  const lockHashes = lock?.hashes ?? {};
  const hashIds = Object.keys(currentHashes);
  const store = await openStudioRagStore(state, config.dimensions);
  try {
    const chunksIndexed = await countStudioRagStoreChunks(store, sources.schema.schemaId);
    const stale =
      !lock ||
      lock.embedderId !== config.embedderId ||
      Object.keys(lockHashes).length !== hashIds.length ||
      hashIds.some((id) => lockHashes[id] !== currentHashes[id]) ||
      chunksIndexed !== hashIds.length;
    const fileArtifacts =
      store.kind === "file" && store.basePath
        ? {
            lock: existsSync(lockPath),
            embeddingsJson: existsSync(`${store.basePath}.embeddings.json`),
            embeddingsBin: existsSync(`${store.basePath}.embeddings.bin`),
          }
        : {
            lock: existsSync(lockPath),
            embeddingsJson: false,
            embeddingsBin: false,
          };

    return {
      schemaId: sources.schema.schemaId,
      store: {
        kind: store.kind,
        basePath: store.basePath ?? null,
        table: store.table ?? null,
        indexStrategy: store.indexStrategy ?? null,
      },
      embedder: {
        kind: config.kind,
        label: config.label,
        configured: config.configured,
        expectedId: config.embedderId,
        indexedId: lock?.embedderId ?? null,
        provider: config.kind === "ai-sdk" ? config.provider : null,
        model: config.kind === "ai-sdk" ? config.model : null,
        baseUrl: config.kind === "ai-sdk" ? config.baseUrl ?? null : null,
      },
      embedderId: lock?.embedderId ?? config.embedderId,
      expectedEmbedderId: config.embedderId,
      hasIndex: Boolean(lock && chunksIndexed > 0),
      stale,
      updatedAt: lock?.updatedAt ?? null,
      chunksTotal: chunkResult.chunks.length,
      chunksIndexed,
      dimensions: config.dimensions,
      expectedDimensions: config.dimensions,
      sensitiveExcluded: chunkResult.stats.sensitiveExcluded,
      sensitiveIncluded: chunkResult.stats.sensitiveIncluded,
      files: fileArtifacts,
    };
  } finally {
    await store.dispose();
  }
}

async function indexRag(state: StudioState): Promise<RagIndexResponse> {
  const config = resolveStudioRagEmbedderConfig();
  if (!config.configured) {
    throw new StudioHttpError(400, studioRagAiSdkKeyMissingMessage());
  }
  const usage = createRequestUsageCollector();
  clearIncompatibleRagStore(state, config);
  const sources = loadChunkerSourcesFromDir(state.schemaDir);
  const store = await openStudioRagStore(state, config.dimensions);
  let result: Awaited<ReturnType<typeof buildSchemaIndex>>;
  try {
    result = await buildSchemaIndex({
      schema: sources,
      embedder: await createStudioRagEmbedder(config, usage),
      store: store.store,
      embedderId: config.embedderId,
      lockFilePath: join(state.schemaDir, "schema.lock.json"),
    });
  } catch (error) {
    throw formatStudioRagOperationError(error, config);
  } finally {
    await store.dispose();
  }
  return {
    status: await getRagStatus(state),
    stats: result.stats,
    usage: usage.toDto(),
  };
}

async function queryRag(
  state: StudioState,
  query: { question: string; k: number; types?: ChunkType[] },
): Promise<RagQueryResponse> {
  const usage = createRequestUsageCollector();
  const ragIndex = await createCurrentStudioRagIndex(state, "querying chunks", usage);
  let results: QueryResult[];
  try {
    results = await ragIndex.retriever({
      question: query.question,
      k: query.k,
      filter: {
        schemaId: ragIndex.status.schemaId,
        ...(query.types && query.types.length > 0 ? { types: query.types } : {}),
      },
    });
  } catch (error) {
    throw formatStudioRagOperationError(error, ragIndex.config);
  } finally {
    await ragIndex.dispose();
  }

  return {
    question: query.question,
    k: query.k,
    results: results.map(serializeRagResult),
    usage: usage.toDto(),
  };
}

async function createCurrentStudioRagIndex(
  state: StudioState,
  action: string,
  usage?: StudioRequestUsageCollector,
): Promise<{
  config: StudioRagEmbedderConfig;
  status: { schemaId: string; chunksTotal: number };
  retriever: ReturnType<typeof createRetriever>;
  dispose: () => Promise<void>;
}> {
  const config = resolveStudioRagEmbedderConfig();
  if (!config.configured) {
    throw new StudioHttpError(400, studioRagAiSdkKeyMissingMessage());
  }
  const status = (await getRagStatus(state)) as {
    hasIndex?: boolean;
    stale?: boolean;
    schemaId?: string;
    chunksTotal?: number;
  };
  if (!status.hasIndex) {
    throw new StudioHttpError(400, `Build the RAG index before ${action}.`);
  }
  if (status.stale) {
    throw new StudioHttpError(400, `Reindex before ${action}. The current index is stale or uses a different embedder.`);
  }
  if (!status.schemaId || typeof status.chunksTotal !== "number") {
    throw new StudioHttpError(500, "Studio RAG status is missing schema metadata.");
  }
  const store = await openStudioRagStore(state, config.dimensions);
  return {
    config,
    status: {
      schemaId: status.schemaId,
      chunksTotal: status.chunksTotal,
    },
    retriever: createRetriever({
      embedder: await createStudioRagEmbedder(config, usage),
      store: store.store,
    }),
    dispose: async () => {
      await store.dispose();
    },
  };
}

function resolveStudioRagStoreConfig(state: StudioState):
  | { kind: "memory" }
  | { kind: "file"; basePath: string }
  | { kind: "pgvector"; connectionString?: string; table?: string; indexStrategy?: string } {
  const rt = getAskDbRuntimeConfig();
  const kind = rt.structured.rag.store;
  if (kind === "memory") return { kind };
  if (kind === "file") {
    const basePath = rt.structured.rag.storeConfig.file?.basePath?.trim();
    return { kind, basePath: basePath ? resolve(basePath) : join(state.schemaDir, "schema") };
  }
  const connectionString = pickFlat(rt.flat, "ASKDB_PGVECTOR_URL");
  return {
    kind,
    connectionString,
    table: rt.structured.rag.storeConfig.pgvector?.table?.trim() || undefined,
    indexStrategy: pickFlat(rt.flat, "ASKDB_PGVECTOR_INDEX_STRATEGY"),
  };
}

async function openStudioRagStore(
  state: StudioState,
  dimensions: number,
): Promise<StudioOpenRagStore> {
  const config = resolveStudioRagStoreConfig(state);
  if (config.kind === "memory") {
    state.ragMemoryStore ??= createMemoryStore();
    return {
      kind: "memory",
      store: state.ragMemoryStore,
      dispose: async () => {},
    };
  }
  if (config.kind === "file") {
    const store = createFileStore({ basePath: config.basePath });
    return {
      kind: "file",
      store,
      basePath: config.basePath,
      dispose: async () => {
        store.flush();
      },
    };
  }
  if (!config.connectionString) {
    throw new StudioHttpError(
      400,
      'Studio pgvector RAG requires `ASKDB_PGVECTOR_URL` via `askdb.config.ts`.',
    );
  }
  const pgvectorFactory = studioPgvectorStoreFactoryForTests ?? createPgvectorStore;
  const store = pgvectorFactory({
    connectionString: config.connectionString,
    table: config.table,
    dimensions,
    ...(config.indexStrategy ? { indexStrategy: config.indexStrategy as "ivfflat" | "hnsw" | "none" } : {}),
  });
  await store.ensureSchema();
  return {
    kind: "pgvector",
    store,
    table: config.table,
    indexStrategy: config.indexStrategy,
    dispose: async () => {
      await store.close();
    },
  };
}

async function countStudioRagStoreChunks(
  store: StudioOpenRagStore,
  schemaId: string,
): Promise<number> {
  if (typeof store.store.count === "function") {
    return store.store.count({ schemaId });
  }
  if (typeof store.store.size === "function") {
    return store.store.size();
  }
  return 0;
}

function pickFlat(flat: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = flat[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function pickEnv(env: AskDbAiEnv, key: string): string | undefined {
  const v = env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function resolveStudioRagEmbedderConfig(): StudioRagEmbedderConfig {
  const rt = getAskDbRuntimeConfig();
  const base = rt.ai.aiEnv;
  const explicitKind = pickEnv(base, "ASKDB_RAG_EMBEDDER");
  const kind = explicitKind?.toLowerCase();
  if (kind === "mock") {
    return {
      kind: "mock",
      embedderId: STUDIO_RAG_MOCK_EMBEDDER_ID,
      dimensions: STUDIO_RAG_MOCK_DIMENSIONS,
      configured: true,
      label: "Mock lexical",
    };
  }
  if (kind !== undefined && kind !== "ai-sdk" && kind !== "openai") {
    throw new StudioHttpError(400, `Unsupported Studio RAG embedder: ${kind}`);
  }

  const env = buildStudioRagEmbeddingEnv(kind, base);
  const aiConfig = resolveAskDbEmbeddingConfig(env, {
    modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL",
    modelDefault: DEFAULT_EMBEDDING_MODEL,
  });
  if (!aiConfig && kind === undefined) {
    return {
      kind: "mock",
      embedderId: STUDIO_RAG_MOCK_EMBEDDER_ID,
      dimensions: STUDIO_RAG_MOCK_DIMENSIONS,
      configured: true,
      label: "Mock lexical",
    };
  }

  const provider = aiConfig?.provider ?? fallbackStudioRagProvider(kind, base);
  const model = aiConfig?.model ?? DEFAULT_EMBEDDING_MODEL;
  const dimensionOverride = readPositiveIntegerEnv(pickEnv(base, "ASKDB_RAG_EMBEDDER_DIMENSIONS"));
  const dimensions = dimensionOverride ?? defaultEmbeddingDimensions(model);
  return {
    kind: "ai-sdk",
    provider,
    embedderId: `ai-sdk:${provider}:${model}:${dimensions}`,
    dimensions,
    configured: Boolean(aiConfig),
    label: `AI SDK (${provider})`,
    model,
    baseUrl: aiConfig?.baseURL,
    aiConfig,
    requestDimensions: dimensionOverride,
  };
}

function buildStudioRagEmbeddingEnv(kind: string | undefined, base: AskDbAiEnv): AskDbAiEnv {
  const apiKeyOverride = pickEnv(base, "ASKDB_RAG_EMBEDDER_API_KEY");
  const baseUrlOverride = pickEnv(base, "ASKDB_RAG_EMBEDDER_BASE_URL");
  return {
    ...base,
    ...(kind === "openai" ? { ASKDB_AI_PROVIDER: "openai" } : {}),
    ...(apiKeyOverride ? { ASKDB_AI_API_KEY: apiKeyOverride } : {}),
    ...(baseUrlOverride ? { ASKDB_AI_BASE_URL: baseUrlOverride } : {}),
  };
}

function fallbackStudioRagProvider(kind: string | undefined, base: AskDbAiEnv): AskDbAiProvider {
  if (kind === "openai") return "openai";
  const raw = (pickEnv(base, "ASKDB_AI_PROVIDER") ?? "").toLowerCase();
  return raw === "azure" || raw === "azure-openai" || raw === "foundry"
    ? "azure"
    : "openai";
}

function studioRagAiSdkKeyMissingMessage(): string {
  return (
    "Studio RAG AI SDK embeddings require a configured AI provider key. " +
    "Set ASKDB_AI_API_KEY or the provider-native key, or set ASKDB_RAG_EMBEDDER=mock for the local lexical embedder."
  );
}

async function createStudioRagEmbedder(
  config: StudioRagEmbedderConfig,
  usage?: StudioRequestUsageCollector,
): Promise<Embedder> {
  if (config.kind === "mock") return createStudioMockEmbedder(config.dimensions);
  if (!config.aiConfig) {
    throw new StudioHttpError(400, studioRagAiSdkKeyMissingMessage());
  }
  const model = await createAskDbEmbeddingModel(config.aiConfig, {
    dimensions: config.requestDimensions,
  });
  return createAiSdkEmbedder({
    model,
    maxRetries: 0,
    onUsage: (reported) => {
      usage?.add("embedding", {
        totalTokens: reported.totalTokens ?? reported.tokens ?? reported.promptTokens,
        promptTokens: reported.promptTokens ?? reported.tokens,
        embeddingTokens: reported.tokens ?? reported.totalTokens ?? reported.promptTokens,
      });
    },
  });
}

function formatStudioRagOperationError(
  error: unknown,
  config: StudioRagEmbedderConfig,
): StudioHttpError {
  if (error instanceof StudioHttpError) return error;
  if (config.kind === "mock") {
    return new StudioHttpError(500, error instanceof Error ? error.message : String(error));
  }

  const apiError = findApiCallError(error);
  if (!apiError) {
    return new StudioHttpError(500, error instanceof Error ? error.message : String(error));
  }
  const parts = [
    `Studio RAG embedding request failed for provider ${config.provider}, model ${config.model}.`,
  ];
  if (config.baseUrl) parts.push(`Base URL: ${config.baseUrl}.`);
  if (apiError?.statusCode) parts.push(`Status: ${apiError.statusCode}.`);
  const responseBody = truncateForMessage(apiError?.responseBody);
  if (responseBody) parts.push(`Response: ${responseBody}`);
  if (!responseBody && error instanceof Error) parts.push(`Error: ${error.message}`);
  return new StudioHttpError(502, parts.join(" "));
}

function findApiCallError(error: unknown): {
  statusCode?: number;
  responseBody?: string;
} | undefined {
  const queue: unknown[] = [error];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (!isRecord(current)) continue;
    if (
      typeof current.statusCode === "number" ||
      typeof current.responseBody === "string"
    ) {
      return {
        statusCode: typeof current.statusCode === "number" ? current.statusCode : undefined,
        responseBody: typeof current.responseBody === "string" ? current.responseBody : undefined,
      };
    }
    if (Array.isArray(current.errors)) queue.push(...current.errors);
    if ("cause" in current) queue.push(current.cause);
  }
  return undefined;
}

function truncateForMessage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

function clearIncompatibleRagStore(state: StudioState, config: StudioRagEmbedderConfig): void {
  const store = resolveStudioRagStoreConfig(state);
  if (store.kind !== "file") return;
  const embeddingsJsonPath = `${store.basePath}.embeddings.json`;
  const embeddings = readOptionalJson(embeddingsJsonPath) as { dimensions?: number } | undefined;
  if (embeddings?.dimensions === undefined || embeddings.dimensions === config.dimensions) return;
  for (const path of [
    `${store.basePath}.embeddings.json`,
    `${store.basePath}.embeddings.bin`,
    join(state.schemaDir, "schema.lock.json"),
  ]) {
    rmSync(path, { force: true });
  }
}

function defaultEmbeddingDimensions(model: string): number {
  if (model === "text-embedding-3-large") return 3072;
  return 1536;
}

function readPositiveIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new StudioHttpError(400, `Invalid Studio RAG embedding dimensions: ${value}`);
  }
  return parsed;
}

function serializeRagResult(result: QueryResult): StudioRagChunkDto {
  return {
    id: result.id,
    score: Number(result.score.toFixed(6)),
    type: result.payload.type,
    refs: result.payload.refs,
    sensitive: result.payload.sensitive,
    text: result.payload.text,
  };
}

function createStudioMockEmbedder(dim: number): Embedder {
  return async (texts: string[]) => {
    return texts.map((text) => {
      const vector = new Array<number>(dim).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
      for (const token of tokens) {
        vector[stableTokenHash(token) % dim] += 1;
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / norm);
    });
  };
}

function stableTokenHash(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readOptionalJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function parseConceptsBody(body: unknown): V2Concept[] {
  if (!isRecord(body) || !Array.isArray(body.concepts)) {
    throw new StudioHttpError(400, "`concepts` array is required.");
  }
  for (const concept of body.concepts) {
    if (!isRecord(concept) || typeof concept.id !== "string" || typeof concept.label !== "string") {
      throw new StudioHttpError(400, "Each concept requires a string `id` and `label`.");
    }
  }
  return body.concepts as V2Concept[];
}

function parseTableDraftBody(body: unknown): TableDraft {
  if (!isRecord(body) || !isRecord(body.draft)) {
    throw new StudioHttpError(400, "`draft` is required.");
  }
  const draft = body.draft;
  if (typeof draft.description !== "string") {
    throw new StudioHttpError(400, "`draft.description` is required.");
  }
  if (!isRecord(draft.columns)) {
    throw new StudioHttpError(400, "`draft.columns` is required.");
  }
  return draft as TableDraft;
}

function parseSuggestSource(body: unknown): SuggestSource {
  if (!isRecord(body) || !isRecord(body.source)) {
    throw new StudioHttpError(400, "`source` is required.");
  }
  const source = body.source;
  if (source.scope === "table") {
    if (typeof source.tableId !== "string" || typeof source.field !== "string") {
      throw new StudioHttpError(400, "`source.tableId` and `source.field` are required.");
    }
    if (!["description", "aliases", "primaryEntity", "commonQueryLanguage"].includes(source.field)) {
      throw new StudioHttpError(400, "Unsupported table suggestion field.");
    }
    return source as SuggestSource;
  }
  if (source.scope === "column") {
    if (
      typeof source.tableId !== "string" ||
      typeof source.columnId !== "string" ||
      typeof source.field !== "string"
    ) {
      throw new StudioHttpError(
        400,
        "`source.tableId`, `source.columnId`, and `source.field` are required.",
      );
    }
    if (!["description", "aliases"].includes(source.field)) {
      throw new StudioHttpError(400, "Unsupported column suggestion field.");
    }
    return source as SuggestSource;
  }
  throw new StudioHttpError(400, "Unsupported suggestion source.");
}

function parseAskBody(body: unknown): {
  question: string;
  useRag: boolean;
  tenantScope?: TenantScope;
  tenantSqlMode?: TenantSqlOutputMode;
} {
  if (!isRecord(body) || typeof body.question !== "string" || body.question.trim() === "") {
    throw new StudioHttpError(400, "`question` is required.");
  }
  const mode = typeof body.mode === "string" ? body.mode : "full";
  if (mode !== "full" && mode !== "rag") {
    throw new StudioHttpError(400, "`mode` must be `full` or `rag`.");
  }
  let tenantScope: TenantScope | undefined;
  if (body.tenantScope !== undefined && body.tenantScope !== null) {
    const parsed = tenantScopeSchema.safeParse(body.tenantScope);
    if (!parsed.success) {
      throw new StudioHttpError(400, `Invalid tenantScope: ${parsed.error.message}`);
    }
    tenantScope = parsed.data;
  }
  let tenantSqlMode: TenantSqlOutputMode | undefined;
  if (typeof body.tenantSqlMode === "string") {
    if (body.tenantSqlMode !== "sql-only" && body.tenantSqlMode !== "sql-params") {
      throw new StudioHttpError(400, "`tenantSqlMode` must be `sql-only` or `sql-params`.");
    }
    tenantSqlMode = body.tenantSqlMode;
  }
  return {
    question: body.question.trim(),
    useRag: mode === "rag",
    tenantScope,
    tenantSqlMode,
  };
}

function parseRagQuery(body: unknown): { question: string; k: number; types?: ChunkType[] } {
  if (!isRecord(body) || typeof body.question !== "string" || body.question.trim() === "") {
    throw new StudioHttpError(400, "`question` is required.");
  }
  const k = typeof body.k === "number" && Number.isFinite(body.k) ? Math.trunc(body.k) : 8;
  if (k < 1 || k > 25) {
    throw new StudioHttpError(400, "`k` must be between 1 and 25.");
  }
  const allowed = new Set<ChunkType>(["table", "column", "cql", "question", "concept", "relationship"]);
  let types: ChunkType[] | undefined;
  if (Array.isArray(body.types)) {
    types = body.types.filter((type): type is ChunkType => typeof type === "string" && allowed.has(type as ChunkType));
  }
  return {
    question: body.question.trim(),
    k,
    ...(types && types.length > 0 ? { types } : {}),
  };
}

function createTrackedGenerateText(
  usage: StudioRequestUsageCollector,
): NonNullable<AskGenerateDeps["generateText"]> {
  const generateText = defaultGenerateText as unknown as (
    ...args: unknown[]
  ) => Promise<{ usage?: unknown }>;
  return (async (...args: unknown[]) => {
    const result = await generateText(...args);
    usage.add("generation", normalizeGenerationUsage((result as { usage?: unknown }).usage));
    return result;
  }) as NonNullable<AskGenerateDeps["generateText"]>;
}

function createRequestUsageCollector() {
  const requests: StudioRequestUsageDto["requests"] = [];
  return {
    add(kind: "generation" | "embedding", usage: StudioTokenUsageInput | undefined): void {
      if (!usage) return;
      const derivedTotal =
        usage.totalTokens ??
        sumDefined([usage.promptTokens, usage.completionTokens]) ??
        usage.embeddingTokens;
      const request = {
        kind,
        totalTokens: derivedTotal ?? null,
        promptTokens: usage.promptTokens ?? null,
        completionTokens: usage.completionTokens ?? null,
        embeddingTokens: usage.embeddingTokens ?? null,
      };
      if (
        request.totalTokens === null &&
        request.promptTokens === null &&
        request.completionTokens === null &&
        request.embeddingTokens === null
      ) {
        return;
      }
      requests.push(request);
    },
    toDto(): StudioRequestUsageDto | null {
      if (requests.length === 0) return null;
      return {
        totalTokens: sumNullable(requests.map((request) => request.totalTokens)),
        promptTokens: sumNullable(requests.map((request) => request.promptTokens)),
        completionTokens: sumNullable(requests.map((request) => request.completionTokens)),
        embeddingTokens: sumNullable(requests.map((request) => request.embeddingTokens)),
        requests,
      };
    },
  };
}

function normalizeGenerationUsage(value: unknown): StudioTokenUsageInput | undefined {
  if (!isRecord(value)) return undefined;
  const promptTokens = readFiniteNumber(value.promptTokens);
  const completionTokens = readFiniteNumber(value.completionTokens);
  const totalTokens = readFiniteNumber(value.totalTokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value === undefined) continue;
    total += value;
    seen = true;
  }
  return seen ? total : undefined;
}

function sumNullable(values: Array<number | null>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StudioHttpError(400, "Request body must be valid JSON.");
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  writeText(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function writeText(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function serveClientFile(res: ServerResponse, relativePath: string): void {
  const filePath = resolve(CLIENT_DIR, relativePath);
  const fileRelativeToClientDir = relative(CLIENT_DIR, filePath);
  if (fileRelativeToClientDir.startsWith("..") || fileRelativeToClientDir === "") {
    return writeJson(res, 404, { error: { message: "Not found" } });
  }
  if (!existsSync(filePath)) {
    return writeJson(res, 500, {
      error: {
        message:
          "Studio client assets are missing. Run `pnpm --filter @askdb/studio build` before starting Studio.",
      },
    });
  }
  res.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": "no-store",
  });
  res.end(readFileSync(filePath));
}

function contentTypeFor(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class StudioHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StudioHttpError";
  }
}
