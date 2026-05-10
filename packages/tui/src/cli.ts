import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { App } from "./ui/App.js";
import { loadWorkspace } from "./workspace.js";

type CliOptions = {
  schema?: string;
  help?: boolean;
  version?: boolean;
};

export async function runTuiCli(argv: readonly string[]): Promise<number> {
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
    process.stderr.write("askdb-tui: --schema <dir> is required.\n\n");
    printHelp(process.stderr);
    return 1;
  }

  const schemaDir = resolve(opts.schema);
  if (!existsSync(schemaDir)) {
    process.stderr.write(`askdb-tui: schema directory not found: ${schemaDir}\n`);
    return 1;
  }

  let workspace;
  try {
    workspace = loadWorkspace(schemaDir);
  } catch (error) {
    process.stderr.write(`askdb-tui: ${formatError(error)}\n`);
    return 1;
  }

  const { waitUntilExit } = render(createElement(App, { workspace }));
  try {
    await waitUntilExit();
    return 0;
  } catch (error) {
    process.stderr.write(`askdb-tui: ${formatError(error)}\n`);
    return 1;
  }
}

function parseOptions(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--schema":
        opts.schema = readValue(argv, ++i, arg);
        break;
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

function readPackageVersion(): string {
  const pkgPath = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function printHelp(stream: NodeJS.WriteStream): void {
  stream.write(
    [
      "askdb-tui - Interactive Schema v2 enrichment for AskDB",
      "",
      "Usage:",
      "  askdb-tui --schema <dir>          Open a Schema v2 directory for enrichment",
      "  askdb-tui --version               Print package version",
      "  askdb-tui --help                  Print this help",
      "",
      "Schema input must be a Schema v2 directory produced by `askdb introspect`",
      "(Phase 6) or hand-authored. Bundled JSON is read-only and not yet supported",
      "as a TUI input.",
      "",
    ].join("\n"),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
