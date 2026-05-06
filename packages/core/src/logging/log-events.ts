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
} as const;

export type AskDbLogEventName = (typeof AskDbLogEvent)[keyof typeof AskDbLogEvent];
