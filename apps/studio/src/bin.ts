#!/usr/bin/env node
import { bootstrapAskDbEnv } from "@askdb/config";
import { pathToFileURL } from "node:url";
import { runStudioCli } from "./cli.js";

export async function runStudioBin(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    bootstrapAskDbEnv({ cwd: process.cwd() });
  } catch {
    // No askdb.config.* yet — Studio starts in setup mode and the browser
    // wizard walks the user through creating one. runStudioCli re-probes.
  }
  return runStudioCli(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runStudioBin());
}
