import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  /**
   * Append JSON logs to this file path (parent directories are created). Every logger with the
   * same path shares one open file, which stays open until the process exits.
   */
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
    warn(context: Record<string, unknown>, message: string) {
      pinoLogger.warn(context, message);
    },
    debug(context: Record<string, unknown>, message: string) {
      pinoLogger.debug(context, message);
    },
  };
}

/**
 * One open destination per log file, for the life of the process. Hosts build a logger per request
 * (its correlation ID is the request ID), so opening the file for each logger leaked one descriptor
 * per request (#693). Because the file stays open, rotate it with `copytruncate`, or restart the
 * process after a rotate.
 */
const logFileDestinations = new Map<string, pino.DestinationStream>();

function logFileDestination(logFile: string): pino.DestinationStream {
  const path = resolve(logFile);
  let destination = logFileDestinations.get(path);
  if (destination === undefined) {
    mkdirSync(dirname(path), { recursive: true });
    destination = pino.destination({ dest: path, sync: true });
    logFileDestinations.set(path, destination);
  }
  return destination;
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
    destinations.push(logFileDestination(options.logFile));
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
