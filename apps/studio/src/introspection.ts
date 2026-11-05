import { basename } from "node:path";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  connectorPackageMissingMessage,
  createConnectorRegistry,
  introspect,
  type Connector,
  type ConnectorConfig,
  type ConnectorConnectionResolution,
  type ConnectorProviderId,
  type IntrospectResult,
} from "@askdb/introspect";
import { createOptionalDriverLoader, rethrowDriverImportError } from "@askdb/introspect/kit";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";

/**
 * `@askdb/prisma` is an optional peer of Studio, as of `askdb` (#259). It is imported
 * only when the config selects the prisma engine, from Studio's install first, then
 * from the project in the working directory. The CLI registers it the same way.
 */
const prismaPackage = createOptionalDriverLoader({
  packageName: "@askdb/prisma",
  importDriver: () => import("@askdb/prisma").catch(rethrowDriverImportError),
  missingMessage: connectorPackageMissingMessage({
    provider: "prisma",
    packageName: "@askdb/prisma",
    allowBuilds: ["@prisma/engines"],
  }),
});

const connectorRegistry = createConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  { provider: "prisma", load: async () => (await prismaPackage.load()).prismaConnectorProvider },
]);

export type StudioIntrospectionPlan =
  | { ok: true; engine: ConnectorProviderId; sourceLabel: string }
  | { ok: false; engine: ConnectorProviderId | null; error: string };

/**
 * Resolve what a server-side introspection run would do, from the runtime
 * config alone: the config's provider (its adapter loaded), and the connection its adapter's
 * `resolveConnection` hook resolves (the same registry call the CLI makes).
 * Never includes credentials in `sourceLabel` — it is shown in the UI.
 */
export async function resolveStudioIntrospectionPlan(): Promise<StudioIntrospectionPlan> {
  const rt = getAskDbRuntimeConfig();
  const engine: ConnectorProviderId = rt.introspection.provider;
  if (!connectorRegistry.hasProvider(engine)) {
    return { ok: false, engine: null, error: `Unsupported introspection provider: ${engine}` };
  }
  try {
    // Imports an optional engine package (`@askdb/prisma`); a missing one is the plan's error.
    await connectorRegistry.load(engine);
  } catch (error) {
    return { ok: false, engine, error: error instanceof Error ? error.message : String(error) };
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
  const plan = await resolveStudioIntrospectionPlan();
  if (!plan.ok) throw new Error(plan.error);
  const connection = resolveConnection(plan.engine);
  if (!connection.ok) throw new Error(connection.error);

  const schemaId = options.schemaId ?? inferSchemaId(options.outDir);
  // Resync reads the same schema list `askdb introspect` does (introspection.schemas).
  const schemas = getAskDbRuntimeConfig().introspection.schemas;
  const connectorConfig: ConnectorConfig = {
    provider: plan.engine,
    ...connection.connection,
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
