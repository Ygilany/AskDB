export { extractSqlFromModelText, extractUnboundSqlFromModelText } from "./extract-sql.js";
export {
  bindPreparedQuery,
  escapeSqlLiteral,
  type QueryParameterType,
  type QueryParameterValue,
  type QueryParameterBinding,
  type PreparedQuery,
  type BoundQuery,
} from "./bind.js";
export {
  parseParameterManifest,
  type ParameterManifest,
  type ManifestParameter,
} from "./parameter-manifest.js";
export {
  generateSelectSql,
  type GenerateSelectSqlResult,
  type GenerateSqlDeps,
} from "./generate.js";
export {
  validateSelectSql,
  buildSelectGuardrailExplanation,
  type SelectGuardrailExplain,
} from "./validate.js";
export {
  buildNlToSqlUserPrompt,
  buildNlToSqlSystemPrompt,
} from "./prompt.js";
export {
  assertNlToSqlInputs,
  nlToSqlAmbiguityNotes,
} from "./schema-question-precheck.js";
export {
  type DialectId,
  type DialectSpec,
  type BuiltInDialectId,
  POSTGRES_DIALECT,
  COCKROACHDB_DIALECT,
  MYSQL_DIALECT,
  MARIADB_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  BUILT_IN_DIALECTS,
  SUPPORTED_DIALECT_IDS,
  isBuiltInDialectId,
  getDialectSpec,
} from "./dialect-spec.js";
