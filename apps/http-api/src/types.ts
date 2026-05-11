import type { AskDbModeV1 } from "@askdb/core";

export type AskHttpRequest = {
  question: string;
  /**
   * Optional override: AskDB schema JSON v1 as a string.
   *
   * Preferred: configure a server-default schema via env (e.g. ASKDB_SCHEMA_PATH)
   * and omit this field in requests.
   */
  schemaJson?: string;
  /** Default false. Server must also enable execution via ASKDB_HTTP_ENABLE_EXECUTION. */
  execute?: boolean;
  explain?: boolean;
  mode?: AskDbModeV1;
  omitSensitiveFromPrompt?: boolean;
};

export type AskHttpSuccessResponse = {
  ok: true;
  correlationId: string;
  sql: string;
  result?: unknown;
  explain?: unknown;
};

export type AskHttpErrorResponse = {
  ok: false;
  correlationId: string;
  error: {
    code:
      | "not_found"
      | "bad_request"
      | "schema_parse_error"
      | "generation_not_configured"
      | "execution_disabled"
      | "execution_not_configured"
      | "sql_validation_error"
      | "sql_generation_error"
      | "sql_execution_error"
      | "internal_error";
    message: string;
    rule?: string;
  };
};
