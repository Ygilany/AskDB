import { formatSchemaForPrompt } from "../schema/normalize.js";
import type { NormalizedSchema } from "../schema/types.js";

export function buildNlToSqlUserPrompt(question: string, schema: NormalizedSchema): string {
  const ddl = formatSchemaForPrompt(schema);
  return [
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
    `Question: ${question}`,
  ].join("\n");
}

export const nlToSqlSystemPrompt =
  "You are AskDB SQL generator—correct, deterministic PostgreSQL for analytics. Produce one SELECT (or WITH) only.";
