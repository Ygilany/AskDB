import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, relative, join, resolve, dirname, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateText as defaultGenerateText } from "ai";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import {
  createAiRegistry,
  type AiConfig,
  type AiEnv,
  type AiProvider,
} from "@askdb/ai";
import { anthropicProvider } from "@askdb/ai-anthropic";
import { azureProvider } from "@askdb/ai-azure";
import { googleProvider } from "@askdb/ai-google";
import { openaiProvider } from "@askdb/ai-openai";
import {
  ask,
  isBuiltInDialectId,
  loadSchema,
  suggestEnrichment,
  tenantScopeSchema,
  type AskDialectInput,
  type AskGenerateDeps,
  type TenantPolicyFrontmatter,
  type TenantScope,
  type TenantSqlOutputMode,
  type V2Concept,
  writeTenantPolicyMarkdown,
  tenantPolicyFrontmatterSchema,
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
import { EXECUTE_DRIVER_REGISTRY, isDriverInstalled } from "./execute-registry.js";
import type { StudioExecuteProvider } from "./execute-registry.js";
import { resolveStudioIntrospectionPlan, runStudioIntrospection } from "./introspection.js";
import { probeSetupState, writeSetupConfig, SetupError, type SetupConfigInput } from "./setup.js";

const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider, anthropicProvider]);

const CLIENT_DIR = fileURLToPath(new URL("./client/", import.meta.url));

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

export type StudioServer = ReturnType<typeof createServer>;

type StudioState = {
  schemaDir: string;
  workspace: Workspace | null;
  setupReason: SetupReason | null;
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
      provider: AiProvider;
      embedderId: string;
      dimensions: number;
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
  const setupReason = options.setupReason ?? null;
  if (!setupReason && !existsSync(schemaDir)) {
    throw new Error(`schema directory not found: ${schemaDir}`);
  }

  const state: StudioState = {
    schemaDir,
    workspace: setupReason ? null : loadWorkspace(schemaDir),
    setupReason,
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
        return writeJson(res, 200, buildIntrospectionPlanDto());
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
        saveTenantPolicy(state, frontmatter, bodyText);
        return writeJson(res, 200, serializeWorkspace(requireWorkspace(state)));
      }
      if (req.method === "POST" && url.pathname === "/api/suggest-tenant-policy") {
        const draft = await suggestTenantPolicyDraft(state);
        return writeJson(res, 200, draft);
      }
      if (req.method === "POST" && url.pathname === "/api/suggest") {
        const body = await readJson(req);
        const source = parseSuggestSource(body);
        const candidates = await suggestForSource(requireWorkspace(state), source);
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
        return serveClientFile(res, "index.html");
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
  const run = await runStudioIntrospection({
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
  const run = await runStudioIntrospection({
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

function buildIntrospectionPlanDto(): IntrospectionPlanDto {
  const plan = resolveStudioIntrospectionPlan();
  return plan.ok
    ? { ok: true, engine: plan.engine, sourceLabel: plan.sourceLabel }
    : { ok: false, engine: plan.engine, error: plan.error };
}

function parseSetupConfigBody(body: unknown): SetupConfigInput {
  if (!isRecord(body)) {
    throw new StudioHttpError(400, "Request body must be a JSON object.");
  }
  const databases = ["postgres", "mysql", "sqlite", "sqlserver", "prisma"] as const;
  const aiProviders = ["openai", "anthropic", "google", "azure"] as const;
  if (typeof body.database !== "string" || !databases.includes(body.database as (typeof databases)[number])) {
    throw new StudioHttpError(400, `\`database\` must be one of: ${databases.join(", ")}.`);
  }
  if (
    typeof body.aiProvider !== "string" ||
    !aiProviders.includes(body.aiProvider as (typeof aiProviders)[number])
  ) {
    throw new StudioHttpError(400, `\`aiProvider\` must be one of: ${aiProviders.join(", ")}.`);
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
    schemaOut: optionalString("schemaOut"),
  };
}

function saveConceptsDraft(state: StudioState, concepts: V2Concept[]): void {
  saveConcepts(requireWorkspace(state), { concepts });
  state.workspace = loadWorkspace(state.schemaDir);
}

function saveTenantPolicy(
  state: StudioState,
  frontmatter: TenantPolicyFrontmatter,
  body: string,
): void {
  const filePath = join(state.schemaDir, "tenant-policy.md");
  const md = writeTenantPolicyMarkdown(frontmatter, body);
  writeFileSync(filePath, md, "utf8");
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

  const frontmatter = buildFrontmatter(
    table.physical,
    workspace.physical.schemaId,
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

  saveTable(workspace, tableId, frontmatter, body);
  state.workspace = loadWorkspace(state.schemaDir);
}

async function suggestForSource(workspace: Workspace, source: SuggestSource): Promise<SuggestResponse["candidates"]> {
  const rt = getAskDbRuntimeConfig();
  const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);
  if (!model) {
    throw new StudioHttpError(400, ai.keyMissingMessage("AI enrichment suggestions"));
  }
  const candidates = await suggestEnrichment(
    buildSuggestionTarget(workspace, source),
    buildSuggestionContext(workspace, source.tableId),
    model,
  );
  return candidates.map((candidate) => ({ text: candidate.text }));
}

async function suggestTenantPolicyDraft(state: StudioState): Promise<SuggestTenantPolicyResponse> {
  const rt = getAskDbRuntimeConfig();
  const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);
  if (!model) {
    throw new StudioHttpError(400, ai.keyMissingMessage("AI tenant policy suggestion"));
  }

  // Build a compact DDL-like representation of the schema for the prompt
  const workspace = requireWorkspace(state);
  const schemaId = workspace.physical.schemaId;
  const schemaDdl = workspace.tables
    .map((t) => {
      const cols = t.physical.columns
        .map((c) => {
          const parts = [c.name, c.type];
          if (c.primaryKey) parts.push("PRIMARY KEY");
          if (!c.nullable) parts.push("NOT NULL");
          return `  ${parts.join(" ")}`;
        })
        .join(",\n");
      const rels = (t.physical.relationships ?? [])
        .map((r) => `  -- FK: ${r.from} -> ${r.to}`)
        .join("\n");
      return `CREATE TABLE ${t.physical.schema}.${t.physical.name} (\n${cols}\n);\n${rels}`.trim();
    })
    .join("\n\n");

  const tableIds = workspace.tables.map((t) => t.physical.id);

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
    system: systemPrompt,
    prompt: userPrompt,
  });

  let parsed: SuggestTenantPolicyResponse;
  try {
    parsed = JSON.parse(result.text) as SuggestTenantPolicyResponse;
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
  parsed.frontmatter = validation.data;

  return parsed;
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
      `${ai.keyMissingMessage("Sample NL-to-SQL generation")} Set ASKDB_MOCK_SQL to bypass the live model.`,
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

function pickEnv(env: AiEnv, key: string): string | undefined {
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
  const aiConfig = ai.resolveEmbeddingConfig(env, {
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

function buildStudioRagEmbeddingEnv(kind: string | undefined, base: AiEnv): AiEnv {
  const apiKeyOverride = pickEnv(base, "ASKDB_RAG_EMBEDDER_API_KEY");
  const baseUrlOverride = pickEnv(base, "ASKDB_RAG_EMBEDDER_BASE_URL");
  return {
    ...base,
    ...(kind === "openai" ? { ASKDB_AI_PROVIDER: "openai" } : {}),
    ...(apiKeyOverride ? { ASKDB_AI_API_KEY: apiKeyOverride } : {}),
    ...(baseUrlOverride ? { ASKDB_AI_BASE_URL: baseUrlOverride } : {}),
  };
}

function fallbackStudioRagProvider(kind: string | undefined, base: AiEnv): AiProvider {
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

// ---------------------------------------------------------------------------
// Playground history helpers
// ---------------------------------------------------------------------------

const HISTORY_MAX_STORED = 200;
const HISTORY_MAX_RETURNED = 50;

function playgroundHistoryPath(schemaDir: string): string {
  return join(schemaDir, "playground-history.json");
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
  writeFileSync(histPath, JSON.stringify(updated, null, 2), "utf8");
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
  writeFileSync(histPath, JSON.stringify(filtered, null, 2), "utf8");
  return { ok: true };
}

function parsePlaygroundHistoryEntry(
  body: unknown,
): Omit<PlaygroundHistoryEntry, "id" | "timestamp"> {
  if (!isRecord(body)) {
    throw new StudioHttpError(400, "Request body must be a JSON object.");
  }
  if (typeof body.question !== "string" || body.question.trim() === "") {
    throw new StudioHttpError(400, "`question` is required.");
  }
  if (body.mode !== "full" && body.mode !== "rag") {
    throw new StudioHttpError(400, "`mode` must be `full` or `rag`.");
  }
  if (typeof body.sqlMode !== "string") {
    throw new StudioHttpError(400, "`sqlMode` is required.");
  }
  if (typeof body.sql !== "string") {
    throw new StudioHttpError(400, "`sql` is required.");
  }
  return body as Omit<PlaygroundHistoryEntry, "id" | "timestamp">;
}

// ---------------------------------------------------------------------------
// Execute endpoint helpers
// ---------------------------------------------------------------------------

async function getExecuteStatus(schemaDir: string): Promise<ExecuteStatusResponse> {
  const rt = getAskDbRuntimeConfig();
  const { provider, databaseUrl, file } = rt.studio.execute;
  const def = EXECUTE_DRIVER_REGISTRY[provider];
  const projectRoot = findProjectRoot(schemaDir) ?? schemaDir;
  const installed = isDriverInstalled(def.packageName, projectRoot);
  const connectionKind: "url" | "file" = provider === "sqlite" ? "file" : "url";
  const configured = connectionKind === "file" ? Boolean(file) : Boolean(databaseUrl);
  return {
    provider,
    label: def.label,
    configured,
    connectionKind,
    packageName: def.packageName,
    installed,
    installCommand: def.installCommand,
    canInstallFromStudio: true,
    manualInstallReason: null,
  };
}

async function installExecuteDriver(
  body: unknown,
  schemaDir: string,
): Promise<ExecuteInstallDriverResponse> {
  const rt = getAskDbRuntimeConfig();
  const configuredProvider = rt.studio.execute.provider;

  // Accept the configured provider or an explicit allowlisted provider.
  let provider: StudioExecuteProvider = configuredProvider;
  if (isRecord(body) && typeof body.provider === "string") {
    const requested = body.provider as StudioExecuteProvider;
    if (!(requested in EXECUTE_DRIVER_REGISTRY)) {
      return {
        ok: false,
        provider: configuredProvider,
        packageName: EXECUTE_DRIVER_REGISTRY[configuredProvider].packageName,
        command: [],
        error: `Unknown provider: ${body.provider}`,
        installed: false,
      };
    }
    provider = requested;
  }

  const def = EXECUTE_DRIVER_REGISTRY[provider];
  const { packageManager, command, args, manualReason } = detectPackageManager(schemaDir, def.packageName);

  if (manualReason) {
    return {
      ok: false,
      provider,
      packageName: def.packageName,
      command: [],
      error: manualReason,
      installed: false,
    };
  }

  // Run the install.
  const { stdout, stderr, code } = await spawnCommand(command, args, schemaDir);
  const projectRoot = findProjectRoot(schemaDir) ?? schemaDir;
  const installed = isDriverInstalled(def.packageName, projectRoot);

  return {
    ok: code === 0,
    provider,
    packageName: def.packageName,
    command: [command, ...args],
    stdout,
    stderr,
    error: code !== 0 ? `${packageManager} exited with code ${code}` : undefined,
    installed,
  };
}

type PackageManagerDetection = {
  packageManager: string;
  command: string;
  args: string[];
  manualReason: string | null;
};

function detectPackageManager(cwd: string, packageName: string): PackageManagerDetection {
  // Walk up from schemaDir to find the project root's lockfile.
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return {
      packageManager: "",
      command: "",
      args: [],
      manualReason: `Could not locate a package.json above ${cwd}. Run the install manually.`,
    };
  }

  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    return {
      packageManager: "pnpm",
      command: "pnpm",
      args: ["add", packageName],
      manualReason: null,
    };
  }
  if (existsSync(join(projectRoot, "package-lock.json"))) {
    return {
      packageManager: "npm",
      command: "npm",
      args: ["install", packageName],
      manualReason: null,
    };
  }
  if (existsSync(join(projectRoot, "yarn.lock"))) {
    return {
      packageManager: "yarn",
      command: "yarn",
      args: ["add", packageName],
      manualReason: null,
    };
  }
  if (existsSync(join(projectRoot, "bun.lockb")) || existsSync(join(projectRoot, "bun.lock"))) {
    return {
      packageManager: "bun",
      command: "bun",
      args: ["add", packageName],
      manualReason: null,
    };
  }

  return {
    packageManager: "",
    command: "",
    args: [],
    manualReason: `No recognized lockfile found in ${projectRoot}. Run: pnpm add ${packageName}`,
  };
}

function findProjectRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
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
  const { provider, databaseUrl, file } = rt.studio.execute;

  if (!isRecord(body) || typeof body.sql !== "string" || body.sql.trim() === "") {
    return { ok: false, error: "`sql` is required." };
  }
  const sql = body.sql;
  const params = Array.isArray(body.params) ? body.params : [];

  const projectRoot = findProjectRoot(schemaDir) ?? schemaDir;
  const def = EXECUTE_DRIVER_REGISTRY[provider];
  return def.execute({ connectionString: databaseUrl, file, sql, params, projectRoot });
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
