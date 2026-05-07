import type { AskDbLogEventName } from "./log-events.js";
import { AskDbLogEvent } from "./log-events.js";

/**
 * Minimal structured-log contract intended for headless surfaces (CLI now; reused by servers later).
 *
 * This is deliberately small:
 * - Tests should fail on removal/rename of required fields/events (drift).
 * - Tests should tolerate additive fields/events.
 */
export const ASKDB_LOG_REQUIRED_FIELDS = ["event", "correlationId"] as const;

/**
 * Minimal event taxonomy for an end-to-end run.
 *
 * These are the best “merge bar” anchors for CI spawn tests because they appear
 * across common paths without depending on optional execution.
 */
export const ASKDB_LOG_REQUIRED_EVENTS = [
  AskDbLogEvent.RunStart,
  AskDbLogEvent.PipelineMode,
  AskDbLogEvent.PipelineGenerateStart,
  AskDbLogEvent.PipelineGenerateComplete,
  AskDbLogEvent.RunEnd,
] as const satisfies readonly AskDbLogEventName[];

