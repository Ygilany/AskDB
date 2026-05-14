import { getAskDbRuntimeConfig } from "@askdb/config";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createStudioServer } from "./server.js";

type CliOptions = {
  schema?: string;
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

  if (opts.help || argv.length === 0) {
    printHelp(process.stdout);
    return 0;
  }

  if (!opts.schema) {
    process.stderr.write("askdb-studio: --schema <dir> is required.\n\n");
    printHelp(process.stderr);
    return 1;
  }

  let server;
  try {
    server = createStudioServer({
      schema: opts.schema,
      host: opts.host,
      port: opts.port,
    });
  } catch (error) {
    process.stderr.write(`askdb-studio: ${formatError(error)}\n`);
    return 1;
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
  const rt = getAskDbRuntimeConfig();
  const listen = rt.structured.studio?.listen;
  const portFromEnv = rt.ai.aiEnv.ASKDB_STUDIO_PORT;
  const parsedPort =
    listen?.port ??
    (portFromEnv !== undefined && portFromEnv.trim() !== "" ? Number(portFromEnv) : NaN);
  const opts: CliOptions = {
    host: listen?.host ?? rt.ai.aiEnv.ASKDB_STUDIO_HOST ?? "127.0.0.1",
    port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 5556,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--schema":
      case "-s":
        opts.schema = readValue(argv, ++i, arg);
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
      "askdb-studio - Local browser UI for AskDB Schema v2 enrichment",
      "",
      "Usage:",
      "  askdb-studio --schema <dir> [--port <number>] [--host <host>]",
      "",
      "Options:",
      "  -s, --schema <dir>   Schema v2 directory produced by `askdb introspect`",
      "  --port <number>      Port to listen on (default: 5556 or ASKDB_STUDIO_PORT)",
      "  --host <host>        Host to bind (default: 127.0.0.1 or ASKDB_STUDIO_HOST)",
      "  -V, --version        Print package version",
      "  -h, --help           Print this help",
      "",
      "AI enrichment and sample NL-to-SQL use OPENAI_API_KEY. Override the model",
      "with ASKDB_STUDIO_MODEL, ASKDB_MODEL, or OPENAI_MODEL.",
      "",
    ].join("\n"),
  );
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
