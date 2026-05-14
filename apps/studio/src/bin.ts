#!/usr/bin/env node
import { bootstrapAskDbEnv } from "@askdb/config";
import { runStudioCli } from "./cli.js";

bootstrapAskDbEnv({ cwd: process.cwd() });

process.exit(await runStudioCli(process.argv.slice(2)));
