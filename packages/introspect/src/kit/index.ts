/**
 * `@askdb/introspect/kit` — shared building blocks for engine integration
 * packages (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`,
 * `@askdb/sqlserver`, `@askdb/prisma`, and third-party engines).
 *
 * Nothing here is engine-specific: catalog SQL, row shapes, and dialect rules
 * stay in each engine package. The kit only removes the mechanical code every
 * engine would otherwise copy — optional-driver loading, table-glob filters,
 * Schema v2 IDs, catalog-row folding, connection-string redaction, and the
 * connector-provider adapter for live-catalog-only engines.
 */

export {
  createOptionalDriverLoader,
  isDriverInstalled,
  isModuleResolutionFailure,
  missingDriverMessage,
  type DriverLoadOptions,
  type OptionalDriverLoader,
  type OptionalDriverSpec,
} from "./driver.js";

export {
  ambiguousFilterWarnings,
  compileGlob,
  compileTableFilters,
  type GlobMatcher,
} from "./filters.js";

export { makeColumnId, makeTableId } from "./ids.js";

export {
  buildOrderedGroups,
  byName,
  groupBy,
  mapFkAction,
  rowsToRecords,
  sortedUnique,
  type RowsToRecordsOptions,
} from "./rows.js";

export {
  defineLiveConnectorProvider,
  type LiveCatalogInput,
  type LiveConnectorProviderSpec,
} from "./provider.js";

export {
  REDACTED_SECRET,
  hasUrlScheme,
  isSecretConnectionKey,
  redactConnectionStringGeneric,
  redactSecretKeyValues,
  redactUrlUserinfo,
  type RedactKeyValueOptions,
} from "./redact.js";
