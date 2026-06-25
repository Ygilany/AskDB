import type { AskDbDialectId, AskDbIntrospectionProvider, AskDbStudioExecuteProvider } from "./constants.js";
import { ASKDB_STUDIO_EXECUTE_PROVIDERS } from "./constants.js";
import type { AskDbConfig } from "./types.js";
import { DEFAULT_INTROSPECT_OUTPUT_DIR } from "./defaults.js";
import { flatToAiEnv, getAskDbRuntimeStore } from "./runtime-store.js";

/**
 * Typed AI runtime settings for `@askdb/core` (not `process.env`).
 */
export type AskDbRuntimeAiConfig = {
  /**
   * Flat env-shaped map built from the runtime snapshot. Pass to
   * `@askdb/ai` registry methods such as `resolveAiConfig` and
   * `createLanguageModelFromEnv`.
   */
  aiEnv: Record<string, string | undefined>;
};

export type AskDbRuntimeRagEmbedderConfig = {
  apiKey: string | undefined;
  baseURL: string | undefined;
  model: string | undefined;
};

export type AskDbRuntimeRagConfig = {
  embedder: AskDbRuntimeRagEmbedderConfig;
};

export type AskDbRuntimeLoggingConfig = {
  level: string | undefined;
  correlationId: string | undefined;
  logFile: string | undefined;
  logStdout: boolean;
};

export type AskDbRuntimeHttpApiConfig = {
  listen: {
    port: number;
    host: string;
  };
};

export type AskDbRuntimeIntrospectionConfig = {
  provider: AskDbIntrospectionProvider;
  /**
   * Resolved Postgres connection URL when `provider === "postgres"`:
   * `providerConfig.postgres.databaseUrl` → `ASKDB_INTROSPECT_POSTGRES_URL` env.
   * `undefined` for non-Postgres providers.
   */
  postgresDatabaseUrl: string | undefined;
  /** Resolved from `introspection.providerConfig.prisma.schemaPath`; `undefined` triggers auto-discovery in `@askdb/prisma`. */
  prismaSchemaPath: string | undefined;
  /**
   * Resolved MySQL connection URL when `provider === "mysql"`:
   * `providerConfig.mysql.databaseUrl` → `ASKDB_INTROSPECT_MYSQL_URL` env.
   * `undefined` for non-MySQL providers.
   */
  mysqlDatabaseUrl: string | undefined;
  /**
   * Resolved SQLite file path when `provider === "sqlite"`:
   * `providerConfig.sqlite.file` → `ASKDB_INTROSPECT_SQLITE_FILE` env.
   * `undefined` for non-SQLite providers.
   */
  sqliteFile: string | undefined;
  /**
   * Resolved SQL Server connection URL when `provider === "sqlserver"`:
   * `providerConfig.sqlserver.databaseUrl` → `ASKDB_INTROSPECT_SQLSERVER_URL` env.
   * `undefined` for non-SQL Server providers.
   */
  sqlserverDatabaseUrl: string | undefined;
  /** Resolved from `introspection.outputDir`; falls back to the package default (`./askdb/`). */
  outputDir: string;
};

export type AskDbRuntimeDevConfig = {
  mockSql: string | undefined;
};

export type AskDbRuntimeModesConfig = {
  askdbMode: string | undefined;
  omitSensitiveFromPrompt: boolean;
};

export type AskDbRuntimeNlToSqlConfig = {
  /**
   * Optional NL→SQL dialect override from `askdb.config.ts`. When set, hosts
   * (CLI / HTTP API / Studio) pass this to `ask({ dialect })` instead of
   * inferring from the introspection provider.
   */
  dialect: AskDbDialectId | undefined;
};

export type AskDbRuntimeStudioConfig = {
  execute: {
    /**
     * Resolved execute provider. Falls back to the active introspection provider when it
     * is a live engine (`postgres`, `mysql`, `sqlite`, `sqlserver`), then defaults to
     * `"postgres"` for backward compatibility.
     */
    provider: AskDbStudioExecuteProvider;
    /** Connection URL used by the Studio playground query runner for network databases. */
    databaseUrl: string | undefined;
    /** SQLite file path used when `provider === "sqlite"`. */
    file: string | undefined;
  };
};

/**
 * Typed runtime view over the bootstrapped AskDB config snapshot.
 */
export type AskDbRuntimeConfig = {
  readonly structured: Readonly<AskDbConfig>;
  /** Canonical flattened map (subprocess env via {@link mergeAskDbFlatIntoEnvMap}). */
  readonly flat: Readonly<Record<string, string>>;
  ai: AskDbRuntimeAiConfig;
  introspection: AskDbRuntimeIntrospectionConfig;
  rag: AskDbRuntimeRagConfig;
  logging: AskDbRuntimeLoggingConfig;
  httpApi: AskDbRuntimeHttpApiConfig;
  dev: AskDbRuntimeDevConfig;
  modes: AskDbRuntimeModesConfig;
  nlToSql: AskDbRuntimeNlToSqlConfig;
  studio: AskDbRuntimeStudioConfig;
};

function pickFlat(flat: Readonly<Record<string, string>>, key: string): string | undefined {
  const v = flat[key];
  if (v === undefined || v.trim() === "") return undefined;
  return v.trim();
}

/**
 * Returns typed runtime configuration from the snapshot installed by {@link bootstrapAskDbEnv}.
 */
export function getAskDbRuntimeConfig(): AskDbRuntimeConfig {
  const { structured, flat } = getAskDbRuntimeStore();
  const aiEnv = flatToAiEnv(flat);

  const logStdoutRaw = pickFlat(flat, "ASKDB_LOG_STDOUT");
  const logStdout = logStdoutRaw !== undefined && ["1", "true", "yes"].includes(logStdoutRaw.toLowerCase());

  const portRaw = pickFlat(flat, "PORT");
  const portParsed = portRaw !== undefined ? Number(portRaw) : NaN;
  const port =
    structured.httpApi?.listen?.port ??
    (!Number.isNaN(portParsed) ? portParsed : 3000);
  const host = structured.httpApi?.listen?.host ?? pickFlat(flat, "HOST") ?? "127.0.0.1";

  const omitRaw = pickFlat(flat, "ASKDB_OMIT_SENSITIVE_FROM_PROMPT");
  const omitFromFlat =
    omitRaw !== undefined && ["1", "true", "yes"].includes(omitRaw.toLowerCase());

  const prismaSchemaPathRaw =
    structured.introspection.provider === "prisma"
      ? structured.introspection.providerConfig?.prisma?.schemaPath?.trim()
      : undefined;

  // Per-engine connection lookup. We deliberately only resolve the field for
  // the active provider so the runtime view stays minimal and other branches
  // surface `undefined` (cheap exhaustiveness check at the consumer).
  const postgresDatabaseUrl =
    structured.introspection.provider === "postgres"
      ? structured.introspection.providerConfig?.postgres?.databaseUrl?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_POSTGRES_URL")
      : undefined;
  const mysqlDatabaseUrl =
    structured.introspection.provider === "mysql"
      ? structured.introspection.providerConfig?.mysql?.databaseUrl?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_MYSQL_URL")
      : undefined;
  const sqliteFile =
    structured.introspection.provider === "sqlite"
      ? structured.introspection.providerConfig?.sqlite?.file?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_SQLITE_FILE")
      : undefined;
  const sqlserverDatabaseUrl =
    structured.introspection.provider === "sqlserver"
      ? structured.introspection.providerConfig?.sqlserver?.databaseUrl?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_SQLSERVER_URL")
      : undefined;

  return {
    structured,
    flat,
    ai: {
      aiEnv,
    },
    introspection: {
      provider: structured.introspection.provider,
      postgresDatabaseUrl,
      prismaSchemaPath: prismaSchemaPathRaw || undefined,
      mysqlDatabaseUrl,
      sqliteFile,
      sqlserverDatabaseUrl,
      outputDir:
        pickFlat(flat, "ASKDB_INTROSPECT_OUT") ??
        structured.introspection.outputDir?.trim() ??
        DEFAULT_INTROSPECT_OUTPUT_DIR,
    },
    rag: {
      embedder: {
        apiKey:
          pickFlat(flat, "ASKDB_RAG_EMBEDDER_API_KEY") ??
          pickFlat(flat, "ASKDB_AI_API_KEY") ??
          pickFlat(flat, "OPENAI_API_KEY"),
        baseURL:
          pickFlat(flat, "ASKDB_RAG_EMBEDDER_BASE_URL") ??
          pickFlat(flat, "ASKDB_AI_BASE_URL") ??
          pickFlat(flat, "OPENAI_BASE_URL"),
        model: pickFlat(flat, "ASKDB_RAG_EMBEDDER_MODEL"),
      },
    },
    logging: {
      level: structured.logging?.level ?? pickFlat(flat, "ASKDB_LOG_LEVEL"),
      correlationId: structured.logging?.correlationId ?? pickFlat(flat, "ASKDB_CORRELATION_ID"),
      logFile: structured.logging?.logFile ?? pickFlat(flat, "ASKDB_LOG_FILE"),
      logStdout,
    },
    httpApi: {
      listen: { port, host },
    },
    dev: {
      mockSql: structured.dev?.mockSql ?? pickFlat(flat, "ASKDB_MOCK_SQL"),
    },
    modes: {
      askdbMode: structured.modes?.askdbMode ?? pickFlat(flat, "ASKDB_MODE"),
      omitSensitiveFromPrompt: Boolean(structured.modes?.omitSensitiveFromPrompt) || omitFromFlat,
    },
    nlToSql: {
      dialect: structured.dialect,
    },
    studio: {
      execute: resolveStudioExecuteConfig(structured, flat),
    },
  };
}

function resolveStudioExecuteConfig(
  structured: Readonly<AskDbConfig>,
  flat: Readonly<Record<string, string>>,
): AskDbRuntimeStudioConfig["execute"] {
  // 1. Explicit provider from structured config or env.
  const providerRaw =
    structured.studio?.execute?.provider ??
    pickFlat(flat, "ASKDB_STUDIO_EXECUTE_PROVIDER");

  let provider: AskDbStudioExecuteProvider;
  if (providerRaw !== undefined && (ASKDB_STUDIO_EXECUTE_PROVIDERS as ReadonlyArray<string>).includes(providerRaw)) {
    provider = providerRaw as AskDbStudioExecuteProvider;
  } else {
    // 2. Fall back to introspection provider when it is a live execute provider.
    const introspectionProvider = structured.introspection?.provider;
    if (introspectionProvider !== undefined && (ASKDB_STUDIO_EXECUTE_PROVIDERS as ReadonlyArray<string>).includes(introspectionProvider)) {
      provider = introspectionProvider as AskDbStudioExecuteProvider;
    } else {
      // 3. Default to postgres for backward compatibility.
      provider = "postgres";
    }
  }

  // Connection resolution — each provider draws from its own structured field
  // first, then the relevant flat env key.
  let databaseUrl: string | undefined;
  let file: string | undefined;

  if (provider === "postgres") {
    databaseUrl =
      structured.studio?.execute?.databaseUrl?.trim() ||
      pickFlat(flat, "ASKDB_STUDIO_DATABASE_URL") ||
      (structured.introspection?.provider === "postgres"
        ? structured.introspection.providerConfig?.postgres?.databaseUrl?.trim() ||
          pickFlat(flat, "ASKDB_INTROSPECT_POSTGRES_URL")
        : undefined);
  } else if (provider === "mysql") {
    databaseUrl =
      structured.studio?.execute?.databaseUrl?.trim() ||
      pickFlat(flat, "ASKDB_STUDIO_DATABASE_URL") ||
      (structured.introspection?.provider === "mysql"
        ? structured.introspection.providerConfig?.mysql?.databaseUrl?.trim() ||
          pickFlat(flat, "ASKDB_INTROSPECT_MYSQL_URL")
        : undefined);
  } else if (provider === "sqlserver") {
    databaseUrl =
      structured.studio?.execute?.databaseUrl?.trim() ||
      pickFlat(flat, "ASKDB_STUDIO_DATABASE_URL") ||
      (structured.introspection?.provider === "sqlserver"
        ? structured.introspection.providerConfig?.sqlserver?.databaseUrl?.trim() ||
          pickFlat(flat, "ASKDB_INTROSPECT_SQLSERVER_URL")
        : undefined);
  } else if (provider === "sqlite") {
    file =
      structured.studio?.execute?.file?.trim() ||
      pickFlat(flat, "ASKDB_STUDIO_SQLITE_FILE") ||
      (structured.introspection?.provider === "sqlite"
        ? structured.introspection.providerConfig?.sqlite?.file?.trim() ||
          pickFlat(flat, "ASKDB_INTROSPECT_SQLITE_FILE")
        : undefined);
  }

  return { provider, databaseUrl, file };
}
