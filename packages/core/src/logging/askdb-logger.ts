/**
 * Structured logging port for the pipeline (`@askdb/core`).
 * Keeps NL→SQL and execution free of vendor logger types (DIP).
 *
 * Implementations may wrap Pino, OpenTelemetry, or no-ops — consumers pass an instance from the host (CLI, HTTP, MCP).
 */
export type AskDbLogger = {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
};
