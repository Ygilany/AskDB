#!/usr/bin/env node
import { bootstrapAskDbEnv, discoverAskDbConfigPath } from "@askdb/config";
import { pathToFileURL } from "node:url";
import { runStudioCli } from "./cli.js";

export async function runStudioBin(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const cwd = process.cwd();
  const configPath = discoverAskDbConfigPath(cwd);
  // No config yet: Studio starts in setup mode and the browser wizard walks the user through
  // creating one. runStudioCli re-probes.
  if (configPath) {
    try {
      bootstrapAskDbEnv({ cwd });
    } catch (error) {
      // A config that exists but fails to load (a syntax error, or dependencies not installed
      // yet) still lets Studio start so setup can continue, but the user must hear why their
      // settings are ignored. Setup never overwrites an existing config file.
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `askdb-studio: warning: ${configPath} could not be loaded, so Studio is ignoring it: ${message}\n`,
      );
    }
  }
  return runStudioCli(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runStudioBin());
}
