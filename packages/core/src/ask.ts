import type { LanguageModel } from "ai";
import { AskDbError } from "./errors.js";
import { executeReadOnlySelect, type TabularResult } from "./exec/postgres.js";
import type { AskDbLogger } from "./logging/askdb-logger.js";
import { AskDbLogEvent } from "./logging/log-events.js";
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
  /** Optional structured logger (host-provided — e.g. `createAskDbLogger` wraps Pino). */
  logger?: AskDbLogger;
};

export type AskPipelineResult = {
  sql: string;
  result?: TabularResult;
};

export async function ask(options: AskPipelineOptions): Promise<AskPipelineResult> {
  const logger = options.logger;
  const sql = await generatePostgresSelectSql(options.question, options.schema, options.model, {
    ...options.deps,
    logger,
  });
  if (!options.execute) {
    return { sql };
  }
  const url = options.connectionString;
  if (!url) {
    throw new AskDbError("Execution was requested but connectionString is not set.");
  }
  try {
    logger?.info({ event: AskDbLogEvent.PipelineExecuteStart }, "execute start");
    const result = await executeReadOnlySelect(url, sql);
    logger?.info(
      {
        event: AskDbLogEvent.PipelineExecuteComplete,
        rowCount: result.rows.length,
      },
      "execute complete",
    );
    return { sql, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger?.error(
      {
        event: AskDbLogEvent.PipelineFailed,
        phase: "execute",
        errMessage: msg,
      },
      "execute failed",
    );
    throw e;
  }
}
