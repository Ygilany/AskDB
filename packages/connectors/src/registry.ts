import type { Connector, IntrospectionFilters, SqlTemplateBundle } from "@askdb/introspect";

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

export type ConnectorProviderAdapter = {
  provider: ConnectorProvider;
  createConnector(config: ConnectorConfig): ConnectorResult;
  /** Returns the engine's catalog SQL template bundle, if the engine supports it. */
  getTemplates?(): SqlTemplateBundle;
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
