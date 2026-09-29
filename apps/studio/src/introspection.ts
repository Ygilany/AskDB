import { basename } from "node:path";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  introspect,
  type Connector,
  type IntrospectResult,
} from "@askdb/introspect";
import {
  createConnectorRegistry,
  type ConnectorConfig,
  type ConnectorProvider,
} from "@askdb/connectors";
import {
  postgresConnectorProvider,
  connectionLabel as postgresConnectionLabel,
} from "@askdb/postgres";
import {
  mysqlConnectorProvider,
  connectionLabel as mysqlConnectionLabel,
} from "@askdb/mysql";
import {
  sqliteConnectorProvider,
  connectionLabel as sqliteConnectionLabel,
} from "@askdb/sqlite";
import {
  sqlServerConnectorProvider,
  connectionLabel as sqlServerConnectionLabel,
} from "@askdb/sqlserver";
import { prismaConnectorProvider } from "@askdb/prisma";

const connectorRegistry = createConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  prismaConnectorProvider,
]);

export type StudioIntrospectionPlan =
  | { ok: true; engine: ConnectorProvider; sourceLabel: string }
  | { ok: false; engine: ConnectorProvider | null; error: string };

/**
 * Resolve what a server-side introspection run would do, from the runtime
 * config alone. Mirrors the CLI's flag-free resolution in
 * `apps/cli/src/introspect.ts` (config provider + per-engine connection).
 * Never includes credentials in `sourceLabel` — it is shown in the UI.
 */
export function resolveStudioIntrospectionPlan(): StudioIntrospectionPlan {
  const rt = getAskDbRuntimeConfig();
  const engine = rt.introspection.provider as ConnectorProvider;
  if (!connectorRegistry.hasProvider(engine)) {
    return { ok: false, engine: null, error: `Unsupported introspection provider: ${engine}` };
  }
  const connection = resolveConnection(engine);
  if (!connection.ok) return { ok: false, engine, error: connection.error };
  return { ok: true, engine, sourceLabel: connection.sourceLabel };
}

type ConnectionResolution =
  | { ok: true; url?: string; schemaPath?: string; sourceLabel: string }
  | { ok: false; error: string };

function resolveConnection(engine: ConnectorProvider): ConnectionResolution {
  const rt = getAskDbRuntimeConfig();
  switch (engine) {
    case "postgres": {
      const url = rt.introspection.postgresDatabaseUrl;
      if (!url) {
        return {
          ok: false,
          error:
            "No Postgres connection configured. Set introspection.providerConfig.postgres.databaseUrl in askdb.config.ts (bound to an env var in .env).",
        };
      }
      return { ok: true, url, sourceLabel: labelFor(engine, url) };
    }
    case "mysql": {
      const url = rt.introspection.mysqlDatabaseUrl;
      if (!url) {
        return {
          ok: false,
          error:
            "No MySQL connection configured. Set introspection.providerConfig.mysql.databaseUrl in askdb.config.ts (bound to an env var in .env).",
        };
      }
      return { ok: true, url, sourceLabel: labelFor(engine, url) };
    }
    case "sqlserver": {
      const url = rt.introspection.sqlserverDatabaseUrl;
      if (!url) {
        return {
          ok: false,
          error:
            "No SQL Server connection configured. Set introspection.providerConfig.sqlserver.databaseUrl in askdb.config.ts (bound to an env var in .env).",
        };
      }
      return { ok: true, url, sourceLabel: labelFor(engine, url) };
    }
    case "sqlite": {
      const file = rt.introspection.sqliteFile;
      if (!file) {
        return {
          ok: false,
          error:
            "No SQLite file configured. Set introspection.providerConfig.sqlite.file in askdb.config.ts.",
        };
      }
      return { ok: true, url: file, sourceLabel: labelFor(engine, file) };
    }
    case "prisma": {
      // When unset, @askdb/prisma auto-discovers prisma/schema.prisma in the project root.
      const schemaPath = rt.introspection.prismaSchemaPath;
      return {
        ok: true,
        schemaPath,
        sourceLabel: schemaPath ?? "auto-discovered prisma/schema.prisma",
      };
    }
  }
}

/**
 * The credential-free label `GET /api/introspect/status` serves as
 * `sourceLabel`. Each engine package builds it from the parts of its own
 * connection-string formats that parse cleanly (host, port, database, or a
 * SQLite file path), never by masking the raw string; anything else becomes
 * `configured <engine> connection` (ADR 0011).
 */
function labelFor(provider: Exclude<ConnectorProvider, "prisma">, raw: string): string {
  switch (provider) {
    case "postgres":
      return postgresConnectionLabel(raw);
    case "mysql":
      return mysqlConnectionLabel(raw);
    case "sqlserver":
      return sqlServerConnectionLabel(raw);
    case "sqlite":
      return sqliteConnectionLabel(raw);
  }
}

export type StudioIntrospectionRun = {
  engine: ConnectorProvider;
  schemaId: string;
  tables: number;
  warnings: string[];
};

/**
 * Run introspection server-side into `outDir`, preserving any existing
 * enrichment markdown (the writer keeps `tables/*.md`, `concepts.md`, and
 * `tenant-policy.md` when `existingArtifactDir` is supplied — the same
 * guarantee `askdb introspect` gives).
 */
export async function runStudioIntrospection(options: {
  outDir: string;
  schemaId?: string;
  hasExistingArtifact: boolean;
}): Promise<StudioIntrospectionRun> {
  const plan = resolveStudioIntrospectionPlan();
  if (!plan.ok) throw new Error(plan.error);
  const connection = resolveConnection(plan.engine);
  if (!connection.ok) throw new Error(connection.error);

  const schemaId = options.schemaId ?? inferSchemaId(options.outDir);
  // Resync reads the same schema list `askdb introspect` does (introspection.schemas).
  const schemas = getAskDbRuntimeConfig().introspection.schemas;
  const connectorConfig: ConnectorConfig = {
    provider: plan.engine,
    url: connection.url,
    schemaPath: connection.schemaPath,
    schemaId,
    ...(schemas ? { filters: { schemas } } : {}),
  };
  const runConfig = connectorRegistry.createConnector(connectorConfig);
  const connector = runConfig.connector as Connector<unknown>;

  const result: IntrospectResult = await introspect(
    runConfig.input,
    {
      outDir: options.outDir,
      schemaId,
      existingArtifactDir: options.hasExistingArtifact ? options.outDir : undefined,
    },
    { connector },
  );

  return {
    engine: plan.engine,
    schemaId,
    tables: result.schema.schemas.reduce((sum, namespace) => sum + namespace.tables.length, 0),
    warnings: result.warnings.map((warning) =>
      typeof warning === "string" ? warning : JSON.stringify(warning),
    ),
  };
}

function inferSchemaId(path: string): string {
  const name = basename(path);
  const inferred = name.endsWith(".schema") ? name.slice(0, -".schema".length) : name;
  return inferred || "introspected";
}
