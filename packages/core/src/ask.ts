import type { LanguageModel } from "ai";
import { AskDbError } from "./errors.js";
import type { AskDbExecutor } from "./exec/executor.js";
import { createPostgresExecutor, type TabularResult } from "./exec/postgres.js";
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
  /**
   * When true, omit sensitive table/column names from NL→SQL DDL. Default false — names are included
   * with `(sensitive)` tags (merged with `deps.omitSensitiveIdentifiersFromNlToSqlPrompt`; top-level wins).
   */
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  /**
   * When set with `execute: true`, runs the generated SELECT in a read-only transaction using the
   * built-in `pg`-backed executor (see {@link createPostgresExecutor}). Ignored when `executor`
   * is also supplied — the consumer-supplied executor wins and a
   * `askdb.config.executor_overrides_connection_string` event is emitted.
   */
  connectionString?: string;
  /**
   * BYO database execution seam. When supplied, `ask()` calls this function with the validated
   * SELECT instead of the built-in `pg` path. The executor is responsible for read-only semantics
   * (see {@link AskDbExecutor}).
   */
  executor?: AskDbExecutor;
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

  // Resolve the execution seam up front so the precedence-warning event lands in logs before
  // generation, matching the documented "Resolution rule when both inputs are passed".
  if (options.executor && options.connectionString) {
    logger?.info(
      {
        event: AskDbLogEvent.ConfigExecutorOverridesConnectionString,
        chosen: "executor",
      },
      "executor supplied; ignoring connectionString",
    );
  }

  const explainRequested = options.explain ?? options.deps?.explain ?? false;
  const omitSensitive =
    options.omitSensitiveIdentifiersFromNlToSqlPrompt ??
    options.deps?.omitSensitiveIdentifiersFromNlToSqlPrompt ??
    false;
  const generated = await generatePostgresSelectSql(options.question, options.schema, options.model, {
    ...options.deps,
    logger,
    explain: explainRequested,
    omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitive || undefined,
  });
  const sql = generated.sql;
  const explain = generated.explain;
  if (!options.execute) {
    return explain !== undefined ? { sql, explain } : { sql };
  }

  // Pick the executor: BYO wins, otherwise lazy-build the built-in pg-backed one from the
  // connection string. Group 2 will make the pg import lazy at the factory boundary.
  let executor: AskDbExecutor;
  if (options.executor) {
    executor = options.executor;
  } else if (options.connectionString) {
    executor = createPostgresExecutor(options.connectionString);
  } else {
    throw new AskDbError(
      "Execution was requested but neither `executor` nor `connectionString` was provided.",
    );
  }

  try {
    logger?.info({ event: AskDbLogEvent.PipelineExecuteStart }, "execute start");
    const result = await executor(sql);
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
