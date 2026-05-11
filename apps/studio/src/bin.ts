#!/usr/bin/env node
import { runStudioCli } from "./cli.js";

process.exit(await runStudioCli(process.argv.slice(2)));
