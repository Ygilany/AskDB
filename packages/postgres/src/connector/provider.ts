import {
  runtimeIntrospectionString,
  type Connector,
  type ConnectorConfig,
  type ConnectorProviderAdapter,
  type ConnectorResult,
} from "@askdb/introspect";
import { createPostgresConnector } from "./index.js";
import { createPostgresCatalogQueryRunner } from "../exec/postgres.js";
import { redactConnectionString } from "../redact.js";

export const postgresConnectorProvider: ConnectorProviderAdapter = {
  provider: "postgres",
  createConnector(config: ConnectorConfig): ConnectorResult {
    if (config.fromExport) {
      return {
        mode: "from-export",
        input: { mode: "from-export", bundlePath: config.fromExport, filters: config.filters },
        connector: createPostgresConnector() as Connector<unknown>,
      };
    }
    if (!config.url) {
      throw new Error(
        "Postgres connector requires a connection URL (config.url) or an export bundle path (config.fromExport).",
      );
    }
    return {
      mode: "live",
      input: {
        mode: "live",
        runner: createPostgresCatalogQueryRunner(config.url),
        filters: config.filters,
      },
      connector: createPostgresConnector() as Connector<unknown>,
    };
  },
  getTemplates() {
    return createPostgresConnector().templates!();
  },
  /**
   * An explicit URL or export bundle wins; otherwise fall back to the
   * configured `introspection.providerConfig.postgres.databaseUrl`
   * (→ `ASKDB_INTROSPECT_POSTGRES_URL`, as resolved by `@askdb/config`).
   */
  resolveConnection({ explicit = {}, runtime, surface }) {
    let url = explicit.url;
    if (!url && !explicit.fromExport) {
      url = runtimeIntrospectionString(runtime, "postgresDatabaseUrl");
      if (!url) {
        return {
          ok: false,
          error:
            surface === "cli"
              ? "Provide either --url <postgres-url> or --from-export <bundle-dir>."
              : "No Postgres connection configured. Set introspection.providerConfig.postgres.databaseUrl in askdb.config.ts (bound to an env var in .env).",
        };
      }
    }
    if (explicit.schemaPath) {
      return { ok: false, error: "Use --prisma-schema only with --engine prisma." };
    }
    return {
      ok: true,
      connection: { url, fromExport: explicit.fromExport },
      sourceLabel: url ? redactConnectionString(url) : explicit.fromExport!,
    };
  },
  redactConnectionString,
};
