#!/usr/bin/env node
import { bootstrapAskDbEnv } from "@askdb/config";
import { runRagCli } from "./cli.js";

bootstrapAskDbEnv({ cwd: process.cwd() });
const exitCode = await runRagCli(process.argv.slice(2));
process.exit(exitCode);
