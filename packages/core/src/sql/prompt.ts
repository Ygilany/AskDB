import { AskDbLogEvent } from "../logging/log-events.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import {
  formatSchemaForNlToSql,
  type FormatNlToSqlOptions,
} from "../schema/normalize.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import {
  formatSchemaV2ForNlToSql,
  type NormalizedSchemaV2,
} from "../schema/v2/index.js";
import type { DialectSpec } from "./dialect-spec.js";

function isV2(schema: AnyNormalizedSchema): schema is NormalizedSchemaV2 {
  return "schemaId" in schema;
}

/**
 * Build the dialect-parameterized NL→SQL user prompt. The same scaffolding is used
 * for every dialect; the dialect's `displayName` and `promptBrief` are interpolated
 * to steer the model toward dialect-correct syntax.
 */
export function buildNlToSqlUserPrompt(
  dialect: DialectSpec,
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
    `You translate natural language questions into a single ${dialect.displayName} SELECT (or WITH ... SELECT).`,
    "Rules:",
    `- Output exactly one ${dialect.displayName} SELECT query (CTE WITH is ok). End with optional semicolon.`,
    '- Put the SQL only inside one markdown fenced block labelled ```sql (preferred). No extra commentary.',
    "- Use identifiers from the schema below; qualify table names where it helps readability.",
    "- Do NOT use DDL or write statements (INSERT, UPDATE, DELETE, etc.). SELECT-only.",
    `- Dialect notes: ${dialect.promptBrief}`,
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

/** Dialect-parameterized system prompt for the NL→SQL generator. */
export function buildNlToSqlSystemPrompt(dialect: DialectSpec): string {
  return `You are AskDB SQL generator—correct, deterministic ${dialect.displayName} for analytics. Produce one SELECT (or WITH) only.`;
}
