export * from "./errors.js";
export type { TabularResult } from "./exec/types.js";
export type { AskDbExecutor } from "./exec/executor.js";
export {
  ask,
  type AskPipelineOptions,
  type AskPipelineResult,
  type AskDialect,
  type AskDialectGenerateOptions,
  type AskDialectGenerateResult,
  type AskGenerateDeps,
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
export { loadNormalizedSchemaFromJson, parseAskDbSchemaJson } from "./schema/parse.js";
export type {
  AskDbSchemaFile,
  NormalizedSchema,
  AnyNormalizedSchema,
} from "./schema/types.js";
export {
  loadSchema,
  loadSchemaFromJson,
  parseTableMarkdown,
  parseConceptsMarkdown,
  writeTableMarkdown,
  writeConceptsMarkdown,
  formatSchemaV2ForNlToSql,
  v2SchemaJsonSchema,
  v2TableSchema,
  v2ColumnSchema,
  v2TableFrontmatterSchema,
  v2ColumnFrontmatterSchema,
  v2ConceptsFrontmatterSchema,
  v2ConceptSchema,
  RECOGNIZED_H2_SECTIONS,
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
  NormalizedV2Table,
  NormalizedV2Column,
  SchemaV2Warning,
} from "./schema/v2/index.js";
export {
  ENRICHMENT_SYSTEM_PROMPT,
  buildEnrichmentUserPrompt,
  parseCandidates,
  suggestEnrichment,
} from "./enrichment/index.js";
export type {
  EnrichmentCandidate,
  EnrichmentContext,
  EnrichmentTarget,
  SuggestEnrichmentDeps,
} from "./enrichment/index.js";
export {
  formatSchemaForNlToSql,
  formatSchemaForPrompt,
  normalizeAskDbSchema,
  type FormatNlToSqlOptions,
  type NlToSqlSchemaFormatStats,
} from "./schema/normalize.js";
export { extractSqlFromModelText } from "./sql/extract-sql.js";
export type {
  Retriever,
  RetrievedChunk,
  RetrievedChunkType,
  RetrievedResult,
} from "./retrieval/types.js";
export { synthesizeRetrievedDdl } from "./retrieval/synthesize-ddl.js";
