#!/usr/bin/env node
import { runTuiCli } from "./cli.js";

const exitCode = await runTuiCli(process.argv.slice(2));
process.exit(exitCode);
