import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { ask, loadSchema, suggestEnrichment, type AskGenerateDeps } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
import {
  buildSchemaIndex,
  chunkContentHash,
  chunkSchema,
  createRetriever,
  loadChunkerSourcesFromDir,
  type ChunkType,
  type Embedder,
  type QueryResult,
} from "@askdb/rag";
import { createFileStore } from "@askdb/rag/stores/file";
import {
  buildDefaultTableBody,
  buildFrontmatter,
  buildSuggestionContext,
  buildSuggestionTarget,
  buildTableDraft,
  loadWorkspace,
  replaceH2Section,
  replaceTableDescription,
  saveTable,
  type SuggestSource,
  type TableDraft,
  type Workspace,
} from "@askdb/tui";
import { APP_JS, INDEX_HTML, STYLES_CSS } from "./static.js";

export type StudioOptions = {
  schema: string;
  host?: string;
  port?: number;
};

export type StudioServer = ReturnType<typeof createServer>;

type StudioState = {
  schemaDir: string;
  workspace: Workspace;
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
      kind: "openai";
      embedderId: string;
      dimensions: number;
      configured: boolean;
      label: string;
      model: string;
      baseUrl: string;
      apiKey?: string;
      requestDimensions?: number;
    };

const STUDIO_RAG_MOCK_DIMENSIONS = 64;
const STUDIO_RAG_MOCK_EMBEDDER_ID = `studio:mock-lexical-${STUDIO_RAG_MOCK_DIMENSIONS}`;
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

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
        return writeText(res, 200, "text/html; charset=utf-8", INDEX_HTML);
      }
      if (req.method === "GET" && url.pathname === "/assets/styles.css") {
        return writeText(res, 200, "text/css; charset=utf-8", STYLES_CSS);
      }
      if (req.method === "GET" && url.pathname === "/assets/app.js") {
        return writeText(res, 200, "text/javascript; charset=utf-8", APP_JS);
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
      if (req.method === "POST" && url.pathname === "/api/suggest") {
        const body = await readJson(req);
        const source = parseSuggestSource(body);
        const candidates = await suggestForSource(state.workspace, source);
        return writeJson(res, 200, { candidates });
      }
      if (req.method === "GET" && url.pathname === "/api/rag/status") {
        return writeJson(res, 200, getRagStatus(state.schemaDir));
      }
      if (req.method === "POST" && url.pathname === "/api/rag/index") {
        const result = await indexRag(state.schemaDir);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/rag/query") {
        const body = await readJson(req);
        const query = parseRagQuery(body);
        const result = await queryRag(state.schemaDir, query);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJson(req);
        const question = parseQuestion(body);
        const result = await askSampleQuestion(state.schemaDir, question);
        return writeJson(res, 200, result);
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

export function serializeWorkspace(workspace: Workspace): unknown {
  return {
    schemaDir: workspace.schemaDir,
    schemaId: workspace.physical.schemaId,
    warnings: workspace.warnings,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model:
      process.env.ASKDB_STUDIO_MODEL ??
      process.env.ASKDB_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-4o-mini",
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
  };
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

async function suggestForSource(workspace: Workspace, source: SuggestSource): Promise<Array<{ text: string }>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new StudioHttpError(400, "OPENAI_API_KEY is required for AI enrichment suggestions.");
  }
  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  const modelId =
    process.env.ASKDB_STUDIO_MODEL ??
    process.env.ASKDB_TUI_MODEL ??
    process.env.ASKDB_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-4o-mini";
  const candidates = await suggestEnrichment(
    buildSuggestionTarget(workspace, source),
    buildSuggestionContext(workspace, source.tableId),
    openai(modelId),
  );
  return candidates.map((candidate) => ({ text: candidate.text }));
}

async function askSampleQuestion(schemaDir: string, question: string): Promise<unknown> {
  const mockSql = process.env.ASKDB_MOCK_SQL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!mockSql && !apiKey) {
    throw new StudioHttpError(
      400,
      "OPENAI_API_KEY is required for sample NL-to-SQL generation. Set ASKDB_MOCK_SQL to bypass the live model.",
    );
  }

  const schema = loadSchema(schemaDir);
  type AskModel = Parameters<typeof ask>[0]["model"];
  const model: AskModel = mockSql
    ? (undefined as unknown as AskModel)
    : (() => {
        const openai = createOpenAI({
          apiKey: apiKey!,
          baseURL: process.env.OPENAI_BASE_URL,
        });
        const modelId =
          process.env.ASKDB_STUDIO_MODEL ??
          process.env.ASKDB_MODEL ??
          process.env.OPENAI_MODEL ??
          "gpt-4o-mini";
        return openai(modelId);
      })();

  const result = await ask({
    question,
    schema,
    model,
    dialect: postgresDialect,
    explain: true,
    deps:
      mockSql !== undefined
        ? {
            generateText: (async () => ({ text: mockSql } as any)) as NonNullable<
              AskGenerateDeps["generateText"]
            >,
          }
        : undefined,
  });

  return {
    sql: result.sql,
    explain: result.explain ?? null,
    warnings: schema.warnings,
  };
}

function getRagStatus(schemaDir: string): unknown {
  const config = resolveStudioRagEmbedderConfig();
  const sources = loadChunkerSourcesFromDir(schemaDir);
  const chunkResult = chunkSchema(sources);
  const lockPath = join(schemaDir, "schema.lock.json");
  const embeddingsJsonPath = join(schemaDir, "schema.embeddings.json");
  const embeddingsBinPath = join(schemaDir, "schema.embeddings.bin");
  const lock = readOptionalJson(lockPath) as
    | { embedderId?: string; updatedAt?: string; hashes?: Record<string, string> }
    | undefined;
  const embeddings = readOptionalJson(embeddingsJsonPath) as
    | { records?: unknown[]; dimensions?: number }
    | undefined;

  const currentHashes = Object.fromEntries(
    chunkResult.chunks.map((chunk) => [chunk.id, chunkContentHash(chunk.text)]),
  );
  const lockHashes = lock?.hashes ?? {};
  const hashIds = Object.keys(currentHashes);
  const stale =
    !lock ||
    !existsSync(embeddingsJsonPath) ||
    !existsSync(embeddingsBinPath) ||
    lock.embedderId !== config.embedderId ||
    embeddings?.dimensions !== config.dimensions ||
    Object.keys(lockHashes).length !== hashIds.length ||
    hashIds.some((id) => lockHashes[id] !== currentHashes[id]);

  return {
    schemaId: sources.schema.schemaId,
    embedder: {
      kind: config.kind,
      label: config.label,
      configured: config.configured,
      expectedId: config.embedderId,
      indexedId: lock?.embedderId ?? null,
      model: config.kind === "openai" ? config.model : null,
      baseUrl: config.kind === "openai" ? config.baseUrl : null,
    },
    embedderId: lock?.embedderId ?? config.embedderId,
    expectedEmbedderId: config.embedderId,
    hasIndex: Boolean(lock && existsSync(embeddingsJsonPath) && existsSync(embeddingsBinPath)),
    stale,
    updatedAt: lock?.updatedAt ?? null,
    chunksTotal: chunkResult.chunks.length,
    chunksIndexed: Array.isArray(embeddings?.records) ? embeddings.records.length : 0,
    dimensions: typeof embeddings?.dimensions === "number" ? embeddings.dimensions : config.dimensions,
    expectedDimensions: config.dimensions,
    sensitiveExcluded: chunkResult.stats.sensitiveExcluded,
    sensitiveIncluded: chunkResult.stats.sensitiveIncluded,
    files: {
      lock: existsSync(lockPath),
      embeddingsJson: existsSync(embeddingsJsonPath),
      embeddingsBin: existsSync(embeddingsBinPath),
    },
  };
}

async function indexRag(schemaDir: string): Promise<unknown> {
  const config = resolveStudioRagEmbedderConfig();
  if (!config.configured) {
    throw new StudioHttpError(400, "OPENAI_API_KEY is required when Studio RAG uses the OpenAI embedder.");
  }
  clearIncompatibleRagStore(schemaDir, config);
  const sources = loadChunkerSourcesFromDir(schemaDir);
  const store = createFileStore({ basePath: join(schemaDir, "schema") });
  const result = await buildSchemaIndex({
    schema: sources,
    embedder: createStudioRagEmbedder(config),
    store,
    embedderId: config.embedderId,
    lockFilePath: join(schemaDir, "schema.lock.json"),
  });
  store.flush();
  return {
    status: getRagStatus(schemaDir),
    stats: result.stats,
  };
}

async function queryRag(
  schemaDir: string,
  query: { question: string; k: number; types?: ChunkType[] },
): Promise<unknown> {
  const config = resolveStudioRagEmbedderConfig();
  if (!config.configured) {
    throw new StudioHttpError(400, "OPENAI_API_KEY is required when Studio RAG uses the OpenAI embedder.");
  }
  const status = getRagStatus(schemaDir) as { hasIndex?: boolean; stale?: boolean; schemaId?: string };
  if (!status.hasIndex) {
    throw new StudioHttpError(400, "Build the RAG index before querying chunks.");
  }
  if (status.stale) {
    throw new StudioHttpError(400, "Reindex before querying chunks. The current index is stale or uses a different embedder.");
  }
  const store = createFileStore({ basePath: join(schemaDir, "schema") });
  const retriever = createRetriever({
    embedder: createStudioRagEmbedder(config),
    store,
  });
  const results = await retriever({
    question: query.question,
    k: query.k,
    filter: {
      schemaId: status.schemaId,
      ...(query.types && query.types.length > 0 ? { types: query.types } : {}),
    },
  });

  return {
    question: query.question,
    k: query.k,
    results: results.map(serializeRagResult),
  };
}

function resolveStudioRagEmbedderConfig(): StudioRagEmbedderConfig {
  const kind = (
    process.env.ASKDB_RAG_EMBEDDER ??
    process.env.ASKDB_STUDIO_RAG_EMBEDDER ??
    "mock"
  ).toLowerCase();
  if (kind === "mock") {
    return {
      kind: "mock",
      embedderId: STUDIO_RAG_MOCK_EMBEDDER_ID,
      dimensions: STUDIO_RAG_MOCK_DIMENSIONS,
      configured: true,
      label: "Mock lexical",
    };
  }
  if (kind !== "openai") {
    throw new StudioHttpError(400, `Unsupported Studio RAG embedder: ${kind}`);
  }

  const model =
    process.env.ASKDB_RAG_EMBEDDER_MODEL ??
    process.env.ASKDB_STUDIO_RAG_EMBEDDER_MODEL ??
    process.env.ASKDB_EMBEDDING_MODEL ??
    DEFAULT_OPENAI_EMBEDDING_MODEL;
  const dimensionOverride = readPositiveIntegerEnv(
    process.env.ASKDB_RAG_EMBEDDER_DIMENSIONS ??
      process.env.ASKDB_STUDIO_RAG_EMBEDDER_DIMENSIONS,
  );
  const dimensions = dimensionOverride ?? defaultOpenAiEmbeddingDimensions(model);
  return {
    kind: "openai",
    embedderId: `openai:${model}:${dimensions}`,
    dimensions,
    configured: Boolean(process.env.OPENAI_API_KEY),
    label: "OpenAI",
    model,
    baseUrl: process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    requestDimensions: dimensionOverride,
  };
}

function createStudioRagEmbedder(config: StudioRagEmbedderConfig): Embedder {
  if (config.kind === "mock") return createStudioMockEmbedder(config.dimensions);
  return createStudioOpenAiEmbedder(config);
}

function createStudioOpenAiEmbedder(config: Extract<StudioRagEmbedderConfig, { kind: "openai" }>): Embedder {
  return async (texts: string[]) => {
    const url = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;
    const body: Record<string, unknown> = {
      input: texts,
      model: config.model,
    };
    if (config.requestDimensions !== undefined) {
      body.dimensions = config.requestDimensions;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI embeddings failed: ${response.status} ${text}`);
    }
    const json = (await response.json()) as { data?: { embedding: number[] }[] };
    const embeddings = json.data?.map((item) => item.embedding) ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(`OpenAI embeddings returned ${embeddings.length} vectors for ${texts.length} inputs.`);
    }
    return embeddings;
  };
}

function clearIncompatibleRagStore(schemaDir: string, config: StudioRagEmbedderConfig): void {
  const embeddingsJsonPath = join(schemaDir, "schema.embeddings.json");
  const embeddings = readOptionalJson(embeddingsJsonPath) as { dimensions?: number } | undefined;
  if (embeddings?.dimensions === undefined || embeddings.dimensions === config.dimensions) return;
  for (const path of [
    join(schemaDir, "schema.embeddings.json"),
    join(schemaDir, "schema.embeddings.bin"),
    join(schemaDir, "schema.lock.json"),
  ]) {
    rmSync(path, { force: true });
  }
}

function defaultOpenAiEmbeddingDimensions(model: string): number {
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

function serializeRagResult(result: QueryResult): unknown {
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

function parseQuestion(body: unknown): string {
  if (!isRecord(body) || typeof body.question !== "string" || body.question.trim() === "") {
    throw new StudioHttpError(400, "`question` is required.");
  }
  return body.question.trim();
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
