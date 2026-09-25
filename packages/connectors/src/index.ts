export {
  createConnectorRegistry,
  connectorProviderMissingMessage,
  CONNECTOR_PROVIDERS,
  type ConnectorProvider,
  type ConnectorConfig,
  type ConnectorResult,
  type ConnectorProviderAdapter,
  type ConnectorProviderAdapters,
  type ConnectorRegistry,
} from "./registry.js";

// Moved to `@askdb/introspect/kit`; re-exported here for compatibility.
export {
  REDACTED_SECRET,
  hasUrlScheme,
  isSecretConnectionKey,
  redactConnectionStringGeneric,
  redactSecretKeyValues,
  redactUrlUserinfo,
  type RedactKeyValueOptions,
} from "@askdb/introspect/kit";
