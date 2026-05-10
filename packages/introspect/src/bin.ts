#!/usr/bin/env node
import { runIntrospectCli } from "./cli.js";

const exitCode = await runIntrospectCli(process.argv.slice(2));
process.exit(exitCode);
