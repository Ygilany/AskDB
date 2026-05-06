/**
 * Stable `event` field values for structured logs (JSON lines).
 * See Phase 2 spec: observability / correlation ID contract.
 */
export const AskDbLogEvent = {
  RunStart: "askdb.run.start",
  RunEnd: "askdb.run.end",
  RunError: "askdb.run.error",
  PipelineGenerateStart: "askdb.pipeline.generate.start",
  PipelineGenerateComplete: "askdb.pipeline.generate.complete",
  PipelineExecuteStart: "askdb.pipeline.execute.start",
  PipelineExecuteComplete: "askdb.pipeline.execute.complete",
  /** Generation or execution failed after pipeline logging began (includes `phase`). */
  PipelineFailed: "askdb.pipeline.failed",
} as const;

export type AskDbLogEventName = (typeof AskDbLogEvent)[keyof typeof AskDbLogEvent];
