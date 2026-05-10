import type { LanguageModel } from "ai";
import { generateText as defaultGenerateText } from "ai";
import { SqlGenerationError } from "../errors.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { FormatNlToSqlOptions } from "../schema/normalize.js";
import type { AnyNormalizedSchema } from "./prompt.js";
import { extractSqlFromModelText } from "./extract-sql.js";
import { buildNlToSqlUserPrompt, nlToSqlSystemPrompt } from "./prompt.js";
import { assertNlToSqlInputs, nlToSqlAmbiguityNotes } from "./schema-question-precheck.js";
import type { PostgresSelectGuardrailExplain } from "./validate.js";
import { buildPostgresSelectGuardrailExplanation, validatePostgresSelectSql } from "./validate.js";

export type { PostgresSelectGuardrailExplain } from "./validate.js";

export type GenerateSqlDeps = {
  generateText?: typeof defaultGenerateText;
  logger?: AskDbLogger;
  /** When true, include heuristic guardrail explanation in {@link GeneratePostgresSelectSqlResult.explain}. */
  explain?: boolean;
  /**
   * When true, omit sensitive identifiers from NL→SQL DDL (stricter). Default false — names are listed
   * with `(sensitive)` so the model can ground queries (see `docs/contracts/sensitive-fields-and-modes.md`).
   */
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  /**
   * Pre-synthesized DDL block. When supplied, replaces the formatter output
   * in the NL→SQL prompt. Used by `ask({ retriever })` to inject a focused
   * DDL synthesized from retrieved chunks; consumers usually don't set this
   * directly.
   */
  prebuiltDdl?: string;
};

/** Result of NL→SQL generation (always includes `sql`; `explain` when {@link GenerateSqlDeps.explain}). */
export type GeneratePostgresSelectSqlResult = {
  sql: string;
  explain?: PostgresSelectGuardrailExplain;
};

export async function generatePostgresSelectSql(
  question: string,
  schema: AnyNormalizedSchema,
  model: LanguageModel,
  deps: GenerateSqlDeps = {},
): Promise<GeneratePostgresSelectSqlResult> {
  assertNlToSqlInputs(schema, question);
  const ambiguityNotes = nlToSqlAmbiguityNotes(question, schema);
  const generateText = deps.generateText ?? defaultGenerateText;
  const logger = deps.logger;
  const nlToSqlSchemaOptions: FormatNlToSqlOptions | undefined =
    deps.omitSensitiveIdentifiersFromNlToSqlPrompt === true
      ? { omitSensitiveIdentifiersFromPrompt: true }
      : undefined;

  logger?.info(
    {
      event: AskDbLogEvent.PipelineGenerateStart,
      questionLength: question.length,
      tableCount: schema.tables.length,
    },
    "nl-to-sql generate start",
  );

  try {
    let text: string;
    try {
      const result = await generateText({
        model,
        system: nlToSqlSystemPrompt,
        prompt: buildNlToSqlUserPrompt(
          question,
          schema,
          ambiguityNotes,
          logger,
          nlToSqlSchemaOptions,
          deps.prebuiltDdl,
        ),
        temperature: 0,
      });
      text = result.text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SqlGenerationError(`Model call failed: ${message}`, e);
    }
    const extracted = extractSqlFromModelText(text);
    const sql = validatePostgresSelectSql(extracted);
    const explain = deps.explain ? buildPostgresSelectGuardrailExplanation(sql) : undefined;
    logger?.info(
      {
        event: AskDbLogEvent.PipelineGenerateComplete,
        sqlCharCount: sql.length,
      },
      "nl-to-sql generate complete",
    );
    return explain !== undefined ? { sql, explain } : { sql };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger?.error(
      {
        event: AskDbLogEvent.PipelineFailed,
        phase: "generate",
        errMessage: msg,
      },
      "nl-to-sql generate failed",
    );
    throw e;
  }
}
