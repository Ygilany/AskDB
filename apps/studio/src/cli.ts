import {
  DEFAULT_INTROSPECT_OUTPUT_DIR,
  discoverAskDbConfigPath,
  getAskDbRuntimeConfig,
} from "@askdb/config";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { isLoopbackHost } from "./request-guard.js";
import { createStudioServer, type StudioOptions } from "./server.js";

type CliOptions = {
  schema: string;
  /** True when --schema was passed explicitly (a missing explicit dir stays an error). */
  schemaFromFlag: boolean;
  host: string;
  port: number;
  help?: boolean;
  version?: boolean;
};

export async function runStudioCli(argv: readonly string[]): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseOptions(argv);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n\n`);
    printHelp(process.stderr);
    return 1;
  }

  if (opts.version) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }

  if (opts.help) {
    printHelp(process.stdout);
    return 0;
  }

  const setupReason = resolveSetupReason(opts);

  let server;
  try {
    server = createStudioServer({
      schema: opts.schema,
      host: opts.host,
      port: opts.port,
      setupReason,
    });
  } catch (error) {
    process.stderr.write(`askdb-studio: ${formatError(error)}\n`);
    return 1;
  }

  if (setupReason) {
    process.stdout.write(
      setupReason === "no-config"
        ? "No askdb.config.* found — Studio will open with the guided setup wizard.\n"
        : "No schema artifact found — Studio will open with the guided setup wizard.\n",
    );
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, resolve);
  }).catch((error) => {
    process.stderr.write(`askdb-studio: ${formatError(error)}\n`);
    return undefined;
  });

  const address = server.address();
  if (!address || typeof address === "string") return 1;
  const shownHost = opts.host === "0.0.0.0" ? firstPrivateAddress() ?? "127.0.0.1" : opts.host;
  process.stdout.write(`AskDB Studio is running at http://${shownHost}:${address.port}\n`);
  if (!isLoopbackHost(opts.host)) {
    process.stderr.write(formatNetworkExposureWarning(opts.host));
  }
  process.stdout.write("Press Ctrl+C to stop.\n");
  return await new Promise<number>((resolve) => {
    const stop = () => {
      server.close(() => resolve(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function parseOptions(argv: readonly string[]): CliOptions {
  // Without a config the runtime snapshot is uninitialized — fall back to
  // package defaults so Studio can still start (in setup mode).
  const rt = (() => {
    try {
      return getAskDbRuntimeConfig();
    } catch {
      return undefined;
    }
  })();
  const listen = rt?.structured.studio?.listen;
  const introspectOut = rt?.flat["ASKDB_INTROSPECT_OUT"] ?? DEFAULT_INTROSPECT_OUTPUT_DIR;
  const opts: CliOptions = {
    schema: introspectOut,
    schemaFromFlag: false,
    host: listen?.host ?? "127.0.0.1",
    port: 5556,
  };
  let portFromFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--schema":
      case "-s":
        opts.schema = readValue(argv, ++i, arg);
        opts.schemaFromFlag = true;
        break;
      case "--host":
        opts.host = readValue(argv, ++i, arg);
        break;
      case "--port": {
        const raw = readValue(argv, ++i, arg);
        const port = Number(raw);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`Invalid --port: ${raw}`);
        }
        opts.port = port;
        portFromFlag = true;
        break;
      }
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--version":
      case "-V":
        opts.version = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  // A bad configured port must fail, not quietly bind 5556. `NaN` (`Number(env("X"))` with X
  // unset) counts as unset, as it does in @askdb/config; a numeric string works like a number.
  const configPort = listen?.port;
  if (!portFromFlag && !opts.help && !opts.version && configPort !== undefined && !Number.isNaN(configPort)) {
    const port = Number(configPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(
        `Invalid studio.listen.port in askdb.config: ${String(configPort)} (expected an integer from 1 to 65535).`,
      );
    }
    opts.port = port;
  }

  return opts;
}

/**
 * Decide whether to start in setup mode. An explicitly passed `--schema` that
 * doesn't exist stays a hard error (the user pointed at a specific artifact);
 * a missing config or a missing *default* artifact opens the wizard instead.
 */
function resolveSetupReason(opts: CliOptions): StudioOptions["setupReason"] {
  if (!discoverAskDbConfigPath(process.cwd())) return "no-config";
  if (!opts.schemaFromFlag && !existsSync(resolve(opts.schema))) return "no-artifact";
  return null;
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
      "askdb-studio - Local browser UI for AskDB Schema v2 enrichment",
      "",
      "Usage:",
      "  askdb-studio [--schema <dir>] [--port <number>] [--host <host>]",
      "",
      "Options:",
      "  -s, --schema <dir>   Schema v2 directory (default: introspection.outputDir from",
      "                       askdb.config, or ./askdb/)",
      "  --port <number>      Port to listen on (default: studio.listen.port from askdb.config, or 5556)",
      "  --host <host>        Host to bind (default: studio.listen.host from askdb.config, or 127.0.0.1)",
      "  -V, --version        Print package version",
      "  -h, --help           Print this help",
      "",
      "AI enrichment and sample NL-to-SQL use the ai block in askdb.config: ai.provider,",
      "the key in ai.providerConfig.<provider>.apiKey, and the model in ai.language.model.",
      "Bind any value to an environment variable with env(\"NAME\").",
      "",
    ].join("\n"),
  );
}

function formatNetworkExposureWarning(host: string): string {
  return [
    "",
    `WARNING: Studio is bound to ${host}, which other machines on your network can reach.`,
    "Studio can execute SQL against your configured database and write schema files.",
    "Anyone who can load the Studio page from this address gets its session token and",
    "can use those features (setup, resync, and driver install stay loopback-only).",
    "Only do this on a network you trust; the default 127.0.0.1 keeps Studio local.",
    "",
    "",
  ].join("\n");
}

function firstPrivateAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

function readPackageVersion(): string {
  const pkgPath = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
