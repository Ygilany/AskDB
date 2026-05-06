import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { AskDbModeV1 } from "./types.js";

/**
 * After a successful read-only execute, record how the mode treats optional
 * second-pass model context (summaries). v1 does not call the model again;
 * modes differ only in contract + structured logs (`branch`).
 */
export function logPostExecuteModeBranch(
  logger: AskDbLogger | undefined,
  mode: AskDbModeV1,
  rowCount: number,
): void {
  if (mode === "schema_only") {
    logger?.info(
      {
        event: AskDbLogEvent.PipelinePostExecute,
        mode,
        branch: "skipped",
        reason: "schema_only_no_row_data_to_model",
        rowCount,
      },
      "post-execute: summary path skipped (schema_only)",
    );
    return;
  }
  logger?.info(
    {
      event: AskDbLogEvent.PipelinePostExecute,
      mode,
      branch: "stub",
      rowCount,
      note: "bounded_results_stub_no_second_llm_call",
    },
    "post-execute: bounded_results stub branch (no row payload to model in v1)",
  );
}
