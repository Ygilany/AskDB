import type { AskDbModeV1 } from "@askdb/core";

export type AskHttpRequest = {
  question: string;
  /**
   * Optional override: AskDB Schema v2 bundled JSON as a string.
   *
   * Preferred: configure a server-default schema via env (e.g. ASKDB_SCHEMA_PATH)
   * and omit this field in requests.
   */
  schemaJson?: string;
  explain?: boolean;
  mode?: AskDbModeV1;
  omitSensitiveFromPrompt?: boolean;
};

export type AskHttpSuccessResponse = {
  ok: true;
  correlationId: string;
  sql: string;
  explain?: unknown;
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
      | "generation_not_configured"
      | "sql_validation_error"
      | "sql_generation_error"
      | "internal_error";
    message: string;
    rule?: string;
  };
};
