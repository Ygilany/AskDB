import { formatConnectionLabel, type ConnectionLabelParts } from "./kit/label.js";
import type { Connector, IntrospectionFilters, SqlTemplateBundle } from "./types.js";

/** Provider ids of the first-party engine packages (`@askdb/<id>`). */
export const BUILT_IN_CONNECTOR_PROVIDERS = [
  "postgres",
  "prisma",
  "mysql",
  "sqlite",
  "sqlserver",
] as const;

export type BuiltInConnectorProvider = (typeof BUILT_IN_CONNECTOR_PROVIDERS)[number];

/**
 * A connector provider id. Open: any string is valid, so a third-party engine
 * package registers its own id without editing AskDB. The built-in ids stay in
 * the type for editor autocompletion.
 */
export type ConnectorProviderId = BuiltInConnectorProvider | (string & {});

/**
 * Unified config passed to a connector provider adapter. The registry converts
 * this into the engine-specific connector + input pair consumed by `introspect()`.
 */
export type ConnectorConfig = {
  provider: ConnectorProviderId;
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

/** Where a connection comes from: the three `ConnectorConfig` source fields. */
export type ConnectorConnection = Pick<ConnectorConfig, "url" | "fromExport" | "schemaPath">;

/**
 * The AskDB runtime configuration an adapter resolves its connection from.
 * Structurally typed so engine packages need not depend on `@askdb/config`;
 * pass `getAskDbRuntimeConfig()` from `@askdb/config` as-is.
 */
export type ConnectorRuntimeConfig = {
  /**
   * Resolved introspection values (`getAskDbRuntimeConfig().introspection`),
   * e.g. `postgresDatabaseUrl`, `sqliteFile`, `prismaSchemaPath` — config file
   * first, then the engine's env var, as resolved by `@askdb/config`.
   */
  readonly introspection: Readonly<Record<string, unknown>>;
  /**
   * The authoring-time config (`getAskDbRuntimeConfig().structured`). Engines
   * without a first-class runtime field read their own block from
   * `structured.introspection.providerConfig.<id>` here: `@askdb/config` passes
   * it through unchanged, though its typed config doesn't declare third-party
   * ids yet.
   */
  readonly structured?: unknown;
};

export type ConnectorConnectionRequest = {
  /** Values the caller passed explicitly (e.g. CLI flags). They take precedence over config. */
  explicit?: ConnectorConnection;
  /** AskDB runtime configuration to fall back to. */
  runtime: ConnectorRuntimeConfig;
  /**
   * The surface asking, so errors can point at the right fix: `"cli"` names
   * `askdb introspect` flags; anything else (e.g. `"studio"`) names config keys.
   */
  surface?: "cli" | "studio" | (string & {});
};

/**
 * What an adapter's `resolveConnection` returns: the connection, or an error.
 * The error is shown to users as-is, so it must never echo the connection
 * string. There is no label here: the registry builds it (ADR 0011).
 */
export type ConnectorConnectionResult =
  | { ok: true; connection: ConnectorConnection }
  | { ok: false; error: string };

/** What `registry.resolveConnection` returns: the adapter's result plus the registry-built label. */
export type ConnectorConnectionResolution =
  | {
      ok: true;
      connection: ConnectorConnection;
      /**
       * Credential-free description of the source, safe to show in a UI or log:
       * `registry.connectionLabel(provider, connection)`.
       */
      sourceLabel: string;
    }
  | { ok: false; error: string };

export type ConnectorProviderAdapter = {
  provider: ConnectorProviderId;
  createConnector(config: ConnectorConfig): ConnectorResult;
  /** Returns the engine's catalog SQL template bundle, if the engine supports it. */
  getTemplates?(): SqlTemplateBundle;
  /**
   * Turn explicit values + AskDB runtime config into this engine's connection
   * (URL, export bundle, or schema path), applying the engine's precedence and
   * validation. Hosts (CLI, Studio) call this instead of switching on the engine.
   * When omitted, the registry passes `explicit` through unchanged.
   */
  resolveConnection?(request: ConnectorConnectionRequest): ConnectorConnectionResult;
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
  | Readonly<Record<string, ConnectorProviderAdapter | undefined>>;

export type ConnectorRegistry = {
  hasProvider(provider: string): boolean;
  /** Registered provider ids, in registration order. */
  providers(): ConnectorProviderId[];
  createConnector(config: ConnectorConfig): ConnectorResult;
  /**
   * Returns the catalog SQL template bundle for the given provider, or `undefined`
   * if the provider is not registered or does not support templates.
   */
  getTemplates(provider: string): SqlTemplateBundle | undefined;
  /**
   * Resolve a provider's connection via its adapter's `resolveConnection` hook
   * (or pass `explicit` through when the adapter has none), with `sourceLabel`
   * from `connectionLabel`. A blank explicit value (empty or whitespace-only)
   * counts as absent, so the configured connection applies. Throws when the
   * provider is not registered.
   */
  resolveConnection(provider: string, request: ConnectorConnectionRequest): ConnectorConnectionResolution;
  /**
   * A credential-free label for a connection, safe to show in a UI or log:
   * `formatConnectionLabel(provider, parts)` over the adapter's
   * `connectionLabelParts`. A provider that is not registered, has no hook, or
   * returns `undefined` gets `configured <provider> connection`.
   */
  connectionLabel(provider: string, connection: ConnectorConnection): string;
};

export function createConnectorRegistry(adapters: ConnectorProviderAdapters): ConnectorRegistry {
  const byProvider = normalizeAdapters(adapters);

  function adapterFor(provider: string): ConnectorProviderAdapter {
    const adapter = byProvider.get(provider);
    if (!adapter) throw new Error(connectorProviderMissingMessage(provider));
    return adapter;
  }

  return {
    hasProvider(provider) {
      return byProvider.has(provider);
    },
    providers() {
      return [...byProvider.keys()];
    },
    createConnector(config) {
      return adapterFor(config.provider).createConnector(config);
    },
    getTemplates(provider) {
      return byProvider.get(provider)?.getTemplates?.();
    },
    resolveConnection(provider, request) {
      const adapter = adapterFor(provider);
      // A blank explicit value (an empty form field or env var a host forwards)
      // is absent, so the configured connection still applies.
      const normalized: ConnectorConnectionRequest = { ...request, explicit: withoutBlankValues(request.explicit) };
      const result: ConnectorConnectionResult = adapter.resolveConnection
        ? adapter.resolveConnection(normalized)
        : { ok: true, connection: { ...normalized.explicit } };
      if (!result.ok) return result;
      return { ...result, sourceLabel: labelFor(adapter, provider, result.connection) };
    },
    connectionLabel(provider, connection) {
      return labelFor(byProvider.get(provider), provider, connection);
    },
  };
}

function labelFor(
  adapter: ConnectorProviderAdapter | undefined,
  provider: string,
  connection: ConnectorConnection,
): string {
  try {
    return formatConnectionLabel(provider, adapter?.connectionLabelParts?.(connection));
  } catch {
    // A throwing parser, or parts whose getter or Proxy trap throws while
    // being read, get the fallback. The message may quote the connection
    // string, so it must never become user-visible text.
    return formatConnectionLabel(provider, undefined);
  }
}

export function connectorProviderMissingMessage(provider: string): string {
  const install = (BUILT_IN_CONNECTOR_PROVIDERS as readonly string[]).includes(provider)
    ? `Install @askdb/${provider}`
    : "Install the package that provides it";
  return (
    `Connector provider "${provider}" is not registered. ` +
    `${install} and pass its connector provider adapter to createConnectorRegistry().`
  );
}

function withoutBlankValues(explicit: ConnectorConnection | undefined): ConnectorConnection | undefined {
  if (explicit === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(explicit).filter(([, value]) => typeof value !== "string" || value.trim() !== ""),
  ) as ConnectorConnection;
}

function normalizeAdapters(adapters: ConnectorProviderAdapters): Map<string, ConnectorProviderAdapter> {
  const entries: Array<readonly [string, ConnectorProviderAdapter]> = Array.isArray(adapters)
    ? (adapters as readonly ConnectorProviderAdapter[]).map((a) => [a.provider, a] as const)
    : Object.entries(adapters).filter(isAdapterEntry);
  const byProvider = new Map<string, ConnectorProviderAdapter>();
  for (const [provider, adapter] of entries) {
    if (adapter.provider !== provider) {
      throw new Error(
        `Connector provider adapter mismatch: registry key "${provider}" points to adapter "${adapter.provider}".`,
      );
    }
    // A second adapter for the same id would silently replace the first one.
    if (byProvider.has(provider)) {
      throw new Error(
        `Connector provider "${provider}" is registered twice. Pass one adapter per provider id to createConnectorRegistry().`,
      );
    }
    byProvider.set(provider, adapter);
  }
  return byProvider;
}

function isAdapterEntry(
  entry: [string, ConnectorProviderAdapter | undefined],
): entry is [string, ConnectorProviderAdapter] {
  return entry[1] !== undefined;
}

