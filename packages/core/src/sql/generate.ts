import type { LanguageModel } from "ai";
import { generateText as defaultGenerateText } from "ai";
import { SqlGenerationError } from "../errors.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { NormalizedSchema } from "../schema/types.js";
import { extractSqlFromModelText } from "./extract-sql.js";
import { buildNlToSqlUserPrompt, nlToSqlSystemPrompt } from "./prompt.js";
import { validatePostgresSelectSql } from "./validate.js";

export type GenerateSqlDeps = {
  generateText?: typeof defaultGenerateText;
  logger?: AskDbLogger;
};

export async function generatePostgresSelectSql(
  question: string,
  schema: NormalizedSchema,
  model: LanguageModel,
  deps: GenerateSqlDeps = {},
): Promise<string> {
  const generateText = deps.generateText ?? defaultGenerateText;
  const logger = deps.logger;

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
        prompt: buildNlToSqlUserPrompt(question, schema),
        temperature: 0,
      });
      text = result.text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SqlGenerationError(`Model call failed: ${message}`, e);
    }
    const extracted = extractSqlFromModelText(text);
    const sql = validatePostgresSelectSql(extracted);
    logger?.info(
      {
        event: AskDbLogEvent.PipelineGenerateComplete,
        sqlCharCount: sql.length,
      },
      "nl-to-sql generate complete",
    );
    return sql;
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
