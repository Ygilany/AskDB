import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pino from "pino";
import type { Logger as PinoLogger } from "pino";
import type { AskDbLogger } from "./askdb-logger.js";

/** Pino levels plus `silent` (no output). */
export type AskDbLogLevel = pino.LevelWithSilent;

export type CreateAskDbLoggerOptions = {
  /** Included on every log line via `pino.child`. */
  correlationId: string;
  /** Default `silent` — no structured logs unless overridden. */
  level?: AskDbLogLevel;
  /**
   * Write JSON logs to stderr (recommended for CLI so stdout stays clean for results).
   * Default true when logging is enabled and no sinks are disabled explicitly.
   */
  stderr?: boolean;
  /** Append JSON logs to this file path (parent directories are created). */
  logFile?: string;
  /** Duplicate logs to stdout (e.g. piping aggregated output). */
  logStdout?: boolean;
};

function wrapPinoAsAskDbLogger(pinoLogger: PinoLogger): AskDbLogger {
  return {
    info(context: Record<string, unknown>, message: string) {
      pinoLogger.info(context, message);
    },
    error(context: Record<string, unknown>, message: string) {
      pinoLogger.error(context, message);
    },
  };
}

/**
 * Builds an {@link AskDbLogger} backed by Pino (multi-destination per ADR 0001).
 * Uses a single `destination` when only one sink is configured (simpler flushing); otherwise `pino.multistream`.
 */
export function createAskDbLogger(options: CreateAskDbLoggerOptions): AskDbLogger {
  const level: AskDbLogLevel = options.level ?? "silent";
  if (level === "silent") {
    return wrapPinoAsAskDbLogger(pino({ level: "silent" }));
  }

  const stderrOn = options.stderr !== false;
  const destinations: pino.DestinationStream[] = [];
  if (stderrOn) {
    destinations.push(pino.destination(2));
  }
  if (options.logStdout) {
    destinations.push(pino.destination(1));
  }
  if (options.logFile) {
    mkdirSync(dirname(options.logFile), { recursive: true });
    destinations.push(pino.destination({ dest: options.logFile, sync: true }));
  }

  if (destinations.length === 0) {
    return wrapPinoAsAskDbLogger(pino({ level: "silent" }));
  }

  const dest =
    destinations.length === 1
      ? destinations[0]!
      : pino.multistream(destinations.map((stream) => ({ stream })));

  const pinoLogger = pino({ level }, dest).child({ correlationId: options.correlationId });
  return wrapPinoAsAskDbLogger(pinoLogger);
}
