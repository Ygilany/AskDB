#!/usr/bin/env node
import { bootstrapAskDbEnv } from "@askdb/config";
import { pathToFileURL } from "node:url";
import { runStudioCli } from "./cli.js";

export async function runStudioBin(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  bootstrapAskDbEnv({ cwd: process.cwd() });
  return runStudioCli(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runStudioBin());
}
