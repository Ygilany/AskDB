#!/usr/bin/env node
import {
  bootstrapAskDbEnv,
  getAskDbRuntimeConfig,
} from "@askdb/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAskDbHttpServer } from "./server.js";

type CliOptions = {
  schemaPath?: string;
  port?: number;
  host?: string;
  help?: boolean;
};

let cliOptions: CliOptions;
try {
  cliOptions = parseOptions(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`askdb-http: ${formatError(error)}\n\n`);
  printHelp(process.stderr);
  process.exit(1);
}

if (cliOptions.help) {
  printHelp(process.stdout);
  process.exit(0);
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  // When compiled, `here` is `.../apps/http-api/dist`, so repo root is 3 levels up.
  const repoRootEnv = resolve(here, "../../../.env");
  const cwdEnv = resolve(process.cwd(), ".env");
  const pkgEnv = resolve(here, "../.env");

  // Prefer repo root `.env`, but be resilient to different working directories.
  const candidates = [repoRootEnv, cwdEnv, pkgEnv].filter((p) => existsSync(p));
  bootstrapAskDbEnv({
    cwd: process.cwd(),
    dotenvCandidatePaths: candidates.length > 0 ? candidates : undefined,
  });
}

const { httpApi } = getAskDbRuntimeConfig();
const app = createAskDbHttpServer({
  port: cliOptions.port ?? httpApi.listen.port,
  host: cliOptions.host ?? httpApi.listen.host,
  schemaPath: cliOptions.schemaPath,
});
await app.listen();
console.log(`AskDB HTTP API listening on http://${app.host}:${app.port}`);

function parseOptions(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--schema-path":
        opts.schemaPath = readValue(argv, ++i, arg);
        break;
      case "--port": {
        const raw = readValue(argv, ++i, arg);
        const port = Number(raw);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`Invalid --port: ${raw}`);
        }
        opts.port = port;
        break;
      }
      case "--host":
        opts.host = readValue(argv, ++i, arg);
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function readValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printHelp(stream: NodeJS.WriteStream): void {
  stream.write(
    [
      "askdb-http - Standalone AskDB HTTP API server",
      "",
      "Usage:",
      "  askdb-http [--schema-path <path>] [--port <number>] [--host <host>]",
      "",
      "Options:",
      "  --schema-path <path>  Server-default schema artifact path",
      "  --port <number>       Port to listen on",
      "  --host <host>         Host to bind",
      "  -h, --help            Print this help",
      "",
      "CLI flags override askdb.config.ts values.",
      "",
    ].join("\n"),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
