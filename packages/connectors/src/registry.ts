import type { Connector, IntrospectionFilters } from "@askdb/introspect";

export const ASKDB_CONNECTOR_PROVIDERS = [
  "postgres",
  "prisma",
  "mysql",
  "sqlite",
  "sqlserver",
] as const;

export type AskDbConnectorProvider = (typeof ASKDB_CONNECTOR_PROVIDERS)[number];

/**
 * Unified config passed to a connector provider adapter. The registry converts
 * this into the engine-specific connector + input pair consumed by `introspect()`.
 */
export type AskDbConnectorConfig = {
  provider: AskDbConnectorProvider;
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
export type AskDbConnectorResult = {
  connector: Connector<unknown>;
  input: unknown;
  /** Informational mode string (e.g. `"live"`, `"from-export"`, `"prisma-schema"`). */
  mode: string;
};

export type AskDbConnectorProviderAdapter = {
  provider: AskDbConnectorProvider;
  createConnector(config: AskDbConnectorConfig): AskDbConnectorResult;
};

export type AskDbConnectorProviderAdapters =
  | readonly AskDbConnectorProviderAdapter[]
  | Partial<Record<AskDbConnectorProvider, AskDbConnectorProviderAdapter>>;

export type AskDbConnectorRegistry = {
  hasProvider(provider: AskDbConnectorProvider): boolean;
  createConnector(config: AskDbConnectorConfig): AskDbConnectorResult;
};

export function createAskDbConnectorRegistry(
  adapters: AskDbConnectorProviderAdapters,
): AskDbConnectorRegistry {
  const byProvider = normalizeAdapters(adapters);

  function adapterFor(provider: AskDbConnectorProvider): AskDbConnectorProviderAdapter {
    const adapter = byProvider.get(provider);
    if (!adapter) throw new Error(askDbConnectorProviderMissingMessage(provider));
    return adapter;
  }

  return {
    hasProvider(provider) {
      return byProvider.has(provider);
    },
    createConnector(config) {
      return adapterFor(config.provider).createConnector(config);
    },
  };
}

export function askDbConnectorProviderMissingMessage(provider: AskDbConnectorProvider): string {
  const pkg =
    provider === "prisma"
      ? "@askdb/prisma"
      : provider === "sqlserver"
        ? "@askdb/sqlserver"
        : `@askdb/${provider}`;
  return (
    `Connector provider "${provider}" is not registered. ` +
    `Install ${pkg} and pass its connector provider adapter to createAskDbConnectorRegistry().`
  );
}

function normalizeAdapters(
  adapters: AskDbConnectorProviderAdapters,
): Map<AskDbConnectorProvider, AskDbConnectorProviderAdapter> {
  const entries = Array.isArray(adapters)
    ? adapters.map((a) => [a.provider, a] as const)
    : Object.entries(adapters).filter(isAdapterEntry);
  const byProvider = new Map<AskDbConnectorProvider, AskDbConnectorProviderAdapter>();
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
  entry: [string, AskDbConnectorProviderAdapter | undefined],
): entry is [AskDbConnectorProvider, AskDbConnectorProviderAdapter] {
  return entry[1] !== undefined;
}
