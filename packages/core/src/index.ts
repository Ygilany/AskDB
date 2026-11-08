export * from "./errors.js";
export { validateTenantScope } from "./sql/tenant-scope-validate.js";
export { buildTenantPromptBlock } from "./sql/tenant-prompt.js";
export {
  validateTenantGuardrails,
  type TenantGuardrailResult,
  type ValidateTenantGuardrailsOptions,
} from "./sql/tenant-guardrail.js";
export {
  validateSensitiveReferences,
  schemaHasSensitiveIdentifiers,
  formatSensitiveReference,
  type SensitiveGuardrailMode,
  type SensitiveGuardrailResult,
  type ValidateSensitiveReferencesOptions,
} from "./sql/sensitive-guardrail.js";
export {
  DEFAULT_TENANT_SQL_MODE,
  resolveTenantSql,
  placeholderForTenantRoot,
  type TenantSqlOutputMode,
  type TenantPlaceholderResult,
  type TenantBinding,
  type TenantSqlDialect,
} from "./sql/tenant-placeholders.js";
export { expandClosure } from "./sql/tenant-hierarchy.js";
export { expandTenantScope } from "./sql/tenant-scope-expand.js";
export {
  ask,
  type AskPipelineOptions,
  type AskPipelineResult,
  type AskDialect,
  type AskDialectInput,
  type AskDialectGenerateOptions,
  type AskUsage,
  type AskDialectGenerateResult,
  type AskGenerateDeps,
  // Callback type for `ask({ resolveTenantDescendants })` (subtree tenant scopes).
  type ResolveTenantDescendants,
  type TenantIdsByRoot,
} from "./ask.js";
export {
  parseAskDbModeV1,
  formatAskDbModesV1,
  DEFAULT_ASKDB_MODE,
  ASKDB_MODES_V1,
  type AskDbModeV1,
} from "./modes/types.js";
export { AskDbLogEvent } from "./logging/log-events.js";
export type { AskDbLogger } from "./logging/askdb-logger.js";
export {
  ASKDB_LOG_REQUIRED_EVENTS,
  ASKDB_LOG_REQUIRED_FIELDS,
} from "./logging/log-contract.js";
export {
  createAskDbLogger,
  type AskDbLogLevel,
  type CreateAskDbLoggerOptions,
} from "./logging/create-askdb-logger.js";
export {
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  SUPPORTED_ASKDB_LOG_LEVELS,
} from "./logging/pino-supported-levels.js";
export { loadNormalizedSchemaFromJson } from "./schema/parse.js";
export type {
  AskDbSchemaFile,
  NormalizedSchema,
  AnyNormalizedSchema,
} from "./schema/types.js";
export {
  loadSchema,
  loadSchemaFromJson,
  readSchemaDirectory,
  parseTableMarkdown,
  parseConceptsMarkdown,
  writeTableMarkdown,
  writeConceptsMarkdown,
  writeTenantPolicyMarkdown,
  saveSchemaFile,
  formatSchemaV2ForNlToSql,
  v2SchemaJsonSchema,
  parseTenantPolicyMarkdown,
  normalizeTenantPolicy,
  formatTenantPolicyWarning,
  tenantPolicyFrontmatterSchema,
  tenantScopeSchema,
  createMentionMatcher,
  findMentionedNames,
  sensitiveMentionNames,
  type MentionMatcher,
  type MentionName,
} from "./schema/v2/index.js";
export type {
  V2SchemaJson,
  V2Table,
  V2Column,
  V2TableFrontmatter,
  V2ColumnFrontmatter,
  V2ConceptsFrontmatter,
  V2Concept,
  ParsedTableMarkdown,
  ParsedConceptsMarkdown,
  RecognizedH2Section,
  NormalizedSchemaV2,
  BundledSchemaV2,
  NormalizedV2Table,
  NormalizedV2Column,
  SchemaV2Warning,
  TenantPolicyFrontmatter,
  TenantRoot,
  HierarchyEdge,
  ScopedTable,
  ScopeThrough,
  PolymorphicTable,
  EnforcementMode,
  TenantScope,
  TenantAccess,
  TenantAccessIds,
  TenantAccessSubtree,
  TenantAccessMultiRoot,
  TenantAccessGlobal,
  TenantScopeContext,
  ParsedTenantPolicyMarkdown,
  NormalizedTenantPolicy,
  TenantPolicyWarning,
  TableCoverageEntry,
  TableTenantClassification,
  TenantPolicyH2Section,
} from "./schema/v2/index.js";
export { suggestEnrichment } from "./enrichment/index.js";
export type {
  EnrichmentCandidate,
  EnrichmentContext,
  EnrichmentPromptOptions,
  EnrichmentTarget,
  SuggestEnrichmentDeps,
} from "./enrichment/index.js";
export {
  formatSchemaForNlToSql,
  type FormatNlToSqlOptions,
  type NlToSqlSchemaFormatStats,
} from "./schema/normalize.js";
export { extractSqlFromModelText, extractUnboundSqlFromModelText } from "./sql/extract-sql.js";
export type {
  QueryParameterType,
  QueryParameterValue,
  QueryParamSlot,
  QueryParameterBinding,
  PreparedQuery,
} from "./sql/bind.js";
export { bindPreparedQuery, type BindGuardrails, type BoundQuery } from "./sql/rebind.js";
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
  SINGLE_NAMESPACE_LABEL,
  BUILT_IN_DIALECTS,
  SUPPORTED_DIALECT_IDS,
  isBuiltInDialectId,
  getDialectSpec,
} from "./sql/dialect-spec.js";
export {
  generateSelectSql,
  type GenerateSelectSqlResult,
  type GenerateSqlDeps,
} from "./sql/generate.js";
export {
  validateSelectSql,
  type SelectGuardrailExplain,
} from "./sql/validate.js";
export { buildNlToSqlUserPrompt } from "./sql/prompt.js";
// Internal: for @askdb/client/charts, no stability promise (see the core API page's internal exports).
export { maskSqlLiterals } from "./sql/mask-literals.js";
export { promptIdentifierQuoter } from "./sql/prompt-identifiers.js";
export { nlToSqlAmbiguityNotes } from "./sql/schema-question-precheck.js";
export {
  type AskDbLanguageModel,
} from "./ai/types.js";
export type {
  Retriever,
  RetrievedChunk,
  RetrievedChunkType,
  RetrievedResult,
} from "./retrieval/types.js";
export { synthesizeRetrievedDdl } from "./retrieval/synthesize-ddl.js";
