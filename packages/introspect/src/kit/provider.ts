import {
  runtimeIntrospectionString,
  type ConnectorProviderAdapter,
  type ConnectorProviderId,
} from "../registry.js";
import type { CatalogQueryRunner, Connector, IntrospectionFilters } from "../types.js";
import type { ConnectionLabelParts } from "./label.js";

/** Input shape of a live-only catalog connector: `{ mode: "live", runner, filters? }`. */
export type LiveCatalogInput = {
  mode: "live";
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
};

export type LiveConnectorProviderSpec = {
  provider: ConnectorProviderId;
  /** Engine name used in error messages, e.g. `"MySQL"`. */
  displayName: string;
  /**
   * Key in `runtime.introspection` (from `@askdb/config`) holding the configured
   * connection, e.g. `"mysqlDatabaseUrl"`. An explicit `url` always wins.
   */
  runtimeKey: string;
  /** What `config.url` holds, for the missing-url error: `"a connection URL"`, `"a file path"`. */
  connectionNoun: string;
  /**
   * Error when the caller passes an export bundle (`--from-export`), which a
   * live-only engine can't read. Defaults to
   * `--from-export is not supported for --engine <provider>.`
   */
  fromExportUnsupported?: string;
  /**
   * Error when neither an explicit URL nor a configured one exists: `cli` names
   * `askdb introspect` flags, `config` names `askdb.config.ts` keys.
   */
  missingConnection: { cli: string; config: string };
  createConnector(): Connector<LiveCatalogInput>;
  createRunner(url: string): CatalogQueryRunner;
  /**
   * The display-safe parts of a connection string (`{ host?, port?, database? }`
   * or `{ file }`), parsed by the engine's own rules, or `undefined` when it
   * doesn't parse cleanly. Becomes the adapter's `connectionLabelParts`; the
   * registry builds the label from it (ADR 0011).
   */
  connectionLabelParts(url: string): ConnectionLabelParts | undefined;
};

/**
 * Build the `ConnectorProviderAdapter` for an engine that introspects a live
 * database through a `CatalogQueryRunner` only (no export bundle, no schema
 * file) — the shape shared by `@askdb/mysql`, `@askdb/sqlite`, and
 * `@askdb/sqlserver`.
 */
export function defineLiveConnectorProvider(spec: LiveConnectorProviderSpec): ConnectorProviderAdapter {
  return {
    provider: spec.provider,
    createConnector(config) {
      if (!config.url) {
        throw new Error(`${spec.displayName} connector requires ${spec.connectionNoun} (config.url).`);
      }
      const input: LiveCatalogInput = {
        mode: "live",
        runner: spec.createRunner(config.url),
        filters: config.filters,
      };
      return { mode: "live", input, connector: spec.createConnector() as Connector<unknown> };
    },
    resolveConnection({ explicit = {}, runtime, surface }) {
      const url = explicit.url ?? runtimeIntrospectionString(runtime, spec.runtimeKey);
      if (!url) {
        return {
          ok: false,
          error: surface === "cli" ? spec.missingConnection.cli : spec.missingConnection.config,
        };
      }
      if (explicit.fromExport) {
        return {
          ok: false,
          error: spec.fromExportUnsupported ?? `--from-export is not supported for --engine ${spec.provider}.`,
        };
      }
      return { ok: true, connection: { url } };
    },
    connectionLabelParts({ url }) {
      return url === undefined ? undefined : spec.connectionLabelParts(url);
    },
  };
}
