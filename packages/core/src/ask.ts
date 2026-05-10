import type { LanguageModel } from "ai";
import { AskDbError } from "./errors.js";
import type { AskDbExecutor } from "./exec/executor.js";
import { createPostgresExecutor } from "./exec/postgres.js";
import type { TabularResult } from "./exec/types.js";
import type { AskDbLogger } from "./logging/askdb-logger.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { AnyNormalizedSchema } from "./sql/prompt.js";
import { logPostExecuteModeBranch } from "./modes/post-execute-log.js";
import { DEFAULT_ASKDB_MODE, type AskDbModeV1 } from "./modes/types.js";
import type { GenerateSqlDeps, PostgresSelectGuardrailExplain } from "./sql/generate.js";
import { generatePostgresSelectSql } from "./sql/generate.js";
import type { Retriever } from "./retrieval/types.js";
import { synthesizeRetrievedDdl } from "./retrieval/synthesize-ddl.js";
import type { NormalizedSchemaV2 } from "./schema/v2/normalized.js";

export type AskPipelineOptions = {
  question: string;
  schema: AnyNormalizedSchema;
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
  /**
   * Optional retriever from `@askdb/rag` (or any compatible implementation).
   * When supplied **and** the schema's chunk count exceeds
   * {@link retrievalThresholdChunks} (default 30), the retriever is called
   * with the user question and the retrieved chunks replace the full DDL
   * block in the NL→SQL prompt.
   *
   * When omitted, the Phase 5 behavior is preserved (full DDL inlined when
   * v2 fields exist).
   */
  retriever?: Retriever;
  /** Top-k forwarded to the retriever. Default 8. */
  retrievalK?: number;
  /**
   * Chunk-count threshold above which retrieval is preferred. When the
   * total chunk count for the schema is at or below this number, the full
   * DDL is inlined even if a retriever is supplied. Default 30.
   */
  retrievalThresholdChunks?: number;
  /**
   * Total chunk count for the indexed schema. Hosts that built the index
   * via `buildSchemaIndex` should pass `result.stats.chunksTotal` here so
   * the threshold check is meaningful. Defaults to `Infinity` — i.e. always
   * use the retriever when one is supplied — which matches the spec's
   * "consumer decides" stance for hosts that don't surface a count.
   */
  totalSchemaChunkCount?: number;
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

  // Resolve retrieval. The threshold gate keeps small schemas on the full-DDL
  // path even when a retriever is supplied — measured in chunk count, not tokens.
  const prebuiltDdl = await maybeRetrieveDdl({
    options,
    logger,
    omitSensitive,
  });

  const generated = await generatePostgresSelectSql(options.question, options.schema, options.model, {
    ...options.deps,
    logger,
    explain: explainRequested,
    omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitive || undefined,
    prebuiltDdl,
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

/** Default chunk-count threshold below which the full DDL is preferred. */
const DEFAULT_RETRIEVAL_THRESHOLD_CHUNKS = 30;
const DEFAULT_RETRIEVAL_K = 8;

async function maybeRetrieveDdl(args: {
  options: AskPipelineOptions;
  logger: AskDbLogger | undefined;
  omitSensitive: boolean;
}): Promise<string | undefined> {
  const { options, logger, omitSensitive } = args;
  const retriever = options.retriever;
  if (!retriever) return undefined;

  if (!isV2Schema(options.schema)) {
    logger?.info(
      { event: AskDbLogEvent.PipelineRetrievalSkipped, reason: "schema_not_v2" },
      "retriever supplied but schema is not v2 — skipping retrieval",
    );
    return undefined;
  }

  const threshold = options.retrievalThresholdChunks ?? DEFAULT_RETRIEVAL_THRESHOLD_CHUNKS;
  const total = options.totalSchemaChunkCount ?? Number.POSITIVE_INFINITY;
  if (total <= threshold) {
    logger?.info(
      {
        event: AskDbLogEvent.PipelineRetrievalSkipped,
        reason: "below_threshold",
        totalChunks: total,
        threshold,
      },
      "retriever supplied but schema is below threshold — using full DDL",
    );
    return undefined;
  }

  const k = options.retrievalK ?? DEFAULT_RETRIEVAL_K;
  const results = await retriever({
    question: options.question,
    k,
    filter: { schemaId: options.schema.schemaId },
  });
  if (results.length === 0) {
    logger?.info(
      {
        event: AskDbLogEvent.PipelineRetrievalSkipped,
        reason: "no_results",
        k,
        threshold,
        totalChunks: total === Number.POSITIVE_INFINITY ? null : total,
      },
      "retriever returned no chunks — using full DDL",
    );
    return undefined;
  }

  const synth = synthesizeRetrievedDdl({
    schema: options.schema,
    results,
    omitSensitiveIdentifiersFromPrompt: omitSensitive,
  });
  logger?.info(
    {
      event: AskDbLogEvent.PipelineRetrievalUsed,
      k,
      resultCount: results.length,
      tablesEmitted: synth.tablesEmitted,
      threshold,
      totalChunks: total === Number.POSITIVE_INFINITY ? null : total,
    },
    "retriever supplied focused DDL",
  );
  return synth.ddl;
}

function isV2Schema(schema: AnyNormalizedSchema): schema is NormalizedSchemaV2 {
  return "schemaId" in schema;
}
