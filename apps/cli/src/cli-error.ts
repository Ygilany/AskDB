import { AskDbError, SqlValidationError } from "@askdb/core";
import { MissingAskDbConfigError } from "./project-config.js";

/**
 * A thrown value as one or more lines, never blank. An error with an empty message, such as the
 * `AggregateError` a driver throws when `localhost` refuses on both ::1 and 127.0.0.1, gives each
 * inner error's message once (a socket error names the address, not the connection string), else
 * its `code`, else its name.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.message) return error.message;
  if (error instanceof AggregateError && error.errors.length > 0) {
    const lines = new Set(error.errors.map((inner) => errorMessage(inner)));
    return [...lines].join("\n");
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : error.name;
}

/** The CLI's printer for `askdb ask` and the top-level handler: AskDB errors keep their name. */
export function printCliError(error: unknown): void {
  if (error instanceof MissingAskDbConfigError) {
    process.stderr.write(`${error.message}\n`);
    return;
  }
  if (error instanceof SqlValidationError) {
    process.stderr.write(`${error.name} [${error.rule}]: ${error.message}\n`);
    if (error.hint) process.stderr.write(`Hint: ${error.hint}\n`);
    return;
  }
  if (error instanceof AskDbError) {
    process.stderr.write(`${error.name}: ${errorMessage(error)}\n`);
    return;
  }
  process.stderr.write(`${errorMessage(error)}\n`);
}
