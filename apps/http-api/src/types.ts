import type { AskDbModeV1, AskUsage, SensitiveGuardrailResult } from "@askdb/core";

export type AskHttpRequest = {
  question: string;
  /**
   * Optional override: AskDB Schema v2 bundled JSON as a string.
   *
   * Rejected with `403 schema_override_disabled` unless the server sets
   * `httpApi.allowSchemaOverride: true`. Preferred: configure a server-default
   * schema (`host.schemaPath`) and omit this field in requests.
   */
  schemaJson?: string;
  explain?: boolean;
  mode?: AskDbModeV1;
  /**
   * Omit sensitive identifiers from the NL→SQL prompt for this request. Can only
   * tighten the server's `modes.omitSensitiveFromPrompt` — `false` never loosens it.
   */
  omitSensitiveFromPrompt?: boolean;
};

export type AskHttpSuccessResponse = {
  ok: true;
  correlationId: string;
  sql: string;
  explain?: unknown;
  usage: AskUsage | null;
  /**
   * Sensitive-identifier check over `sql`. Present when the schema marks at least one
   * table/column `sensitive`; `passed: false` means the SQL references one of them.
   */
  sensitiveGuardrail?: SensitiveGuardrailResult;
};

export type AskHttpErrorResponse = {
  ok: false;
  correlationId: string;
  error: {
    code:
      | "not_found"
      | "bad_request"
      | "payload_too_large"
      | "schema_parse_error"
      | "schema_override_disabled"
      | "generation_not_configured"
      | "sql_validation_error"
      | "guardrail_violation"
      | "sql_generation_error"
      | "internal_error";
    message: string;
    rule?: string;
  };
};
