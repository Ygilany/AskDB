import type { LanguageModel } from "ai";
import { AskDbError } from "./errors.js";
import { executeReadOnlySelect, type TabularResult } from "./exec/postgres.js";
import type { NormalizedSchema } from "./schema/types.js";
import type { GenerateSqlDeps } from "./sql/generate.js";
import { generatePostgresSelectSql } from "./sql/generate.js";

export type AskPipelineOptions = {
  question: string;
  schema: NormalizedSchema;
  model: LanguageModel;
  /** When set with `execute: true`, runs the generated SELECT in a read-only transaction. */
  connectionString?: string;
  /** Default false — only generate + validate unless explicitly requested. */
  execute?: boolean;
  deps?: GenerateSqlDeps;
};

export type AskPipelineResult = {
  sql: string;
  result?: TabularResult;
};

export async function ask(options: AskPipelineOptions): Promise<AskPipelineResult> {
  const sql = await generatePostgresSelectSql(options.question, options.schema, options.model, options.deps);
  if (!options.execute) {
    return { sql };
  }
  const url = options.connectionString;
  if (!url) {
    throw new AskDbError("Execution was requested but connectionString is not set.");
  }
  const result = await executeReadOnlySelect(url, sql);
  return { sql, result };
}
