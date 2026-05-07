import type { AskDbModeV1 } from "@askdb/core";

export type AskHttpRequest = {
  question: string;
  /**
   * AskDB schema JSON v1 as a string. This keeps the transport contract stable across
   * languages and avoids leaking internal schema types.
   */
  schemaJson: string;
  /** Default false. */
  execute?: boolean;
  /** Required when execute=true; otherwise ignored. */
  connectionString?: string;
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
      | "bad_request"
      | "schema_parse_error"
      | "generation_not_configured"
      | "execution_disabled"
      | "core_error"
      | "internal_error";
    message: string;
  };
};

