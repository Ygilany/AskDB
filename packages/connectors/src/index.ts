export {
  createConnectorRegistry,
  connectorProviderMissingMessage,
  CONNECTOR_PROVIDERS,
  type ConnectorProvider,
  type ConnectorConfig,
  type ConnectorConnection,
  type ConnectorResult,
  type ConnectorProviderAdapter,
  type ConnectorProviderAdapters,
  type ConnectorRegistry,
} from "./registry.js";

// Moved to `@askdb/introspect/kit`; re-exported here for compatibility.
export {
  formatConnectionLabel,
  parseConnectionUrl,
  type ConnectionLabelParts,
} from "@askdb/introspect/kit";
