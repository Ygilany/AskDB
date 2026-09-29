import type { Connector, IntrospectionFilters, SqlTemplateBundle } from "@askdb/introspect";
import { formatConnectionLabel, type ConnectionLabelParts } from "./label.js";

export const CONNECTOR_PROVIDERS = [
  "postgres",
  "prisma",
  "mysql",
  "sqlite",
  "sqlserver",
] as const;

export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

/**
 * Unified config passed to a connector provider adapter. The registry converts
 * this into the engine-specific connector + input pair consumed by `introspect()`.
 */
export type ConnectorConfig = {
  provider: ConnectorProvider;
  /** Connection URL for live introspection (postgres, mysql, sqlserver) or file path (sqlite). */
  url?: string;
  /** Bundle directory path for from-export mode (postgres only). */
  fromExport?: string;
  /** Prisma schema file path or directory containing `.prisma` files (prisma only). */
  schemaPath?: string;
  filters?: IntrospectionFilters;
  /** Schema ID embedded in the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

/** Connector + typed input pair returned by a provider adapter. */
export type ConnectorResult = {
  connector: Connector<unknown>;
  input: unknown;
  /** Informational mode string (e.g. `"live"`, `"from-export"`, `"prisma-schema"`). */
  mode: string;
};

/** Where a connection comes from: the source fields of `ConnectorConfig`. */
export type ConnectorConnection = Pick<ConnectorConfig, "url" | "fromExport" | "schemaPath">;

export type ConnectorProviderAdapter = {
  provider: ConnectorProvider;
  createConnector(config: ConnectorConfig): ConnectorResult;
  /** Returns the engine's catalog SQL template bundle, if the engine supports it. */
  getTemplates?(): SqlTemplateBundle;
  /**
   * The parts of `connection` that are safe to display (host, port, database,
   * or a file path), parsed by the engine's own rules; `undefined` when the
   * connection doesn't parse cleanly. The registry turns them into the label
   * with `formatConnectionLabel`, so an adapter never supplies label text
   * itself (ADR 0011).
   */
  connectionLabelParts?(connection: ConnectorConnection): ConnectionLabelParts | undefined;
};

export type ConnectorProviderAdapters =
  | readonly ConnectorProviderAdapter[]
  | Partial<Record<ConnectorProvider, ConnectorProviderAdapter>>;

export type ConnectorRegistry = {
  hasProvider(provider: ConnectorProvider): boolean;
  createConnector(config: ConnectorConfig): ConnectorResult;
  /**
   * Returns the catalog SQL template bundle for the given provider, or `undefined`
   * if the provider is not registered or does not support templates.
   */
  getTemplates(provider: ConnectorProvider): SqlTemplateBundle | undefined;
  /**
   * A credential-free label for a connection, safe to show in a UI or log:
   * `formatConnectionLabel(provider, parts)` over the adapter's
   * `connectionLabelParts`. A provider that is not registered, has no hook, or
   * returns `undefined` gets `configured <provider> connection`.
   */
  connectionLabel(provider: ConnectorProvider, connection: ConnectorConnection): string;
};

export function createConnectorRegistry(
  adapters: ConnectorProviderAdapters,
): ConnectorRegistry {
  const byProvider = normalizeAdapters(adapters);

  function adapterFor(provider: ConnectorProvider): ConnectorProviderAdapter {
    const adapter = byProvider.get(provider);
    if (!adapter) throw new Error(connectorProviderMissingMessage(provider));
    return adapter;
  }

  return {
    hasProvider(provider) {
      return byProvider.has(provider);
    },
    createConnector(config) {
      return adapterFor(config.provider).createConnector(config);
    },
    getTemplates(provider) {
      return byProvider.get(provider)?.getTemplates?.();
    },
    connectionLabel(provider, connection) {
      try {
        return formatConnectionLabel(provider, byProvider.get(provider)?.connectionLabelParts?.(connection));
      } catch {
        // A throwing parser, or parts whose getter or Proxy trap throws while
        // being read, get the fallback. The message may quote the connection
        // string, so it must never become user-visible text.
        return formatConnectionLabel(provider, undefined);
      }
    },
  };
}

export function connectorProviderMissingMessage(provider: ConnectorProvider): string {
  const pkg =
    provider === "prisma"
      ? "@askdb/prisma"
      : provider === "sqlserver"
        ? "@askdb/sqlserver"
        : `@askdb/${provider}`;
  return (
    `Connector provider "${provider}" is not registered. ` +
    `Install ${pkg} and pass its connector provider adapter to createConnectorRegistry().`
  );
}

function normalizeAdapters(
  adapters: ConnectorProviderAdapters,
): Map<ConnectorProvider, ConnectorProviderAdapter> {
  const entries = Array.isArray(adapters)
    ? adapters.map((a) => [a.provider, a] as const)
    : Object.entries(adapters).filter(isAdapterEntry);
  const byProvider = new Map<ConnectorProvider, ConnectorProviderAdapter>();
  for (const [provider, adapter] of entries) {
    if (adapter.provider !== provider) {
      throw new Error(
        `Connector provider adapter mismatch: registry key "${provider}" points to adapter "${adapter.provider}".`,
      );
    }
    byProvider.set(provider, adapter);
  }
  return byProvider;
}

function isAdapterEntry(
  entry: [string, ConnectorProviderAdapter | undefined],
): entry is [ConnectorProvider, ConnectorProviderAdapter] {
  return entry[1] !== undefined;
}
