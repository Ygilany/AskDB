import type { LanguageModel } from "ai";
import { AskDbError } from "./errors.js";
import { executeReadOnlySelect, type TabularResult } from "./exec/postgres.js";
import type { AskDbLogger } from "./logging/askdb-logger.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { NormalizedSchema } from "./schema/types.js";
import { logPostExecuteModeBranch } from "./modes/post-execute-log.js";
import { DEFAULT_ASKDB_MODE, type AskDbModeV1 } from "./modes/types.js";
import type { GenerateSqlDeps, PostgresSelectGuardrailExplain } from "./sql/generate.js";
import { generatePostgresSelectSql } from "./sql/generate.js";

export type AskPipelineOptions = {
  question: string;
  schema: NormalizedSchema;
  model: LanguageModel;
  /** When true, callers may inspect heuristic guardrail metadata (hosts/CLI). */
  explain?: boolean;
  /** When set with `execute: true`, runs the generated SELECT in a read-only transaction. */
  connectionString?: string;
  /** Default false — only generate + validate unless explicitly requested. */
  execute?: boolean;
  deps?: GenerateSqlDeps;
  /** Optional structured logger (host-provided — e.g. `createAskDbLogger` wraps Pino). */
  logger?: AskDbLogger;
  /**
   * Trust boundary for optional post-execute model paths. Default {@link DEFAULT_ASKDB_MODE}.
   * @see `docs/contracts/modes-v1.md`
   */
  mode?: AskDbModeV1;
};

export type AskPipelineResult = {
  sql: string;
  result?: TabularResult;
  explain?: PostgresSelectGuardrailExplain;
};

export async function ask(options: AskPipelineOptions): Promise<AskPipelineResult> {
  const logger = options.logger;
  const mode = options.mode ?? DEFAULT_ASKDB_MODE;
  logger?.info({ event: AskDbLogEvent.PipelineMode, mode }, "pipeline mode");

  const explainRequested = options.explain ?? options.deps?.explain ?? false;
  const generated = await generatePostgresSelectSql(options.question, options.schema, options.model, {
    ...options.deps,
    logger,
    explain: explainRequested,
  });
  const sql = generated.sql;
  const explain = generated.explain;
  if (!options.execute) {
    return explain !== undefined ? { sql, explain } : { sql };
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
    logPostExecuteModeBranch(logger, mode, result.rows.length);
    return explain !== undefined ? { sql, result, explain } : { sql, result };
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
