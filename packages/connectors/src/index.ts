/**
 * `@askdb/connectors` — deprecated compatibility shim.
 *
 * The connector provider registry now lives in `@askdb/introspect` (with open
 * provider ids and the `resolveConnection` / `redactConnectionString` adapter
 * hooks), and the redaction helpers live in `@askdb/introspect/kit`. See
 * docs/adrs/0008-engine-packages-and-connector-registry.md. Everything here is
 * a re-export of those, kept so existing imports keep working.
 *
 * @deprecated Import from `@askdb/introspect` / `@askdb/introspect/kit` instead.
 */

import {
  BUILT_IN_CONNECTOR_PROVIDERS,
  type ConnectorProviderId,
} from "@askdb/introspect";

export {
  createConnectorRegistry,
  connectorProviderMissingMessage,
  BUILT_IN_CONNECTOR_PROVIDERS,
  type BuiltInConnectorProvider,
  type ConnectorConfig,
  type ConnectorConnection,
  type ConnectorConnectionRequest,
  type ConnectorConnectionResolution,
  type ConnectorProviderAdapter,
  type ConnectorProviderAdapters,
  type ConnectorProviderId,
  type ConnectorRegistry,
  type ConnectorResult,
  type ConnectorRuntimeConfig,
} from "@askdb/introspect";

/** @deprecated Use `BUILT_IN_CONNECTOR_PROVIDERS` from `@askdb/introspect`. */
export const CONNECTOR_PROVIDERS = BUILT_IN_CONNECTOR_PROVIDERS;

/**
 * @deprecated Use `ConnectorProviderId` from `@askdb/introspect`. Now an open
 * string type (built-in ids kept for autocompletion) so third-party engines
 * can register their own ids.
 */
export type ConnectorProvider = ConnectorProviderId;

/** @deprecated Import from `@askdb/introspect/kit`. */
export {
  REDACTED_SECRET,
  hasUrlScheme,
  isSecretConnectionKey,
  redactConnectionStringGeneric,
  redactSecretKeyValues,
  redactUrlUserinfo,
  type RedactKeyValueOptions,
} from "@askdb/introspect/kit";
