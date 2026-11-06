import { randomUUID } from "node:crypto";
import type { AskDbRuntimeConfig } from "@askdb/config";
import {
  createAskDbLogger,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  type AskDbLogger,
  type AskDbLogLevel,
} from "@askdb/core";
import type { Flag } from "./command.js";
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
  if (flags.logLevel !== undefined) {
    const level = flags.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(level)) {
      throw new Error(
        `${labelled("Invalid --log-level", flags.logLevel)} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return level;
  }
  const configured = runtimeConfig.logging.level;
  if (configured) return configured;
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

/** The flag rows for `CliLoggingFlags`, the same in every command that logs. */
export function loggingFlags<O extends CliLoggingFlags>(): readonly Flag<O>[] {
  return [
    {
      names: ["-v", "--verbose"],
      help: "Emit structured JSON logs (info) to stderr.",
      apply: (opts) => (opts.verbose = true),
    },
    {
      names: ["--log-level"],
      value: "<level>",
      help: "Structured log level (trace|debug|info|warn|error|fatal|silent). Default: logging.level.",
      apply: (opts, value) => (opts.logLevel = value),
    },
    {
      names: ["--log-file"],
      value: "<path>",
      help: "Append structured JSON logs to this file. Default: logging.logFile.",
      apply: (opts, value) => (opts.logFile = value),
    },
    {
      names: ["--log-stdout"],
      help: "Mirror structured JSON logs to stdout. Default: logging.logStdout.",
      apply: (opts) => (opts.logStdout = true),
    },
    {
      names: ["--correlation-id"],
      value: "<id>",
      help: "Correlation ID for logs. Default: logging.correlationId.",
      apply: (opts, value) => (opts.correlationId = value),
    },
  ];
}
