import pino from "pino";
import type { AskDbLogLevel } from "./create-askdb-logger.js";

/**
 * Valid `--log-level` / `ASKDB_LOG_LEVEL` strings: Pino's default levels from
 * `pino.levels.values` plus `silent` (accepted by `LoggerOptions.level` but not a numeric level).
 */
export const SUPPORTED_ASKDB_LOG_LEVELS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(pino.levels.values),
  "silent",
]);

export function formatSupportedAskDbLogLevels(): string {
  return [...SUPPORTED_ASKDB_LOG_LEVELS].sort().join(", ");
}

export function isSupportedAskDbLogLevel(s: string): s is AskDbLogLevel {
  return SUPPORTED_ASKDB_LOG_LEVELS.has(s);
}
