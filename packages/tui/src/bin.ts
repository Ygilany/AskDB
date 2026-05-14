#!/usr/bin/env node
import { bootstrapAskDbEnv } from "@askdb/config";
import { runTuiCli } from "./cli.js";

bootstrapAskDbEnv({ cwd: process.cwd() });
const exitCode = await runTuiCli(process.argv.slice(2));
process.exit(exitCode);
