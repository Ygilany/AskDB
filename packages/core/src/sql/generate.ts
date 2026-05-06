import type { LanguageModel } from "ai";
import { generateText as defaultGenerateText } from "ai";
import { SqlGenerationError } from "../errors.js";
import type { NormalizedSchema } from "../schema/types.js";
import { extractSqlFromModelText } from "./extract-sql.js";
import { buildNlToSqlUserPrompt, nlToSqlSystemPrompt } from "./prompt.js";
import { validatePostgresSelectSql } from "./validate.js";

export type GenerateSqlDeps = {
  generateText?: typeof defaultGenerateText;
};

export async function generatePostgresSelectSql(
  question: string,
  schema: NormalizedSchema,
  model: LanguageModel,
  deps: GenerateSqlDeps = {},
): Promise<string> {
  const generateText = deps.generateText ?? defaultGenerateText;
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
  return validatePostgresSelectSql(extracted);
}
