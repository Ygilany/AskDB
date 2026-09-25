import { basename } from "node:path";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  createConnectorRegistry,
  introspect,
  type Connector,
  type ConnectorConfig,
  type ConnectorConnectionResolution,
  type ConnectorProviderId,
  type IntrospectResult,
} from "@askdb/introspect";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";
import { prismaConnectorProvider } from "@askdb/prisma";

const connectorRegistry = createConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  prismaConnectorProvider,
]);

export type StudioIntrospectionPlan =
  | { ok: true; engine: ConnectorProviderId; sourceLabel: string }
  | { ok: false; engine: ConnectorProviderId | null; error: string };

/**
 * Resolve what a server-side introspection run would do, from the runtime
 * config alone. Mirrors the CLI's flag-free resolution in
 * `apps/cli/src/introspect.ts` (config provider + per-engine connection).
 * Never includes credentials in `sourceLabel` — it is shown in the UI.
 */
export function resolveStudioIntrospectionPlan(): StudioIntrospectionPlan {
  const rt = getAskDbRuntimeConfig();
  const engine: ConnectorProviderId = rt.introspection.provider;
  if (!connectorRegistry.hasProvider(engine)) {
    return { ok: false, engine: null, error: `Unsupported introspection provider: ${engine}` };
  }
  const connection = resolveConnection(engine);
  if (!connection.ok) return { ok: false, engine, error: connection.error };
  return { ok: true, engine, sourceLabel: connection.sourceLabel };
}

/**
 * The engine's adapter resolves its connection from askdb.config/env (the same
 * hook the CLI uses) and phrases missing-config errors in terms of config keys.
 */
function resolveConnection(engine: ConnectorProviderId): ConnectorConnectionResolution {
  return connectorRegistry.resolveConnection(engine, {
    runtime: getAskDbRuntimeConfig(),
    surface: "studio",
  });
}

/**
 * Strip credentials from a connection string for display (never shown raw in
 * the UI). Dispatches to the engine adapter's `redactConnectionString()`, which
 * knows that engine's formats (URL userinfo, `?password=`, ADO.NET
 * `Password=`/`Pwd=`, JDBC-style `;password=`, libpq `password=`). Unknown
 * providers fall back to generic redaction of URL userinfo and secret
 * `key=value` pairs. Exported for tests.
 */
export function redactUrl(provider: ConnectorProviderId, raw: string): string {
  return connectorRegistry.redactConnectionString(provider, raw);
}

export type StudioIntrospectionRun = {
  engine: ConnectorProviderId;
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
  const connectorConfig: ConnectorConfig = {
    provider: plan.engine,
    ...connection.connection,
    schemaId,
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
