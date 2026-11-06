#!/usr/bin/env node
import { isAskDbDebugEnabled } from "@askdb/config";
import { AskDbError } from "@askdb/core";
import { printCliError } from "./cli-error.js";
import { runCli } from "./dispatch.js";

/**
 * Resolves once everything written so far has reached stdout and stderr, so exiting can't cut it
 * off. A reader that closed early (`askdb --help | grep -q …`) leaves nothing to drain: its EPIPE
 * resolves instead of crashing the exit.
 */
function drain(): Promise<unknown> {
  return Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise((done) => {
          stream.on("error", done);
          stream.write("", done);
        }),
    ),
  );
}

// Each command loads askdb.config itself, only on the path that reads it. An error that escapes a
// command, such as a missing or broken config, lands here.
let exitCode: number;
try {
  exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  printCliError(error);
  if (isAskDbDebugEnabled() && error instanceof Error && error.stack) {
    console.error(error.stack);
  } else if (!(error instanceof AskDbError)) {
    console.error("Set ASKDB_DEBUG=1 to print the stack trace.");
  }
  exitCode = 1;
}
await drain();
process.exit(exitCode);
