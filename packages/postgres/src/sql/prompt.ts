import {
  AskDbLogEvent,
  formatSchemaForNlToSql,
  formatSchemaV2ForNlToSql,
  type AnyNormalizedSchema,
  type AskDbLogger,
  type FormatNlToSqlOptions,
  type NormalizedSchemaV2,
} from "@askdb/core";

function isV2(schema: AnyNormalizedSchema): schema is NormalizedSchemaV2 {
  return "schemaId" in schema;
}

export function buildNlToSqlUserPrompt(
  question: string,
  schema: AnyNormalizedSchema,
  ambiguityNotes: readonly string[] = [],
  logger?: AskDbLogger,
  nlToSqlSchemaOptions?: FormatNlToSqlOptions,
  /**
   * Optional pre-synthesized DDL block. When supplied, this replaces the
   * formatter output verbatim — used by `ask({ retriever })` to inject a
   * focused DDL built from retrieved chunks. Sensitive-redaction logging
   * still fires using the consumer-supplied `nlToSqlSchemaOptions` to keep
   * observability consistent.
   */
  prebuiltDdl?: string,
): string {
  const formatted = isV2(schema)
    ? formatSchemaV2ForNlToSql(schema, nlToSqlSchemaOptions)
    : formatSchemaForNlToSql(schema, nlToSqlSchemaOptions);
  const ddl = prebuiltDdl ?? formatted.ddl;
  const stats = formatted.stats;
  if (
    stats.omitSensitiveIdentifiersFromPrompt &&
    (stats.redactedColumnCount > 0 || stats.sensitiveTableStubCount > 0)
  ) {
    logger?.debug?.(
      {
        event: AskDbLogEvent.PromptSensitiveRedacted,
        redactedColumnCount: stats.redactedColumnCount,
        sensitiveTableStubCount: stats.sensitiveTableStubCount,
      },
      "nl-to-sql prompt omitted sensitive schema metadata from DDL",
    );
  }
  if (
    !stats.omitSensitiveIdentifiersFromPrompt &&
    stats.listedSensitiveColumnCount > 0
  ) {
    logger?.debug?.(
      {
        event: AskDbLogEvent.PromptSensitiveIdentifiersListed,
        listedSensitiveColumnCount: stats.listedSensitiveColumnCount,
      },
      "nl-to-sql prompt lists sensitive schema identifiers for SQL grounding (names only)",
    );
  }
  const lines = [
    "You translate natural language questions into a single PostgreSQL SELECT (or WITH ... SELECT).",
    "Rules:",
    "- Output exactly one PostgreSQL SELECT query (CTE WITH is ok). End with optional semicolon.",
    '- Put the SQL only inside one markdown fenced block labelled ```sql (preferred). No extra commentary.',
    "- Use identifiers from the schema below; qualify table names where it helps readability.",
    "- Do NOT use DDL or write statements (INSERT, UPDATE, DELETE, etc.). SELECT-only.",
    "",
    "Database schema:",
    ddl,
    "",
  ];
  if (ambiguityNotes.length > 0) {
    lines.push(
      "Context (deterministic checks from AskDB—these hints may be irrelevant; weigh them against the question):",
    );
    for (const note of ambiguityNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  lines.push(`Question: ${question}`);
  return lines.join("\n");
}

export const nlToSqlSystemPrompt =
  "You are AskDB SQL generator—correct, deterministic PostgreSQL for analytics. Produce one SELECT (or WITH) only.";
