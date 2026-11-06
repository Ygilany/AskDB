import { setEnvKey as set } from "./ai-env.js";
import { DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS } from "./defaults.js";
import { pgvectorIndexStrategy, resolveAskDbConfig, type ResolvedAskDbConfig } from "./resolve.js";
import type { AskDbConfig } from "./types.js";

/** A string the config sets, else `undefined`; the resolver has already refused any other type. */
function configured(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The flat map: the canonical env keys for a resolved config, for the runtime snapshot and for a
 * child process's env. Every value comes from `resolved`, which has checked it. `config` only says
 * which optional keys the file sets: `PORT`, `HOST`, `ASKDB_HTTP_REQUEST_TIMEOUT_MS` and the
 * `studio.execute` keys are written only then, so a child process's env gets no defaults. It also
 * supplies `host` and `studio.listen`, which have no runtime section.
 */
export function flattenResolvedAskDbConfig(resolved: ResolvedAskDbConfig, config: AskDbConfig): Record<string, string> {
  const out: Record<string, string> = {};

  // --- AI ---
  Object.assign(out, resolved.ai.language.env);

  // --- Introspection --- (each engine's connection is set only when it is the active provider)
  const intro = resolved.introspection;
  set(out, "ASKDB_INTROSPECT_POSTGRES_URL", intro.postgresDatabaseUrl);
  set(out, "ASKDB_INTROSPECT_MYSQL_URL", intro.mysqlDatabaseUrl);
  set(out, "ASKDB_INTROSPECT_SQLITE_FILE", intro.sqliteFile);
  set(out, "ASKDB_INTROSPECT_SQLSERVER_URL", intro.sqlserverDatabaseUrl);
  // The Prisma schema path has no flat key: @askdb/prisma reads it from the structured config.
  set(out, "ASKDB_INTROSPECT_OUT", intro.outputDir);
  set(out, "ASKDB_INTROSPECT_SCHEMAS", intro.schemas?.join(","));

  // --- RAG ---
  const embedding = resolved.ai.embedding;
  set(out, "ASKDB_RAG_EMBEDDER", embedding ? "ai" : "mock");
  if (embedding) {
    set(out, "ASKDB_RAG_EMBEDDER_MODEL", embedding.model);
    if (embedding.dimensions !== undefined) set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(embedding.dimensions));
  }
  const { store, storeConfig } = resolved.rag;
  if (store === "file") {
    set(out, "ASKDB_RAG_FILE_BASE_PATH", configured(storeConfig.file?.basePath));
  } else if (store === "pgvector") {
    const pgvector = storeConfig.pgvector;
    set(out, "ASKDB_PGVECTOR_URL", configured(pgvector?.databaseUrl));
    // With `rag.embedder: "ai"` this is only a size to request: unset, the model's own width
    // applies, learned at index time. The mock embedder's vectors are always 64 wide.
    const width = embedding ? embedding.dimensions : DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS;
    if (width !== undefined) set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(width));
    set(out, "ASKDB_PGVECTOR_INDEX_STRATEGY", pgvectorIndexStrategy(pgvector?.indexStrategy));
  }

  // --- Logging ---
  const logging = resolved.logging;
  set(out, "ASKDB_LOG_LEVEL", logging.level);
  set(out, "ASKDB_CORRELATION_ID", logging.correlationId);
  set(out, "ASKDB_LOG_FILE", logging.logFile);
  if (logging.logStdout) set(out, "ASKDB_LOG_STDOUT", "true");

  // --- Modes ---
  set(out, "ASKDB_MODE", resolved.modes.askdbMode);
  if (resolved.modes.omitSensitiveFromPrompt) set(out, "ASKDB_OMIT_SENSITIVE_FROM_PROMPT", "true");

  // --- Host --- (no runtime section: `createAskDb` reads `structured.host`)
  set(out, "ASKDB_SCHEMA_PATH", configured(config.host?.schemaPath));
  set(out, "ASKDB_SCHEMA_JSON", configured(config.host?.schemaJson));

  // --- Dev ---
  set(out, "ASKDB_MOCK_SQL", resolved.dev.mockSql);

  // --- Studio listen --- (no runtime section: Studio reads `structured.studio.listen` and checks the port when it starts)
  const studioListen = config.studio?.listen;
  if (studioListen?.host) set(out, "ASKDB_STUDIO_HOST", configured(studioListen.host));
  if (studioListen?.port !== undefined && !Number.isNaN(studioListen.port)) {
    set(out, "ASKDB_STUDIO_PORT", String(studioListen.port));
  }

  // --- Studio execute --- (only the keys the config sets)
  const authoredExecute = config.studio?.execute;
  const execute = resolved.studio.execute;
  if (configured(authoredExecute?.provider)?.trim()) set(out, "ASKDB_STUDIO_EXECUTE_PROVIDER", execute.provider);
  set(out, "ASKDB_STUDIO_DATABASE_URL", configured(authoredExecute?.databaseUrl));
  set(out, "ASKDB_STUDIO_SQLITE_FILE", configured(authoredExecute?.file));
  if (authoredExecute?.enabled !== undefined) set(out, "ASKDB_STUDIO_EXECUTE_ENABLED", String(execute.enabled));
  if (authoredExecute?.useIntrospectionConnection !== undefined) {
    set(out, "ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION", String(execute.useIntrospectionConnection));
  }
  if (authoredExecute?.timeoutMs !== undefined) set(out, "ASKDB_STUDIO_EXECUTE_TIMEOUT_MS", String(execute.timeoutMs));
  if (authoredExecute?.maxRows !== undefined) set(out, "ASKDB_STUDIO_EXECUTE_MAX_ROWS", String(execute.maxRows));

  // --- HTTP API --- (listen and the timeout only when the config sets them)
  const httpApi = resolved.httpApi;
  const authoredListen = config.httpApi?.listen;
  if (authoredListen?.port !== undefined && !Number.isNaN(authoredListen.port)) set(out, "PORT", String(httpApi.listen.port));
  if (configured(authoredListen?.host)?.trim()) set(out, "HOST", httpApi.listen.host);
  if (httpApi.allowSchemaOverride) set(out, "ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE", "true");
  if (config.httpApi?.requestTimeoutMs !== undefined) {
    set(out, "ASKDB_HTTP_REQUEST_TIMEOUT_MS", String(httpApi.requestTimeoutMs));
  }

  return out;
}

/**
 * Flattens a nested {@link AskDbConfig} into the canonical env keys of the runtime snapshot
 * (`AskDbEnvProjection.entries`), for example to build a child process's env. Resolves the
 * config first, so it throws the same `askdb.config: …` errors as `defineConfig`.
 */
export function flattenAskDbConfig(config: AskDbConfig): Record<string, string> {
  return flattenResolvedAskDbConfig(resolveAskDbConfig(config).resolved, config);
}
