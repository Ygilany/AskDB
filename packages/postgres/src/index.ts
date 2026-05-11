/**
 * `@askdb/postgres` — Postgres integration for AskDB.
 *
 * Bundles four pieces:
 *   1. **Dialect** — `postgresDialect`, plus the underlying validate/generate functions.
 *   2. **Connector** — `createPostgresConnector()` for `@askdb/introspect`.
 *   3. **Templates** — `POSTGRES_TEMPLATE_BUNDLE` (catalog SQL suite for live + from-export modes).
 *   4. **Executor** — `createPostgresExecutor()` for the `pg` driver.
 */

export { postgresDialect } from "./dialect.js";
export type { PostgresDialect } from "./dialect.js";

export {
  generatePostgresSelectSql,
  type GeneratePostgresSelectSqlResult,
  type GenerateSqlDeps,
} from "./sql/generate.js";
export {
  validatePostgresSelectSql,
  buildPostgresSelectGuardrailExplanation,
  type PostgresSelectGuardrailExplain,
} from "./sql/validate.js";
export {
  buildNlToSqlUserPrompt,
  nlToSqlSystemPrompt,
} from "./sql/prompt.js";
export {
  assertNlToSqlInputs,
  nlToSqlAmbiguityNotes,
} from "./sql/schema-question-precheck.js";

export {
  createPostgresConnector,
  describePostgres,
  describePostgresFromExport,
  POSTGRES_TEMPLATE_BUNDLE,
  POSTGRES_TEMPLATE_VERSION,
  POSTGRES_TEMPLATES,
  type DescribePostgresInput,
  type DescribePostgresExportInput,
  type PostgresIntrospectionInput,
  type PostgresSqlTemplateName,
} from "./connector/index.js";

export {
  createPostgresExecutor,
  executeReadOnlySelect,
  type TabularResult,
} from "./exec/postgres.js";
