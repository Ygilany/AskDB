import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, relative, join, resolve, dirname, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateText as defaultGenerateText } from "ai";
import {
  ASKDB_AI_PROVIDERS,
  bootstrapAskDbEnv,
  getAskDbRuntimeConfig,
} from "@askdb/config";
import {
  findNearestPackageJsonDir,
  lockfilePackageManager,
  packageManagerAddArgs,
  packageManagerSpawnSpec,
} from "@askdb/config/scaffold";
import {
  createAiRegistry,
  resolveReasoningEffort,
  type AiConfig,
  type AiProvider,
} from "@askdb/ai";
import {
  ask,
  DEFAULT_TENANT_SQL_MODE,
  formatSchemaV2ForNlToSql,
  formatSensitiveReference,
  isBuiltInDialectId,
  loadSchema,
  saveSchemaFile,
  schemaHasSensitiveIdentifiers,
  SensitiveEnrichmentTargetError,
  SqlValidationError,
  validateSensitiveReferences,
  suggestEnrichment,
  tenantScopeSchema,
  type AskDialectInput,
  type AskGenerateDeps,
  type DialectSpec,
  type NormalizedSchemaV2,
  type TenantPolicyFrontmatter,
  type TenantScope,
  type TenantSqlOutputMode,
  type V2Concept,
  SchemaParseError,
  tenantPolicyFrontmatterSchema,
} from "@askdb/core";
import {
  buildSchemaIndex,
  chunkContentHash,
  chunkSchema,
  aiSdkEmbedderId,
  createAiSdkEmbedder,
  createFileStore,
  createMemoryStore,
  createPgvectorStore,
  createRetriever,
  detectEmbeddingDimensions,
  loadChunkerSourcesFromDir,
  PgvectorDimensionMismatchError,
  type ChunkType,
  type Embedder,
  type QueryResult,
  type SchemaLockFile,
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
  saveTenantPolicy,
  type SuggestSource,
  type TableDraft,
  type Workspace,
} from "@askdb/enrich";
import type {
  AskResponse,
  ExecuteInstallDriverRequest,
  ExecuteInstallDriverResponse,
  ExecuteResponse,
  ExecuteStatusResponse,
  IntrospectionPlanDto,
  IntrospectRunResponse,
  PlaygroundHistoryEntry,
  RagIndexResponse,
  RagQueryResponse,
  SetupConfigResponse,
  SetupReason,
  SetupStatusDto,
  StudioRequestUsageDto,
  StudioRagChunkDto,
  StudioRagStatusDto,
  StudioWorkspaceDto,
  SuggestResponse,
  SuggestTenantPolicyResponse,
} from "./shared/api.js";
import {
  EXECUTE_DRIVER_REGISTRY,
  executeDialectFor,
  isDriverInstalled,
  isStudioExecuteProvider,
  validateExecuteSql,
} from "./execute-registry.js";
import type { StudioExecuteProvider } from "./execute-registry.js";
import { EmptyIntrospectionError } from "@askdb/introspect";
import { resolveStudioIntrospectionPlan, runStudioIntrospection } from "./introspection.js";
import { probeSetupState, writeSetupConfig, SetupError, type SetupConfigInput } from "./setup.js";
import {
  checkApiRequest,
  checkHost,
  createStudioSessionToken,
  injectSessionToken,
} from "./request-guard.js";

// Batteries-included surface: every built-in provider is registered, and each
// loads its @ai-sdk/* package only when first used, so env config alone
// selects the provider.
const ai = createAiRegistry();

const DEFAULT_CLIENT_DIR = fileURLToPath(new URL("./client/", import.meta.url));
let clientDirForTests: string | undefined;

/** @internal Tests only — serve client assets from another directory. */
export function setStudioClientDirForTests(dir: string | undefined): void {
  clientDirForTests = dir;
}

function clientDir(): string {
  return clientDirForTests ?? DEFAULT_CLIENT_DIR;
}

export type StudioOptions = {
  schema: string;
  host?: string;
  port?: number;
  /**
   * Start in setup mode instead of failing: `"no-config"` when no
   * `askdb.config.*` was found, `"no-artifact"` when the config exists but the
   * schema artifact hasn't been introspected yet. The browser wizard walks the
   * user through the missing steps and flips the server to ready.
   */
  setupReason?: SetupReason | null;
};

export type StudioServer = Server & {
  /**
   * Per-launch session token. Every `/api/*` request must send it as the
   * `x-askdb-studio-token` header; the browser app reads it from a `<meta>`
   * tag injected into the served `index.html`.
   */
  readonly sessionToken: string;
};

type StudioState = {
  schemaDir: string;
  workspace: Workspace | null;
  setupReason: SetupReason | null;
  ragMemoryStore?: ReturnType<typeof createMemoryStore>;
  /**
   * What the last build into `ragMemoryStore` recorded. The indexer writes no
   * `schema.lock.json` for an ephemeral store, so Studio keeps the same
   * fields in memory for the status check.
   */
  ragMemoryIndex?: StudioRagIndexRecord;
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
      /** The adapter's canonical name (`foundry` resolves to `azure`), as the embedder id uses it. */
      provider: AiProvider;
      /** The provider as `ai.embedding` resolves it in the config (`foundry` stays `foundry`), for messages. */
      configuredProvider: string;
      /** Connection name within `ai.providerConfig.<configuredProvider>`. */
      connection: string;
      embedderId: string;
      /** The requested width (`ai.embedding.dimensions`); undefined leaves it to the model. */
      dimensions: number | undefined;
      configured: boolean;
      label: string;
      model: string;
      baseUrl?: string;
      aiConfig?: AiConfig;
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
    tableDimensions?: () => Promise<number | undefined>;
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
let studioPgvectorStoreFactoryForTests: typeof createPgvectorStore | undefined;

export function setStudioPgvectorStoreFactoryForTests(
  factory: typeof createPgvectorStore | undefined,
): void {
  studioPgvectorStoreFactoryForTests = factory;
}

export function createStudioServer(options: StudioOptions): StudioServer {
  const schemaDir = resolve(options.schema);
  const setupReason = options.setupReason ?? null;
  if (!setupReason && !existsSync(schemaDir)) {
    throw new Error(`schema directory not found: ${schemaDir}`);
  }

  const state: StudioState = {
    schemaDir,
    workspace: setupReason ? null : loadWorkspace(schemaDir),
    setupReason,
  };

  const sessionToken = createStudioSessionToken();

  const server = createServer(async (req, res) => {
    try {
      // Host allowlist on every request (static assets included) — defeats DNS rebinding.
      const hostFailure = checkHost(req, options.host);
      if (hostFailure) {
        return writeJson(res, hostFailure.status, { error: { message: hostFailure.message } });
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      // Origin, session token, and content-type checks on every API call.
      if (url.pathname.startsWith("/api/")) {
        const apiFailure = checkApiRequest(req, sessionToken);
        if (apiFailure) {
          return writeJson(res, apiFailure.status, { error: { message: apiFailure.message } });
        }
      }
      if (req.method === "GET" && url.pathname === "/") {
        return serveIndexHtml(res, sessionToken);
      }
      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        return serveClientFile(res, decodeURIComponent(url.pathname.slice(1)));
      }
      if (req.method === "GET" && url.pathname === "/api/setup/status") {
        return writeJson(res, 200, buildSetupStatus(state));
      }
      if (req.method === "POST" && url.pathname === "/api/setup/config") {
        if (!isLoopbackRequest(req)) {
          return writeJson(res, 403, { error: { message: "Setup is only available from loopback clients." } });
        }
        const body = await readJson(req);
        const result = handleSetupConfig(state, body);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/setup/introspect") {
        if (!isLoopbackRequest(req)) {
          return writeJson(res, 403, { error: { message: "Setup is only available from loopback clients." } });
        }
        const result = await handleSetupIntrospect(state);
        return writeJson(res, 200, result);
      }
      // Everything below needs a loaded workspace — route setup-mode clients to the wizard.
      if (state.setupReason && url.pathname.startsWith("/api/")) {
        return writeJson(res, 409, {
          error: { message: "Studio needs setup. Open Studio in the browser to finish the guided setup." },
          setup: buildSetupStatus(state),
        });
      }
      if (req.method === "GET" && url.pathname === "/api/workspace") {
        return writeJson(res, 200, serializeWorkspace(requireWorkspace(state)));
      }
      if (req.method === "GET" && url.pathname === "/api/introspect/status") {
        requireWorkspace(state);
        return writeJson(res, 200, await buildIntrospectionPlanDto());
      }
      if (req.method === "POST" && url.pathname === "/api/introspect") {
        if (!isLoopbackRequest(req)) {
          return writeJson(res, 403, { error: { message: "Resync is only available from loopback clients." } });
        }
        const result = await handleResync(state);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/tables/")) {
        const tableId = decodeURIComponent(url.pathname.slice("/api/tables/".length));
        const body = await readJson(req);
        const draft = parseTableDraftBody(body);
        saveDraft(state, tableId, draft);
        return writeJson(res, 200, serializeWorkspace(requireWorkspace(state)));
      }
      if (req.method === "POST" && url.pathname === "/api/concepts") {
        const body = await readJson(req);
        const concepts = parseConceptsBody(body);
        saveConceptsDraft(state, concepts);
        return writeJson(res, 200, serializeWorkspace(requireWorkspace(state)));
      }
      if (req.method === "POST" && url.pathname === "/api/tenant-policy") {
        const body = await readJson(req);
        const { frontmatter, bodyText } = parseTenantPolicyBody(body);
        saveTenantPolicyDraft(state, frontmatter, bodyText);
        return writeJson(res, 200, serializeWorkspace(requireWorkspace(state)));
      }
      if (req.method === "POST" && url.pathname === "/api/suggest-tenant-policy") {
        const draft = await suggestTenantPolicyDraft(state);
        return writeJson(res, 200, draft);
      }
      if (req.method === "POST" && url.pathname === "/api/suggest") {
        const body = await readJson(req);
        const source = parseSuggestSource(body);
        const candidates = await suggestForSource(state, source);
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
      if (req.method === "GET" && url.pathname === "/api/history") {
        return writeJson(res, 200, readPlaygroundHistory(state.schemaDir));
      }
      if (req.method === "POST" && url.pathname === "/api/history") {
        const body = await readJson(req);
        const entry = parsePlaygroundHistoryEntry(body);
        appendPlaygroundHistory(state.schemaDir, entry);
        return writeJson(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/history/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/history/".length));
        const result = deletePlaygroundHistoryEntry(state.schemaDir, id);
        return writeJson(res, 200, result);
      }
      if (req.method === "GET" && url.pathname === "/api/execute/status") {
        const result = await getExecuteStatus(state.schemaDir);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/execute/install-driver") {
        if (!isLoopbackRequest(req)) {
          return writeJson(res, 403, { error: { message: "Driver install is only available from loopback clients." } });
        }
        const body = await readJson(req);
        const result = await installExecuteDriver(body, state.schemaDir);
        return writeJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/execute") {
        const body = await readJson(req);
        const result = await executeQuery(body, state.schemaDir);
        return writeJson(res, 200, result);
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveIndexHtml(res, sessionToken);
      }
      writeJson(res, 404, { error: { message: "Not found" } });
    } catch (error) {
      const status =
        error instanceof StudioHttpError || error instanceof SetupError ? error.status : 500;
      writeJson(res, status, {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
  return Object.assign(server, { sessionToken });
}

export function serializeWorkspace(workspace: Workspace): StudioWorkspaceDto {
  const rt = getAskDbRuntimeConfig();
  const aiConfig = (() => {
    try {
      return ai.resolveAiConfig(rt.ai.aiEnv);
    } catch {
      // A misconfigured AI env (e.g. azure without resourceName) shouldn't crash the workspace
      // listing — surface it as "not configured" in the UI and let the user fix .env.
      return undefined;
    }
  })();
  const schema = loadSchema(workspace.schemaDir);
  const schemaProvider =
    "provider" in schema && typeof schema.provider === "string" ? schema.provider : undefined;
  const dialect =
    rt.nlToSql.dialect ??
    (schemaProvider && isBuiltInDialectId(schemaProvider) ? schemaProvider : "postgres");
  return {
    schemaDir: workspace.schemaDir,
    schemaPathRelative: toRelativeSchemaPath(workspace.schemaDir),
    schemaId: workspace.physical.schemaId,
    dialect,
    warnings: workspace.warnings,
    aiConfigured: Boolean(aiConfig),
    model: aiConfig?.model ?? rt.ai.language.model ?? "provider default",
    aiProvider: aiConfig?.provider ?? rt.ai.language.provider,
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
        escalatedByOtherFiles: table.escalatedByOtherFiles ?? [],
      };
    }),
    concepts: workspace.concepts?.frontmatter.concepts ?? [],
    tenantPolicy: schema.tenantPolicy ?? null,
  };
}

function toRelativeSchemaPath(schemaDir: string): string {
  const rel = relative(process.cwd(), schemaDir);
  if (rel === "") return ".";
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) return schemaDir;
  return rel.startsWith(".") ? rel : `./${rel}`;
}

// ---------------------------------------------------------------------------
// Setup wizard + server-side introspection (resync)
// ---------------------------------------------------------------------------

function requireWorkspace(state: StudioState): Workspace {
  if (!state.workspace) {
    throw new StudioHttpError(409, "Studio is in setup mode — finish the guided setup first.");
  }
  return state.workspace;
}

function buildSetupStatus(state: StudioState): SetupStatusDto {
  const projectDir = process.cwd();
  if (!state.setupReason) {
    return {
      needed: false,
      reason: null,
      projectDir,
      configPath: null,
      outputDir: state.schemaDir,
      configLoadError: null,
    };
  }
  const probe = probeSetupState(projectDir);
  return {
    needed: true,
    reason: probe.hasConfig ? "no-artifact" : "no-config",
    projectDir,
    configPath: probe.configPath,
    outputDir: probe.outputDir,
    configLoadError: probe.loadError,
  };
}

function handleSetupConfig(state: StudioState, body: unknown): SetupConfigResponse {
  if (!state.setupReason) {
    throw new StudioHttpError(409, "Studio is already set up — edit askdb.config.ts directly.");
  }
  const input = parseSetupConfigBody(body);
  const result = writeSetupConfig(process.cwd(), input);
  // Config now exists; the artifact usually doesn't yet.
  const probe = probeSetupState(process.cwd());
  if (probe.hasArtifact && probe.outputDir) {
    state.schemaDir = probe.outputDir;
    state.workspace = loadWorkspace(probe.outputDir);
    state.setupReason = null;
  } else {
    state.setupReason = "no-artifact";
  }
  return {
    configPath: result.configPath,
    envExamplePath: result.envExamplePath,
    envVars: result.envVars,
    installed: result.installed,
    manualInstallCommand: result.manualInstallCommand,
    packageJsonCreated: result.packageJsonCreated,
    status: buildSetupStatus(state),
  };
}

async function handleSetupIntrospect(state: StudioState): Promise<IntrospectRunResponse> {
  if (!state.setupReason) {
    throw new StudioHttpError(409, "Studio is already set up — use Resync schema instead.");
  }
  // probeSetupState re-bootstraps, picking up any .env created since server start.
  const probe = probeSetupState(process.cwd());
  if (!probe.hasConfig) {
    throw new StudioHttpError(409, "Write askdb.config.ts first (setup step 1).");
  }
  if (probe.loadError || !probe.outputDir) {
    throw new StudioHttpError(
      409,
      `askdb.config.ts exists but could not be loaded: ${probe.loadError ?? "unknown error"}. ` +
        "Install the project dependencies shown in setup step 1, then retry.",
    );
  }
  const outDir = probe.outputDir;
  const run = await introspectOrRefuse({
    outDir,
    hasExistingArtifact: existsSync(join(outDir, "schema.json")),
  });
  state.schemaDir = outDir;
  state.workspace = loadWorkspace(outDir);
  state.setupReason = null;
  return {
    ok: true,
    engine: run.engine,
    schemaId: run.schemaId,
    tables: run.tables,
    warnings: run.warnings,
    workspace: serializeWorkspace(state.workspace),
  };
}

async function handleResync(state: StudioState): Promise<IntrospectRunResponse> {
  const workspace = requireWorkspace(state);
  // Refresh the runtime snapshot so config edits made while Studio runs are honored.
  try {
    bootstrapAskDbEnv({ cwd: process.cwd() });
  } catch {
    // Keep the snapshot the server started with when the config disappeared mid-session.
  }
  const run = await introspectOrRefuse({
    outDir: state.schemaDir,
    schemaId: workspace.physical.schemaId,
    hasExistingArtifact: true,
  });
  state.workspace = loadWorkspace(state.schemaDir);
  return {
    ok: true,
    engine: run.engine,
    schemaId: run.schemaId,
    tables: run.tables,
    warnings: run.warnings,
    workspace: serializeWorkspace(state.workspace),
  };
}

async function buildIntrospectionPlanDto(): Promise<IntrospectionPlanDto> {
  const plan = await resolveStudioIntrospectionPlan();
  return plan.ok
    ? { ok: true, engine: plan.engine, sourceLabel: plan.sourceLabel }
    : { ok: false, engine: plan.engine, error: plan.error };
}

function parseSetupConfigBody(body: unknown): SetupConfigInput {
  if (!isRecord(body)) {
    throw new StudioHttpError(400, "Request body must be a JSON object.");
  }
  const databases = ["postgres", "mysql", "sqlite", "sqlserver", "prisma"] as const;
  // Every provider with an askdb.config.* branch; @askdb/client's provider-config-drift test asserts this matches @askdb/ai's built-in table.
  const aiProviders = ASKDB_AI_PROVIDERS;
  const ragStores = ["file", "memory", "pgvector"] as const;
  const executeProviders = ["postgres", "mysql", "sqlite", "sqlserver"] as const;
  if (typeof body.database !== "string" || !databases.includes(body.database as (typeof databases)[number])) {
    throw new StudioHttpError(400, `\`database\` must be one of: ${databases.join(", ")}.`);
  }
  if (
    typeof body.aiProvider !== "string" ||
    !aiProviders.includes(body.aiProvider as (typeof aiProviders)[number])
  ) {
    throw new StudioHttpError(400, `\`aiProvider\` must be one of: ${aiProviders.join(", ")}.`);
  }
  if (body.ragStore !== undefined && !ragStores.includes(body.ragStore as (typeof ragStores)[number])) {
    throw new StudioHttpError(400, `\`ragStore\` must be one of: ${ragStores.join(", ")}.`);
  }
  if (
    body.studioExecuteProvider !== undefined &&
    !executeProviders.includes(body.studioExecuteProvider as (typeof executeProviders)[number])
  ) {
    throw new StudioHttpError(400, `\`studioExecuteProvider\` must be one of: ${executeProviders.join(", ")}.`);
  }
  if (body.studioExecute !== undefined && typeof body.studioExecute !== "boolean") {
    throw new StudioHttpError(400, "`studioExecute` must be a boolean.");
  }
  const optionalString = (key: string): string | undefined => {
    const value = body[key];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new StudioHttpError(400, `\`${key}\` must be a string.`);
    return value;
  };
  return {
    database: body.database as SetupConfigInput["database"],
    aiProvider: body.aiProvider as SetupConfigInput["aiProvider"],
    connectionEnv: optionalString("connectionEnv"),
    sqliteFile: optionalString("sqliteFile"),
    prismaSchema: optionalString("prismaSchema"),
    aiKeyEnv: optionalString("aiKeyEnv"),
    aiModelEnv: optionalString("aiModelEnv"),
    schemaOut: optionalString("schemaOut"),
    ragStore: body.ragStore as SetupConfigInput["ragStore"] | undefined,
    pgvectorEnv: optionalString("pgvectorEnv"),
    studioExecute: body.studioExecute as boolean | undefined,
    studioExecuteProvider: body.studioExecuteProvider as SetupConfigInput["studioExecuteProvider"] | undefined,
    studioExecuteConnectionEnv: optionalString("studioExecuteConnectionEnv"),
    studioExecuteSqliteFile: optionalString("studioExecuteSqliteFile"),
  };
}

function saveConceptsDraft(state: StudioState, concepts: V2Concept[]): void {
  saveConcepts(requireWorkspace(state), { concepts });
  state.workspace = loadWorkspace(state.schemaDir);
}

function saveTenantPolicyDraft(
  state: StudioState,
  frontmatter: TenantPolicyFrontmatter,
  body: string,
): void {
  // `saveTenantPolicy` refuses a policy `loadSchema` would reject (e.g. two root labels
  // deriving one placeholder) before writing; that's the caller's mistake, so 400.
  try {
    saveTenantPolicy(requireWorkspace(state), frontmatter, body);
  } catch (error) {
    if (error instanceof SchemaParseError) throw new StudioHttpError(400, error.message);
    throw error;
  }
  state.workspace = loadWorkspace(state.schemaDir);
}

function parseTenantPolicyBody(body: unknown): {
  frontmatter: TenantPolicyFrontmatter;
  bodyText: string;
} {
  if (!isRecord(body) || !isRecord(body.frontmatter)) {
    throw new StudioHttpError(400, "`frontmatter` object is required.");
  }
  const parsed = tenantPolicyFrontmatterSchema.safeParse(body.frontmatter);
  if (!parsed.success) {
    throw new StudioHttpError(400, `Invalid tenant policy: ${parsed.error.message}`);
  }
  const bodyText = typeof body.body === "string" ? body.body : "";
  return { frontmatter: parsed.data, bodyText };
}

function saveDraft(state: StudioState, tableId: string, draft: TableDraft): void {
  const workspace = requireWorkspace(state);
  const table = workspace.tables.find((candidate) => candidate.physical.id === tableId);
  if (!table) throw new StudioHttpError(404, `No such table: ${tableId}`);

  // Passing the file's current front-matter keeps entries for other tables' columns
  // (e.g. a misplaced `sensitive: true`), which the draft does not carry.
  const frontmatter = buildFrontmatter(
    table.physical,
    workspace.physical.schemaId,
    draft,
    table.parsed?.frontmatter,
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

  saveTable(workspace, tableId, frontmatter, body);
  state.workspace = loadWorkspace(state.schemaDir);
}

async function suggestForSource(state: StudioState, source: SuggestSource): Promise<SuggestResponse["candidates"]> {
  const rt = getAskDbRuntimeConfig();
  const aiConfig = ai.resolveAiConfig(rt.ai.aiEnv);
  if (!aiConfig) {
    throw new StudioHttpError(400, ai.keyMissingMessage("AI enrichment suggestions"));
  }
  const model = await ai.createLanguageModel(aiConfig);
  const reasoningEffort = resolveReasoningEffort(rt.ai.aiEnv, "enrichment");
  const providerOptions = reasoningEffort
    ? ai.resolveProviderOptions(aiConfig, { reasoningEffort })
    : undefined;
  // `loadSchema()` carries effective sensitivity (front-matter escalations included), and the
  // prompt follows `modes.omitSensitiveFromPrompt` as `ask()` does (#625, ADR 0026).
  requireWorkspace(state);
  const schema = loadSchema(state.schemaDir);
  let candidates: Awaited<ReturnType<typeof suggestEnrichment>>;
  try {
    candidates = await suggestEnrichment(
      buildSuggestionTarget(schema, source),
      buildSuggestionContext(schema, source.tableId),
      model,
      {
        omitSensitiveIdentifiersFromPrompt: rt.modes.omitSensitiveFromPrompt,
        ...(providerOptions ? { providerOptions } : {}),
      },
    );
  } catch (error) {
    if (error instanceof SensitiveEnrichmentTargetError) {
      throw new StudioHttpError(
        400,
        "This column is sensitive, and `modes.omitSensitiveFromPrompt` keeps sensitive columns out of the model's prompt, so Studio can't suggest for it.",
      );
    }
    throw error;
  }
  return candidates.map((candidate) => ({ text: candidate.text }));
}

/**
 * The schema as the tenant-policy draft sends it to the model, with the sensitivity rules
 * `ask()` applies (#324): `formatSchemaV2ForNlToSql` tags sensitive columns, or withholds
 * them when `omitSensitive` is on. Only the physical layer goes in (names, types, keys and
 * foreign keys), never descriptions, aliases or common query language, and untracked tables
 * stay out as they do for `ask()`. A foreign key is listed only when both of its columns are.
 * `warnings` names the primary and foreign keys withheld as sensitive, which the draft can't
 * scope through.
 */
function tenantPolicySchemaForPrompt(
  schema: NormalizedSchemaV2,
  omitSensitive: boolean,
): { schemaId: string; schemaDdl: string; tableIds: string[]; warnings: string[] } {
  const tracked = schema.tables.filter((table) => table.tracked !== false);
  const physical: NormalizedSchemaV2 = {
    schemaId: schema.schemaId,
    warnings: [],
    tables: tracked.map((table) => ({
      id: table.id,
      name: table.name,
      schema: table.schema,
      sensitive: table.sensitive,
      columns: table.columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        nullable: column.nullable,
        primaryKey: column.primaryKey,
        sensitive: column.sensitive,
      })),
    })),
  };
  const { ddl } = formatSchemaV2ForNlToSql(physical, { omitSensitiveIdentifiersFromPrompt: omitSensitive });

  // The formatter prints no foreign keys yet, so Studio lists them, mirroring the formatter's
  // omission rule (packages/core/src/schema/v2/format.ts): a column is withheld when omission
  // is on and it is sensitive, which `loadSchema()` sets on every column of a sensitive table.
  // When core prints foreign keys (#349, step 5), use its lines and delete this block (ADR 0021).
  const names = new Map<string, string>();
  const withheld = new Set<string>();
  for (const table of schema.tables) {
    for (const column of table.columns) {
      names.set(column.id, `${table.schema}.${table.name}.${column.name}`);
      if (omitSensitive && column.sensitive) withheld.add(column.id);
    }
  }
  const nameOf = (id: string) => names.get(id) ?? id;

  const listed = new Set<string>();
  const withheldKeys: string[] = [];
  for (const table of tracked) {
    for (const column of table.columns) {
      if (!withheld.has(column.id)) listed.add(column.id);
      else if (column.primaryKey) withheldKeys.push(`${nameOf(column.id)} (primary key)`);
    }
  }
  const foreignKeys: string[] = [];
  for (const fk of tracked.flatMap((table) => table.relationships ?? [])) {
    if (listed.has(fk.from) && listed.has(fk.to)) foreignKeys.push(`- ${fk.from} -> ${fk.to}`);
    else if (withheld.has(fk.from) || withheld.has(fk.to)) {
      withheldKeys.push(`${nameOf(fk.from)} → ${nameOf(fk.to)} (foreign key)`);
    }
  }
  const warnings =
    withheldKeys.length > 0
      ? [
          `Withheld from the model because they're marked sensitive: ${withheldKeys.join(", ")}. ` +
            "If any of them carries tenant scope, add it to the policy by hand.",
        ]
      : [];

  return {
    schemaId: schema.schemaId,
    schemaDdl: foreignKeys.length > 0 ? `${ddl}\n\nForeign keys:\n${foreignKeys.join("\n")}` : ddl,
    tableIds: tracked.map((table) => table.id),
    warnings,
  };
}

async function suggestTenantPolicyDraft(state: StudioState): Promise<SuggestTenantPolicyResponse> {
  const rt = getAskDbRuntimeConfig();
  const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);
  if (!model) {
    throw new StudioHttpError(400, ai.keyMissingMessage("AI tenant policy suggestion"));
  }

  requireWorkspace(state);
  const { schemaId, schemaDdl, tableIds, warnings } = tenantPolicySchemaForPrompt(
    loadSchema(state.schemaDir),
    rt.modes.omitSensitiveFromPrompt,
  );

  const systemPrompt = `You are an expert database architect specializing in multi-tenant SaaS systems.
You analyze database schemas and produce a tenant-policy configuration in a specific JSON format.

The tenant policy identifies:
1. **roots** — Tables whose rows represent tenants (organizations, companies, accounts, etc).
   Each root has: id (table ID like "table:public.orgs"), tenantIdColumn (column ref like "table:public.orgs#id"), label (human-readable name).
   If a root has a parent root (e.g. sub_org belongs to org), include parent: { root: "<parent-root-id>", foreignKey: "<fk-column-ref>" }.
2. **hierarchy** — Edges showing parent→child relationships between roots or tenant-scoped tables.
   Each edge: { parent: "<table-id>", child: "<table-id>", foreignKey: "<child-fk-column-ref>" }.
3. **scopedTables** — Tables that belong to a tenant via a direct column or a JOIN chain.
   Each entry: { id: "<table-id>", scopeThrough: [{ root: "<root-id>", column: "<column-ref>" }] } for direct FK,
   or { id: "<table-id>", scopeThrough: [{ root: "<root-id>", join: [{ from: "<col-ref>", to: "<col-ref>" }] }] } for indirect.
4. **polymorphicTables** — Tables with a type/id polymorphic association pattern.
   Each entry: { id: "<table-id>", typeColumn: "<col-ref>", idColumn: "<col-ref>", mapping: { "<type_value>": "<target-table-id>" } }.
5. **globalTables** — Tables shared across all tenants (lookup tables, reference data). Array of table IDs.
6. **enforcement** — "strict" (reject queries on unknown tables) or "warn" (allow with warnings).

Column references use the format "table:<schema>.<table>#<column>".
Table IDs use the format "table:<schema>.<table>".

Available table IDs: ${JSON.stringify(tableIds)}

Return a JSON object with two keys:
- "frontmatter": the TenantPolicyFrontmatter object (schemaId, enforcement, roots, hierarchy?, scopedTables?, polymorphicTables?, globalTables?)
- "body": a markdown body string with sections "## Hierarchy", "## Scope rules", "## Sensitive interactions" explaining the policy in plain English.

Return ONLY valid JSON, no markdown fences or explanations.`;

  const userPrompt = `Analyze this database schema and draft a complete multi-tenant policy.

Schema ID: ${schemaId}

${schemaDdl}

Look for:
- Tables that represent organizations, companies, accounts, tenants, or workspaces — these are roots.
- Foreign key columns like org_id, company_id, tenant_id, account_id that scope data to a tenant.
- Tables with no tenant FK that are clearly shared/global (lookup tables, enums, config).
- Polymorphic association patterns (type_column + id_column pointing to multiple parent tables).
- Multi-level hierarchies (org → team → user, company → department → employee).

If the schema has no clear multi-tenant pattern, still make your best guess at what would be the tenant root.`;

  const result = await defaultGenerateText({
    model,
    instructions: systemPrompt,
    prompt: userPrompt,
  });

  let parsed: Pick<SuggestTenantPolicyResponse, "frontmatter" | "body">;
  try {
    parsed = JSON.parse(result.text) as typeof parsed;
  } catch {
    throw new StudioHttpError(500, `AI returned invalid JSON for tenant policy suggestion. Raw text: ${result.text.slice(0, 500)}`);
  }

  // Validate frontmatter shape
  const validation = tenantPolicyFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!validation.success) {
    throw new StudioHttpError(
      500,
      `AI-generated tenant policy frontmatter is invalid: ${validation.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return { frontmatter: validation.data, body: parsed.body, warnings };
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
  const aiConfig = mockSql ? undefined : ai.resolveAiConfig(rt.ai.aiEnv);
  if (!mockSql && !aiConfig) {
    throw new StudioHttpError(
      400,
      `${ai.keyMissingMessage("Sample NL-to-SQL generation")} Set dev.mockSql in askdb.config to bypass the live model.`,
    );
  }
  const reasoningEffort = mockSql ? undefined : resolveReasoningEffort(rt.ai.aiEnv, "nlToSql");
  const providerOptions =
    aiConfig && reasoningEffort ? ai.resolveProviderOptions(aiConfig, { reasoningEffort }) : undefined;

  const schema = loadSchema(state.schemaDir);
  const retrievedChunks: QueryResult[] = [];
  const usage = createRequestUsageCollector();
  const ragIndex = options.useRag
    ? await createCurrentStudioRagIndex(state, "using RAG for sample generation", usage)
    : undefined;
  type AskModel = Parameters<typeof ask>[0]["model"];
  const model: AskModel = mockSql
    ? (undefined as unknown as AskModel)
    : ((await ai.createLanguageModelFromEnv(rt.ai.aiEnv)) as AskModel);

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
    // `ask()` doesn't read config, so each host applies `modes.omitSensitiveFromPrompt`
    // itself, as `@askdb/client` does (#601).
    ...(rt.modes.omitSensitiveFromPrompt ? { omitSensitiveIdentifiersFromNlToSqlPrompt: true } : {}),
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
            ...(providerOptions ? { providerOptions } : {}),
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
          sqlMode: options.tenantSqlMode ?? DEFAULT_TENANT_SQL_MODE,
          bindings: result.tenantBindings ?? [],
          params: result.tenantParams ?? [],
        }
      : null,
    usage: usage.toDto(),
  };
}

/** The `schema.lock.json` fields the RAG status reads. */
type StudioRagIndexRecord = Partial<
  Pick<SchemaLockFile, "embedderId" | "updatedAt" | "dimensions" | "hashes" | "incomplete">
>;

async function getRagStatus(state: StudioState): Promise<StudioRagStatusDto> {
  const config = resolveStudioRagEmbedderConfig();
  const sources = loadChunkerSourcesFromDir(state.schemaDir);
  const chunkResult = chunkSchema(sources);
  const lockPath = join(state.schemaDir, "schema.lock.json");
  const lock =
    resolveStudioRagStoreConfig(state).kind === "memory"
      ? state.ragMemoryIndex
      : (readOptionalJson(lockPath) as StudioRagIndexRecord | undefined);
  const currentHashes = Object.fromEntries(
    chunkResult.chunks.map((chunk) => [chunk.id, chunkContentHash(chunk.text)]),
  );
  const lockHashes = lock?.hashes ?? {};
  const hashIds = Object.keys(currentHashes);
  const store = await openStudioRagStore(state, { dimensions: config.dimensions });
  try {
    const chunksIndexed = await countStudioRagStoreChunks(store, sources.schema.schemaId);
    const stale =
      !lock ||
      lock.incomplete === true ||
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
      // The width the last index build learned from the model, else the one configured.
      dimensions: lock?.dimensions ?? config.dimensions ?? null,
      expectedDimensions: config.dimensions ?? null,
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
    throw new StudioHttpError(400, studioRagAiSdkKeyMissingMessage(config));
  }
  const usage = createRequestUsageCollector();
  clearIncompatibleRagStore(state, config);
  const sources = loadChunkerSourcesFromDir(state.schemaDir);
  const embedder = await createStudioRagEmbedder(config, usage);
  let result: Awaited<ReturnType<typeof buildSchemaIndex>>;
  let store: StudioOpenRagStore | undefined;
  try {
    // A new pgvector table needs its width up front: the configured one, else the model's own.
    const dimensions =
      config.dimensions ??
      (resolveStudioRagStoreConfig(state).kind === "pgvector" ? await detectEmbeddingDimensions(embedder) : undefined);
    store = await openStudioRagStore(state, { dimensions, provision: true });
    result = await buildSchemaIndex({
      schema: sources,
      embedder,
      store: store.store,
      embedderId: config.embedderId,
      lockFilePath: join(state.schemaDir, "schema.lock.json"),
    });
    if (store.kind === "memory") {
      state.ragMemoryIndex = {
        embedderId: config.embedderId,
        updatedAt: new Date().toISOString(),
        dimensions: store.store.describe?.().dimensions,
        hashes: Object.fromEntries(result.chunks.map((chunk) => [chunk.id, chunkContentHash(chunk.text)])),
      };
    }
  } catch (error) {
    throw formatStudioRagOperationError(error, config);
  } finally {
    await store?.dispose();
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
    throw new StudioHttpError(400, studioRagAiSdkKeyMissingMessage(config));
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
  const store = await openStudioRagStore(state, { dimensions: config.dimensions });
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
  const kind = rt.rag.store;
  if (kind === "memory") return { kind };
  if (kind === "file") {
    const basePath = rt.rag.storeConfig.file?.basePath?.trim();
    return { kind, basePath: basePath ? resolve(basePath) : join(state.schemaDir, "schema") };
  }
  const connectionString = pickFlat(rt.flat, "ASKDB_PGVECTOR_URL");
  return {
    kind,
    connectionString,
    table: rt.rag.storeConfig.pgvector?.table?.trim() || undefined,
    indexStrategy: pickFlat(rt.flat, "ASKDB_PGVECTOR_INDEX_STRATEGY"),
  };
}

/**
 * Opens the configured store. `provision` creates the pgvector table when it's missing, at
 * `dimensions`; without it, a pgvector store only reads and writes an existing table.
 */
async function openStudioRagStore(
  state: StudioState,
  { dimensions, provision = false }: { dimensions?: number; provision?: boolean },
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
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(config.indexStrategy ? { indexStrategy: config.indexStrategy as "ivfflat" | "hnsw" | "none" } : {}),
  });
  if (provision) {
    try {
      await store.ensureSchema();
    } catch (error) {
      // The caller never receives this store, so close its pool here (a width refusal has opened it).
      await store.close().catch(() => {});
      throw error;
    }
  }
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
  // A pgvector table that doesn't exist yet holds nothing; the first index build creates it.
  if (typeof store.store.tableDimensions === "function" && (await store.store.tableDimensions()) === undefined) {
    return 0;
  }
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

function resolveStudioRagEmbedderConfig(): StudioRagEmbedderConfig {
  const embedding = getAskDbRuntimeConfig().ai.embedding;
  if (!embedding) {
    return {
      kind: "mock",
      embedderId: STUDIO_RAG_MOCK_EMBEDDER_ID,
      dimensions: STUDIO_RAG_MOCK_DIMENSIONS,
      configured: true,
      label: "Mock lexical",
    };
  }

  // The env holds the embedding connection only, so no other provider's key can reach it (#345).
  const aiConfig = ai.resolveEmbeddingConfig(embedding.env);
  // The adapter's canonical name (`foundry` resolves to `azure`) keeps existing index ids stable.
  const provider = aiConfig?.provider ?? embedding.provider;
  const model = embedding.model;
  const dimensions = embedding.dimensions;
  return {
    kind: "ai-sdk",
    provider,
    configuredProvider: embedding.provider,
    connection: embedding.connection,
    embedderId: aiSdkEmbedderId({ provider, model, dimensions }),
    dimensions,
    configured: Boolean(aiConfig),
    label: `AI SDK (${provider})`,
    model,
    baseUrl: aiConfig?.baseURL,
    aiConfig,
    // Only an explicit ai.embedding.dimensions is sent; otherwise the model's own width applies.
    requestDimensions: embedding.dimensions,
  };
}

function studioRagAiSdkKeyMissingMessage(config: Extract<StudioRagEmbedderConfig, { kind: "ai-sdk" }>): string {
  return (
    `Studio RAG embeddings need an API key on the ai.embedding connection ` +
    `("${config.connection}" in ai.providerConfig.${config.configuredProvider}). ` +
    'Set it in askdb.config.*, or set rag.embedder: "mock" for the local lexical embedder.'
  );
}

async function createStudioRagEmbedder(
  config: StudioRagEmbedderConfig,
  usage?: StudioRequestUsageCollector,
): Promise<Embedder> {
  if (config.kind === "mock") return createStudioMockEmbedder(config.dimensions);
  if (!config.aiConfig) {
    throw new StudioHttpError(400, studioRagAiSdkKeyMissingMessage(config));
  }
  const model = await ai.createEmbeddingModel(config.aiConfig, {
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
  if (error instanceof PgvectorDimensionMismatchError) {
    return new StudioHttpError(409, studioRagWidthMismatchMessage(error, config));
  }
  if (config.kind === "mock") {
    return new StudioHttpError(500, error instanceof Error ? error.message : String(error));
  }

  const apiError = findApiCallError(error);
  if (!apiError) {
    return new StudioHttpError(500, error instanceof Error ? error.message : String(error));
  }
  const parts = [
    `Studio RAG embedding request failed for ai.embedding (provider ${config.configuredProvider}, connection ${config.connection}, model ${config.model}).`,
  ];
  if (config.baseUrl) parts.push(`Base URL: ${config.baseUrl}.`);
  if (apiError?.statusCode) parts.push(`Status: ${apiError.statusCode}.`);
  const responseBody = truncateForMessage(apiError?.responseBody);
  if (responseBody) parts.push(`Response: ${responseBody}`);
  if (!responseBody && error instanceof Error) parts.push(`Error: ${error.message}`);
  return new StudioHttpError(502, parts.join(" "));
}

/** An existing pgvector table of another width: say where the new width comes from and how to resolve it, in config terms. */
function studioRagWidthMismatchMessage(error: PgvectorDimensionMismatchError, config: StudioRagEmbedderConfig): string {
  const mismatch = `pgvector table "${error.table}" holds ${error.tableDimensions}-dimension vectors, but`;
  const rebuild = `Drop the table (DROP TABLE "${error.table}";) and build the index again`;
  const newTable = "point rag.storeConfig.pgvector.table at a new table";
  if (config.kind === "mock") {
    return `${mismatch} the mock embedder writes ${error.dimensions}. ${rebuild}, or ${newTable}.`;
  }
  const source =
    config.dimensions !== undefined
      ? `ai.embedding.dimensions asks for ${error.dimensions}`
      : `embedding model ${config.model} returns ${error.dimensions}`;
  return (
    `${mismatch} ${source}. ${rebuild}, ${newTable}, ` +
    `or set ai.embedding.dimensions: ${error.tableDimensions} if model ${config.model} supports that width.`
  );
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
  if (embeddings?.dimensions === undefined) return;
  // The file store refuses mixed widths. When the width isn't known up front, vectors from a
  // different embedder may not match it, so they go too.
  const lockPath = join(state.schemaDir, "schema.lock.json");
  const compatible =
    config.dimensions !== undefined
      ? embeddings.dimensions === config.dimensions
      : (readOptionalJson(lockPath) as { embedderId?: string } | undefined)?.embedderId === config.embedderId;
  if (compatible) return;
  for (const path of [`${store.basePath}.embeddings.json`, `${store.basePath}.embeddings.bin`, lockPath]) {
    rmSync(path, { force: true });
  }
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

// ---------------------------------------------------------------------------
// Playground history helpers
// ---------------------------------------------------------------------------

const HISTORY_MAX_STORED = 200;
const HISTORY_MAX_RETURNED = 50;
const HISTORY_FILE_NAME = "playground-history.json";

function playgroundHistoryPath(schemaDir: string): string {
  return join(schemaDir, HISTORY_FILE_NAME);
}

function readPlaygroundHistory(schemaDir: string): { entries: PlaygroundHistoryEntry[] } {
  const raw = readOptionalJson(playgroundHistoryPath(schemaDir));
  const entries = Array.isArray(raw) ? (raw as PlaygroundHistoryEntry[]) : [];
  return { entries: entries.slice(0, HISTORY_MAX_RETURNED) };
}

function appendPlaygroundHistory(
  schemaDir: string,
  entry: Omit<PlaygroundHistoryEntry, "id" | "timestamp">,
): void {
  const histPath = playgroundHistoryPath(schemaDir);
  const raw = readOptionalJson(histPath);
  const existing: PlaygroundHistoryEntry[] = Array.isArray(raw)
    ? (raw as PlaygroundHistoryEntry[])
    : [];
  const newEntry: PlaygroundHistoryEntry = {
    ...entry,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const updated = [newEntry, ...existing].slice(0, HISTORY_MAX_STORED);
  ensureSchemaDirGitignore(schemaDir);
  saveSchemaFile(schemaDir, HISTORY_FILE_NAME, JSON.stringify(updated, null, 2));
}

/**
 * Keep Playground history (questions + generated SQL, local-only) out of git.
 * The schema artifact directory is meant to be committed, so Studio makes sure
 * its `.gitignore` lists `playground-history.json` before writing the file.
 *
 * - No `.gitignore` yet: write one that also ignores `.env` files — the same
 *   rules `askdb init` writes (plan 043) — unless the schema dir is the project
 *   root, where ignoring `.env` is the project's call, not Studio's.
 * - Existing `.gitignore` without the entry: add the entry at the end and keep
 *   every existing byte as it was.
 * - Both are saved with `saveSchemaFile()`, so a `.gitignore` that is a symbolic
 *   link is refused, not written through (ADR 0028).
 * - Failure is non-fatal: history still saves.
 */
function ensureSchemaDirGitignore(schemaDir: string): void {
  const gitignorePath = join(schemaDir, ".gitignore");
  try {
    if (existsSync(gitignorePath)) {
      // Kept as bytes: Git matches patterns byte for byte, and a non-UTF-8 file name
      // in an existing line must survive the rewrite.
      const content = readFileSync(gitignorePath);
      const lines = content.toString("utf8").split(/\r?\n/).map((line) => line.trim());
      if (lines.includes(HISTORY_FILE_NAME) || lines.includes(`/${HISTORY_FILE_NAME}`)) return;
      const separator = content.length === 0 || content.at(-1) === 0x0a ? "" : "\n";
      const entry = `${separator}# AskDB Studio Playground history (local only)\n${HISTORY_FILE_NAME}\n`;
      saveSchemaFile(schemaDir, ".gitignore", Buffer.concat([content, Buffer.from(entry, "utf8")]));
      return;
    }
    const lines = [
      "# Written by AskDB Studio.",
      "#",
      "# The schema artifact in this directory is meant to be committed: schema.json",
      "# plus any enrichment you author in Studio. Playground history (your questions",
      "# and generated SQL) is local only.",
      HISTORY_FILE_NAME,
    ];
    if (!isProjectRootDir(schemaDir)) {
      lines.push(
        "",
        "# Credentials: keep API keys and connection strings out of version control",
        "# even when they live here.",
        ".env",
        ".env.*",
        "!.env.example",
      );
    }
    saveSchemaFile(schemaDir, ".gitignore", `${lines.join("\n")}\n`);
  } catch {
    // Non-fatal: the history write matters more than this defensive file.
  }
}

function isProjectRootDir(dir: string): boolean {
  if (existsSync(join(dir, "package.json"))) return true;
  try {
    return readdirSync(dir).some((name) => name.startsWith("askdb.config."));
  } catch {
    return false;
  }
}

function deletePlaygroundHistoryEntry(
  schemaDir: string,
  id: string,
): { ok: true } | { ok: false; error: string } {
  const histPath = playgroundHistoryPath(schemaDir);
  const raw = readOptionalJson(histPath);
  const existing: PlaygroundHistoryEntry[] = Array.isArray(raw)
    ? (raw as PlaygroundHistoryEntry[])
    : [];
  const filtered = existing.filter((e) => e.id !== id);
  if (filtered.length === existing.length) {
    return { ok: false, error: "not found" };
  }
  saveSchemaFile(schemaDir, HISTORY_FILE_NAME, JSON.stringify(filtered, null, 2));
  return { ok: true };
}

const HISTORY_LIMITS = {
  question: 4_000,
  sql: 100_000,
  explain: 100_000,
  /** Serialized JSON size for `tenantScope` / `tenantParams`. */
  json: 20_000,
  error: 2_000,
  ragChunkIds: 200,
  ragChunkId: 512,
} as const;

/**
 * Validate a history entry and copy **only** the known fields — the file is
 * written inside the schema artifact directory, so nothing unexpected (or
 * unbounded) from the request body may be persisted.
 */
function parsePlaygroundHistoryEntry(
  body: unknown,
): Omit<PlaygroundHistoryEntry, "id" | "timestamp"> {
  if (!isRecord(body)) {
    throw new StudioHttpError(400, "Request body must be a JSON object.");
  }
  const question = requireBoundedString(body.question, "question", HISTORY_LIMITS.question);
  if (question.trim() === "") {
    throw new StudioHttpError(400, "`question` is required.");
  }
  if (body.mode !== "full" && body.mode !== "rag") {
    throw new StudioHttpError(400, "`mode` must be `full` or `rag`.");
  }
  if (body.sqlMode !== "sql-only" && body.sqlMode !== "sql-params") {
    throw new StudioHttpError(400, "`sqlMode` must be `sql-only` or `sql-params`.");
  }
  const entry: Omit<PlaygroundHistoryEntry, "id" | "timestamp"> = {
    question,
    mode: body.mode,
    sqlMode: body.sqlMode,
    sql: requireBoundedString(body.sql, "sql", HISTORY_LIMITS.sql),
  };
  if (body.explain !== undefined && body.explain !== null) {
    entry.explain = requireBoundedString(body.explain, "explain", HISTORY_LIMITS.explain);
  }
  if (body.tenantScope !== undefined && body.tenantScope !== null) {
    entry.tenantScope = requireBoundedJsonObject(body.tenantScope, "tenantScope");
  }
  if (body.tenantParams !== undefined && body.tenantParams !== null) {
    entry.tenantParams = requireBoundedJsonObject(body.tenantParams, "tenantParams");
  }
  if (body.executionResult !== undefined && body.executionResult !== null) {
    const r = body.executionResult;
    if (
      !isRecord(r) ||
      !isNonNegativeFinite(r.rowCount) ||
      !isNonNegativeFinite(r.durationMs) ||
      typeof r.truncated !== "boolean"
    ) {
      throw new StudioHttpError(
        400,
        "`executionResult` must be { rowCount: number, durationMs: number, truncated: boolean, error?: string }.",
      );
    }
    entry.executionResult = {
      rowCount: r.rowCount,
      durationMs: r.durationMs,
      truncated: r.truncated,
      ...(r.error !== undefined
        ? { error: requireBoundedString(r.error, "executionResult.error", HISTORY_LIMITS.error) }
        : {}),
    };
  }
  if (body.ragChunkIds !== undefined && body.ragChunkIds !== null) {
    if (
      !Array.isArray(body.ragChunkIds) ||
      body.ragChunkIds.length > HISTORY_LIMITS.ragChunkIds ||
      !body.ragChunkIds.every((id) => typeof id === "string" && id.length <= HISTORY_LIMITS.ragChunkId)
    ) {
      throw new StudioHttpError(
        400,
        `\`ragChunkIds\` must be an array of at most ${HISTORY_LIMITS.ragChunkIds} strings.`,
      );
    }
    entry.ragChunkIds = [...(body.ragChunkIds as string[])];
  }
  return entry;
}

function requireBoundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new StudioHttpError(400, `\`${field}\` must be a string.`);
  }
  if (value.length > maxLength) {
    throw new StudioHttpError(400, `\`${field}\` is too long (max ${maxLength} characters).`);
  }
  return value;
}

function requireBoundedJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new StudioHttpError(400, `\`${field}\` must be a JSON object.`);
  }
  if (JSON.stringify(value).length > HISTORY_LIMITS.json) {
    throw new StudioHttpError(400, `\`${field}\` is too large (max ${HISTORY_LIMITS.json} characters as JSON).`);
  }
  return value;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Execute endpoint helpers
// ---------------------------------------------------------------------------

const EXECUTE_DISABLED_MESSAGE =
  "Studio execute is off. To run generated SQL from the Playground, set `studio.execute.enabled: true` " +
  "and an execute connection (`studio.execute.databaseUrl`, or `studio.execute.file` for SQLite) in " +
  "askdb.config.ts, ideally for a read-only database role, then restart Studio.";

function executeNotConfiguredMessage(exec: ReturnType<typeof getAskDbRuntimeConfig>["studio"]["execute"]): string {
  const field = exec.provider === "sqlite" ? "studio.execute.file" : "studio.execute.databaseUrl";
  const base = `No execute connection configured. Set \`${field}\` in askdb.config.ts (ideally a read-only database role).`;
  return exec.introspectionConnectionAvailable
    ? `${base} Studio no longer reuses the introspection connection by default; set \`studio.execute.useIntrospectionConnection: true\` to opt in.`
    : base;
}

async function getExecuteStatus(schemaDir: string): Promise<ExecuteStatusResponse> {
  const rt = getAskDbRuntimeConfig();
  const exec = rt.studio.execute;
  const { provider, databaseUrl, file } = exec;
  const def = EXECUTE_DRIVER_REGISTRY[provider];
  const projectRoot = findNearestPackageJsonDir(schemaDir) ?? schemaDir;
  const installed = isDriverInstalled(def.packageName, projectRoot);
  const connectionKind: "url" | "file" = provider === "sqlite" ? "file" : "url";
  const configured = connectionKind === "file" ? Boolean(file) : Boolean(databaseUrl);
  const disabledReason = !exec.enabled
    ? EXECUTE_DISABLED_MESSAGE
    : !configured
      ? executeNotConfiguredMessage(exec)
      : null;
  return {
    enabled: exec.enabled,
    disabledReason,
    timeoutMs: exec.timeoutMs,
    maxRows: exec.maxRows,
    provider,
    label: def.label,
    configured,
    connectionKind,
    packageName: def.packageName,
    installed,
    installCommand: def.installCommand,
    canInstallFromStudio: exec.enabled,
    manualInstallReason: null,
  };
}

async function installExecuteDriver(
  body: unknown,
  schemaDir: string,
): Promise<ExecuteInstallDriverResponse> {
  const rt = getAskDbRuntimeConfig();
  if (!rt.studio.execute.enabled) {
    throw new StudioHttpError(403, EXECUTE_DISABLED_MESSAGE);
  }

  // Accept the configured provider or an explicit allowlisted provider. `Object.hasOwn`
  // (via isStudioExecuteProvider) rejects inherited keys such as "constructor".
  let provider: StudioExecuteProvider = rt.studio.execute.provider;
  if (isRecord(body) && body.provider !== undefined) {
    if (!isStudioExecuteProvider(body.provider)) {
      throw new StudioHttpError(
        400,
        `Unknown provider: ${JSON.stringify(body.provider)}. Expected one of: ${Object.keys(EXECUTE_DRIVER_REGISTRY).join(", ")}.`,
      );
    }
    provider = body.provider;
  }

  const def = EXECUTE_DRIVER_REGISTRY[provider];
  const detection = detectExecuteDriverInstaller(schemaDir, def.packageName);

  if (detection.manualReason !== null) {
    return {
      ok: false,
      provider,
      packageName: def.packageName,
      command: [],
      error: detection.manualReason,
      installed: false,
    };
  }

  const { packageManager, projectRoot, spawnSpec } = detection;
  const { stdout, stderr, code } = await spawnCommand(spawnSpec, projectRoot);
  const installed = isDriverInstalled(def.packageName, projectRoot);

  return {
    ok: code === 0,
    provider,
    packageName: def.packageName,
    command: [spawnSpec.command, ...spawnSpec.args],
    stdout,
    stderr,
    error: code !== 0 ? `${packageManager} exited with code ${code}` : undefined,
    installed,
  };
}

type ExecuteDriverInstaller =
  | {
      manualReason: null;
      packageManager: string;
      projectRoot: string;
      spawnSpec: ReturnType<typeof packageManagerSpawnSpec>;
    }
  | { manualReason: string };

/**
 * How to install the execute driver: with the manager of the lockfile in the nearest
 * `package.json` directory above `cwd`. Unlike setup's detection it doesn't walk further
 * up or guess, so Studio never installs into a parent project or with a manager the
 * project hasn't chosen.
 */
function detectExecuteDriverInstaller(cwd: string, packageName: string): ExecuteDriverInstaller {
  const projectRoot = findNearestPackageJsonDir(cwd);
  if (!projectRoot) {
    return { manualReason: `Could not locate a package.json above ${cwd}. Run the install manually.` };
  }
  const pm = lockfilePackageManager(projectRoot);
  if (!pm) {
    return { manualReason: `No recognized lockfile found in ${projectRoot}. Run: pnpm add ${packageName}` };
  }
  return {
    manualReason: null,
    packageManager: pm,
    projectRoot,
    spawnSpec: packageManagerSpawnSpec(pm, packageManagerAddArgs(pm, [packageName])),
  };
}

function spawnCommand(
  spec: ReturnType<typeof packageManagerSpawnSpec>,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(spec.command, spec.args, { cwd, shell: spec.shell, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8").slice(0, 4096),
        stderr: Buffer.concat(stderrChunks).toString("utf8").slice(0, 4096),
        code: code ?? 1,
      });
    });
    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

async function executeQuery(body: unknown, schemaDir: string): Promise<ExecuteResponse> {
  const rt = getAskDbRuntimeConfig();
  const exec = rt.studio.execute;
  if (!exec.enabled) {
    throw new StudioHttpError(403, EXECUTE_DISABLED_MESSAGE);
  }

  if (!isRecord(body) || typeof body.sql !== "string" || body.sql.trim() === "") {
    throw new StudioHttpError(400, "`sql` is required.");
  }
  if (body.params !== undefined && !Array.isArray(body.params)) {
    throw new StudioHttpError(400, "`params` must be an array.");
  }
  const params = (body.params as unknown[] | undefined) ?? [];

  // Same read-only SELECT guardrail `ask()` applies, for the execute engine's
  // dialect — rejects multi-statement input, comments, DDL/DML keywords, …
  // before anything reaches a driver.
  let sql: string;
  try {
    sql = validateExecuteSql(exec.provider, body.sql, rt.nlToSql.dialect);
  } catch (error) {
    if (error instanceof SqlValidationError) {
      throw new StudioHttpError(400, `SQL rejected by the read-only guardrail (${error.rule}): ${error.message}`);
    }
    throw error;
  }

  const warnings = sensitiveExecuteWarnings(
    sql,
    schemaDir,
    executeDialectFor(exec.provider, rt.nlToSql.dialect),
  );
  const projectRoot = findNearestPackageJsonDir(schemaDir) ?? schemaDir;
  const def = EXECUTE_DRIVER_REGISTRY[exec.provider];
  const result = await def.execute({
    connectionString: exec.databaseUrl,
    file: exec.file,
    sql,
    params,
    projectRoot,
    timeoutMs: exec.timeoutMs,
    maxRows: exec.maxRows,
  });
  if (!result.ok && /^No (connection URL|SQLite file path) configured/.test(result.error)) {
    return { ok: false, error: executeNotConfiguredMessage(exec) };
  }
  return result.ok && warnings.length > 0 ? { ...result, warnings } : result;
}

/**
 * Warn (never block) when the SQL references identifiers marked `sensitive` —
 * the same check `ask()` runs in its default `"warn"` mode. Studio has no
 * strict-mode setting; hosts that need enforcement call
 * `validateSensitiveReferences(sql, schema, { mode: "strict" })` themselves.
 */
function sensitiveExecuteWarnings(
  sql: string,
  schemaDir: string,
  dialect: DialectSpec,
): string[] {
  let schema: ReturnType<typeof loadSchema>;
  try {
    schema = loadSchema(schemaDir);
  } catch {
    return [];
  }
  if (!schemaHasSensitiveIdentifiers(schema)) return [];
  const result = validateSensitiveReferences(sql, schema, { mode: "warn", dialect });
  if (result.references.length === 0) return [];
  return [
    `This query reads identifiers marked sensitive: ${result.references.map(formatSensitiveReference).join(", ")}.`,
  ];
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const socket = req.socket;
  const remoteAddress = socket?.remoteAddress ?? "";
  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1" ||
    remoteAddress === "localhost"
  );
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
  // ai@6 LanguageModelUsage uses inputTokens/outputTokens rather than the
  // legacy promptTokens/completionTokens names.
  const promptTokens = readFiniteNumber(value.promptTokens) ?? readFiniteNumber(value.inputTokens);
  const completionTokens =
    readFiniteNumber(value.completionTokens) ?? readFiniteNumber(value.outputTokens);
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

/** Largest JSON request body Studio accepts. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

function bodyTooLarge(): StudioHttpError {
  return new StudioHttpError(413, `Request body is too large (limit ${MAX_JSON_BODY_BYTES} bytes).`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) {
    // Node discards the unread body after the 413 response is sent.
    throw bodyTooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  for await (const chunk of req) {
    // Keep draining (without buffering) once over the limit, so the client
    // can read the 413 instead of hitting a reset connection.
    if (overflow) continue;
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_JSON_BODY_BYTES) {
      overflow = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buf);
  }
  if (overflow) throw bodyTooLarge();
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

function resolveClientFile(res: ServerResponse, relativePath: string): string | null {
  const root = clientDir();
  const filePath = resolve(root, relativePath);
  const fileRelativeToClientDir = relative(root, filePath);
  if (fileRelativeToClientDir.startsWith("..") || fileRelativeToClientDir === "") {
    writeJson(res, 404, { error: { message: "Not found" } });
    return null;
  }
  if (!existsSync(filePath)) {
    writeJson(res, 500, {
      error: {
        message:
          "Studio client assets are missing. Run `pnpm --filter @askdb/studio build` before starting Studio.",
      },
    });
    return null;
  }
  return filePath;
}

function serveClientFile(res: ServerResponse, relativePath: string): void {
  const filePath = resolveClientFile(res, relativePath);
  if (!filePath) return;
  res.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": "no-store",
  });
  res.end(readFileSync(filePath));
}

/** Serve the SPA shell with this launch's session token injected. */
function serveIndexHtml(res: ServerResponse, sessionToken: string): void {
  const filePath = resolveClientFile(res, "index.html");
  if (!filePath) return;
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    // The page carries the session token and drives SQL execution — never let
    // another site frame it (clickjacking).
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
  });
  res.end(injectSessionToken(readFileSync(filePath, "utf8"), sessionToken));
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

/** Runs introspection; an empty result is the user's to fix (ADR 0037), so it answers 422, not 500. */
async function introspectOrRefuse(options: Parameters<typeof runStudioIntrospection>[0]): ReturnType<typeof runStudioIntrospection> {
  try {
    return await runStudioIntrospection(options);
  } catch (error) {
    if (error instanceof EmptyIntrospectionError) throw new StudioHttpError(422, error.message);
    throw error;
  }
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
