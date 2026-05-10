#!/usr/bin/env node
import { runRagCli } from "./cli.js";

const exitCode = await runRagCli(process.argv.slice(2));
process.exit(exitCode);
