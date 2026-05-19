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
  /** Generation failed after pipeline logging began (includes `phase`). */
  PipelineFailed: "askdb.pipeline.failed",
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
  /** Tenant scope validated and accepted. Includes `scopeKind` and `enforcement`. */
  TenantScopeValidated: "askdb.tenant.scope_validated",
  /** Tenant scope validation failed. Includes `reason`. */
  TenantScopeRejected: "askdb.tenant.scope_rejected",
  /** Tenant SQL guardrail check passed. */
  TenantGuardrailPassed: "askdb.tenant.guardrail_passed",
  /** Tenant SQL guardrail check found issues. Includes `warnings` in warn mode. */
  TenantGuardrailFailed: "askdb.tenant.guardrail_failed",
} as const;

export type AskDbLogEventName = (typeof AskDbLogEvent)[keyof typeof AskDbLogEvent];
