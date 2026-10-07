import { randomUUID } from "node:crypto";
import type { AskDbRuntimeConfig } from "@askdb/config";
import {
  createAskDbLogger,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  type AskDbLogger,
  type AskDbLogLevel,
} from "@askdb/core";
import { labelled } from "./error-values.js";

/** The structured-logging flags `askdb ask`, `askdb introspect` and `askdb rag` share. */
export type CliLoggingFlags = {
  verbose?: boolean;
  logLevel?: string;
  logFile?: string;
  logStdout?: boolean;
  correlationId?: string;
};

/**
 * `--log-level`, else `logging.level` from askdb.config.*, else `info` when -v, --log-file or
 * --log-stdout asks for output, else silent.
 */
export function resolveCliLogLevel(flags: CliLoggingFlags, runtimeConfig: AskDbRuntimeConfig): AskDbLogLevel {
  if (flags.logLevel !== undefined && flags.logLevel !== "") {
    const level = flags.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(level)) {
      throw new Error(
        `${labelled("Invalid --log-level", flags.logLevel)} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return level;
  }
  const configured = runtimeConfig.logging.level?.toLowerCase();
  if (configured && isSupportedAskDbLogLevel(configured)) return configured;
  if (flags.verbose || flags.logFile || flags.logStdout) return "info";
  return "silent";
}

/** The run's logger: each flag first, then `logging` in askdb.config.*. */
export function createCliLogger(
  flags: CliLoggingFlags,
  runtimeConfig: AskDbRuntimeConfig,
  level: AskDbLogLevel = resolveCliLogLevel(flags, runtimeConfig),
): AskDbLogger {
  return createAskDbLogger({
    correlationId: flags.correlationId ?? runtimeConfig.logging.correlationId ?? randomUUID(),
    level,
    logFile: flags.logFile ?? runtimeConfig.logging.logFile,
    logStdout: flags.logStdout ?? runtimeConfig.logging.logStdout,
  });
}
