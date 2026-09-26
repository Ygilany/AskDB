/**
 * `@askdb/fixture-multi-engine`: the shared multi-engine test fixture.
 *
 * Package integration tests import this by relative path (like
 * scripts/test-utils/integration.mjs), gate on {@link FIXTURE_HOST_ENV}, and use
 * {@link connectionUrl} / {@link SQLITE_FILE} to reach the seeded databases.
 * No database driver is imported from here; seeding lives in src/seed.ts.
 */
export { DIALECTS, FIXTURE_HOST_ENV, LOGICAL_SCHEMAS, SQLITE_FILE, connectionUrl, type Dialect, type Role } from "./env.js";
export { loadLogicalSchema, loadRows, logicalTypeOf, physicalName, quoteIdent, type LogicalSchema, type LogicalTable } from "./dataset.js";
export { compareToLogicalSchema, normalizeNativeType, type CompareOptions, type SchemaJson } from "./schema-compare.js";
export { normalizeRows, normalizeValue, type LogicalType } from "./normalize.js";
