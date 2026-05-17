/**
 * Keep aligned with `ASKDB_MODES_V1` in `@askdb/core` (`packages/core/src/modes/types.ts`).
 */
export const ASKDB_MODES_V1 = ["schema_only", "bounded_results"] as const;
export type AskDbModeV1 = (typeof ASKDB_MODES_V1)[number];

/**
 * Keep aligned with Pino levels + `silent` (`@askdb/core` `SUPPORTED_ASKDB_LOG_LEVELS`).
 */
export const ASKDB_LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;
export type AskDbLogLevel = (typeof ASKDB_LOG_LEVELS)[number];

/** RAG embedder modes used by Studio / docs (CLI RAG currently supports mock + openai). */
export const ASKDB_RAG_EMBEDDERS = ["mock", "openai", "ai-sdk"] as const;
export type AskDbRagEmbedder = (typeof ASKDB_RAG_EMBEDDERS)[number];

export const ASKDB_RAG_STORES = ["file", "memory", "pgvector"] as const;
export type AskDbRagStore = (typeof ASKDB_RAG_STORES)[number];

export const ASKDB_AI_PROVIDERS = ["openai", "azure", "foundry"] as const;
export type AskDbAiProviderId = (typeof ASKDB_AI_PROVIDERS)[number];

export const ASKDB_INTROSPECTION_PROVIDERS = [
  "postgres",
  "prisma",
  "mysql",
  "sqlite",
  "sqlserver",
] as const;
export type AskDbIntrospectionProvider = (typeof ASKDB_INTROSPECTION_PROVIDERS)[number];

/**
 * NL→SQL dialect identifiers. Keep aligned with `DialectId` in `@askdb/core`
 * (`packages/core/src/sql/dialect-spec.ts`). Every id here must have a
 * shipped `DialectSpec`; this list authoritatively bounds `askdb.config.dialect`.
 */
export const ASKDB_DIALECTS = [
  "postgres",
  "cockroachdb",
  "mysql",
  "mariadb",
  "sqlite",
  "sqlserver",
] as const;
export type AskDbDialectId = (typeof ASKDB_DIALECTS)[number];
