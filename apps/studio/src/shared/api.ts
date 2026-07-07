import type {
  NormalizedTenantPolicy,
  SchemaV2Warning,
  TenantBinding,
  TenantPolicyFrontmatter,
  TenantScope,
  TenantSqlOutputMode,
  V2Concept,
  V2ConceptsFrontmatter,
  V2Table,
} from "@askdb/core";
import type { SuggestSource, TableDraft } from "@askdb/enrich";
import type { ChunkType } from "@askdb/rag";

export type StudioTableDto = {
  physical: V2Table;
  filename: string;
  hasDescribableFile: boolean;
  draft: TableDraft;
  missingColumnIds: string[];
};

export type StudioWorkspaceDto = {
  schemaDir: string;
  /** Schema artifact path relative to the project root — usable in integration snippets. */
  schemaPathRelative: string;
  schemaId: string;
  /** Resolved NL-to-SQL dialect: config `dialect` → artifact provider → `postgres`. */
  dialect: string;
  warnings: SchemaV2Warning[];
  aiConfigured: boolean;
  model: string;
  aiProvider: string;
  tables: StudioTableDto[];
  concepts: V2Concept[];
  tenantPolicy: NormalizedTenantPolicy | null;
};

export type StudioErrorDto = {
  error: {
    message: string;
  };
};

export type SaveTableRequest = {
  draft: TableDraft;
};

export type SaveConceptsRequest = V2ConceptsFrontmatter;

export type SaveTenantPolicyRequest = {
  frontmatter: TenantPolicyFrontmatter;
  body?: string;
};

export type SuggestTenantPolicyResponse = {
  frontmatter: TenantPolicyFrontmatter;
  body: string;
};

export type SuggestRequest = {
  source: SuggestSource;
};

export type SuggestResponse = {
  candidates: Array<{ text: string }>;
};

export type StudioRagStatusDto = {
  schemaId: string;
  store: {
    kind: "file" | "memory" | "pgvector";
    basePath: string | null;
    table: string | null;
    indexStrategy: string | null;
  };
  embedder: {
    kind: "mock" | "ai-sdk";
    label: string;
    configured: boolean;
    expectedId: string;
    indexedId: string | null;
    provider: string | null;
    model: string | null;
    baseUrl: string | null;
  };
  embedderId: string;
  expectedEmbedderId: string;
  hasIndex: boolean;
  stale: boolean;
  updatedAt: string | null;
  chunksTotal: number;
  chunksIndexed: number;
  dimensions: number;
  expectedDimensions: number;
  sensitiveExcluded: number;
  sensitiveIncluded: number;
  files: {
    lock: boolean;
    embeddingsJson: boolean;
    embeddingsBin: boolean;
  };
};

export type RagIndexResponse = {
  status: StudioRagStatusDto;
  stats: {
    chunksTotal?: number;
    chunksIndexed?: number;
    chunksReused?: number;
    sensitiveExcluded?: number;
    sensitiveIncluded?: number;
  };
  usage: StudioRequestUsageDto | null;
};

export type RagQueryRequest = {
  question: string;
  k?: number;
  types?: ChunkType[];
};

export type StudioRagChunkDto = {
  id: string;
  score: number;
  type: ChunkType;
  refs: string[];
  sensitive: boolean;
  text: string;
};

export type RagQueryResponse = {
  question: string;
  k: number;
  results: StudioRagChunkDto[];
  usage: StudioRequestUsageDto | null;
};

export type AskRequest = {
  question: string;
  mode?: "full" | "rag";
  tenantScope?: TenantScope;
  tenantSqlMode?: TenantSqlOutputMode;
};

export type AskResponse = {
  sql: string;
  explain: unknown | null;
  warnings: SchemaV2Warning[];
  rag: {
    enabled: boolean;
    chunks: StudioRagChunkDto[];
  };
  tenant: {
    enabled: boolean;
    sqlMode: TenantSqlOutputMode | null;
    bindings: TenantBinding[];
    params: unknown[];
  } | null;
  usage: StudioRequestUsageDto | null;
};

export type StudioRequestUsageDto = {
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  embeddingTokens: number | null;
  requests: Array<{
    kind: "generation" | "embedding";
    totalTokens: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    embeddingTokens: number | null;
  }>;
};

export type PlaygroundHistoryEntry = {
  id: string;
  timestamp: string;          // ISO 8601
  question: string;
  mode: "full" | "rag";
  tenantScope?: unknown;       // TenantScope — use unknown to avoid importing core types here
  sqlMode: string;             // TenantSqlOutputMode
  sql: string;
  tenantParams?: Record<string, unknown>;
  explain?: string;
  executionResult?: {
    rowCount: number;
    durationMs: number;
    truncated: boolean;
    error?: string;
  };
  ragChunkIds?: string[];
};

export type PlaygroundHistoryDto = {
  entries: PlaygroundHistoryEntry[];
};

export type ExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

export type ExecuteStatusResponse = {
  provider: ExecuteProvider;
  label: string;
  configured: boolean;
  connectionKind: "url" | "file";
  packageName: string;
  installed: boolean;
  installCommand: string;
  canInstallFromStudio: boolean;
  manualInstallReason: string | null;
};

export type ExecuteInstallDriverRequest = {
  provider?: ExecuteProvider;
};

export type ExecuteInstallDriverResponse = {
  ok: boolean;
  provider: ExecuteProvider;
  packageName: string;
  command: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
  installed: boolean;
};

export type ExecuteRequest = {
  sql: string;
  params?: unknown[];
};

// ---------------------------------------------------------------------------
// Setup wizard + server-side introspection (resync)
// ---------------------------------------------------------------------------

export type SetupReason = "no-config" | "no-artifact";

export type SetupStatusDto = {
  needed: boolean;
  reason: SetupReason | null;
  projectDir: string;
  configPath: string | null;
  outputDir: string | null;
  /** Config exists but couldn't be loaded (e.g. project dependencies missing). */
  configLoadError: string | null;
};

export type SetupConfigRequest = {
  database: "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
  /** Env var NAME for the connection URL — values never travel through this API. */
  connectionEnv?: string;
  sqliteFile?: string;
  prismaSchema?: string;
  aiProvider: "openai" | "anthropic" | "google" | "azure";
  /** Env var NAME for the model API key — values never travel through this API. */
  aiKeyEnv?: string;
  schemaOut?: string;
};

export type SetupConfigResponse = {
  configPath: string;
  envExamplePath: string | null;
  envVars: Array<{ name: string; purpose: string; requiredForIntrospection: boolean }>;
  /** Packages the wizard installed into the project (null when nothing was needed). */
  installed: string[] | null;
  /** Set when automatic install wasn't possible — run this, then introspect. */
  manualInstallCommand: string | null;
  packageJsonCreated: boolean;
  status: SetupStatusDto;
};

export type IntrospectionPlanDto =
  | { ok: true; engine: string; sourceLabel: string }
  | { ok: false; engine: string | null; error: string };

export type IntrospectRunResponse = {
  ok: true;
  engine: string;
  schemaId: string;
  tables: number;
  warnings: string[];
  workspace: StudioWorkspaceDto;
};

export type ExecuteResponse =
  | { ok: true; columns: string[]; rows: unknown[][]; rowCount: number; durationMs: number; truncated: boolean }
  | { ok: false; error: string };
