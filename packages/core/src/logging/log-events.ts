/**
 * Stable `event` field values for structured logs (JSON lines).
 * See Phase 2 spec: observability / correlation ID contract.
 */
export const AskDbLogEvent = {
  RunStart: "askdb.run.start",
  RunEnd: "askdb.run.end",
  RunError: "askdb.run.error",
  /** Operating mode for this pipeline run (`mode` field). Emitted before NL→SQL. */
  PipelineMode: "askdb.pipeline.mode",
  PipelineGenerateStart: "askdb.pipeline.generate.start",
  PipelineGenerateComplete: "askdb.pipeline.generate.complete",
  /** NL→SQL prompt DDL omitted sensitive tables/columns — counts only (no identifiers). */
  PromptSensitiveRedacted: "askdb.prompt.sensitive_redacted",
  /** Sensitive identifiers included in DDL for grounding — counts only (see `listedSensitiveColumnCount`). */
  PromptSensitiveIdentifiersListed: "askdb.prompt.sensitive_identifiers_listed",
  PipelineExecuteStart: "askdb.pipeline.execute.start",
  PipelineExecuteComplete: "askdb.pipeline.execute.complete",
  /**
   * After successful execute — whether a post-execute model path runs (v1: logging only).
   * Payload includes `branch`: `skipped` | `stub` (see `docs/contracts/modes-v1.md`).
   */
  PipelinePostExecute: "askdb.pipeline.post_execute",
  /** Generation or execution failed after pipeline logging began (includes `phase`). */
  PipelineFailed: "askdb.pipeline.failed",
  /**
   * Both `executor` and `connectionString` were supplied to `ask()`. The custom `executor` wins;
   * `connectionString` is ignored. Emitted before generation so the resolution is observable in logs.
   * See `docs/specs/phase-4-publish-npm/requirements.md` (“Resolution rule when both inputs are passed”).
   */
  ConfigExecutorOverridesConnectionString: "askdb.config.executor_overrides_connection_string",
  /**
   * Retriever was supplied to `ask()` and used to synthesize a focused DDL
   * block (counts only — `tablesEmitted`, `resultCount`, `k`, `threshold`).
   */
  PipelineRetrievalUsed: "askdb.pipeline.retrieval.used",
  /**
   * Retriever was supplied but **not** used (`reason`: `below_threshold` |
   * `schema_not_v2` | `no_results`). Lets operators tell "supplied but
   * skipped" apart from "never wired up".
   */
  PipelineRetrievalSkipped: "askdb.pipeline.retrieval.skipped",
} as const;

export type AskDbLogEventName = (typeof AskDbLogEvent)[keyof typeof AskDbLogEvent];
