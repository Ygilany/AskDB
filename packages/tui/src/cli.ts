import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAskDbLanguageModelFromEnv, suggestEnrichment } from "@askdb/core";
import { DEFAULT_INTROSPECT_OUTPUT_DIR, getAskDbRuntimeConfig } from "@askdb/config";
import { render } from "ink";
import { createElement } from "react";
import { App } from "./ui/App.js";
import { bundleSchemaDirectory, loadWorkspace } from "@askdb/enrich";
import type { SuggestEnrichmentForTui } from "@askdb/enrich";

type CliOptions = {
  schema?: string;
  help?: boolean;
  version?: boolean;
};

export async function runTuiCli(argv: readonly string[]): Promise<number> {
  if (argv[0] === "bundle") {
    return runBundleCli(argv.slice(1));
  }

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

  const schemaDir = opts.schema
    ? resolve(opts.schema)
    : resolve(getAskDbRuntimeConfig().flat["ASKDB_INTROSPECT_OUT"] ?? DEFAULT_INTROSPECT_OUTPUT_DIR);
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

  const suggest = await buildSuggester();
  const { waitUntilExit } = render(
    createElement(App, { workspace, suggest }),
  );
  try {
    await waitUntilExit();
    return 0;
  } catch (error) {
    process.stderr.write(`askdb-tui: ${formatError(error)}\n`);
    return 1;
  }
}

function runBundleCli(argv: readonly string[]): number {
  const schemaDir = argv[0];
  const outFlag = argv[1];
  const outPath = argv[2];
  if (!schemaDir || outFlag !== "--out" || !outPath) {
    process.stderr.write("Usage: askdb-tui bundle <schema-dir> --out <bundle.json>\n");
    return 1;
  }
  try {
    const bundle = bundleSchemaDirectory(resolve(schemaDir));
    writeFileSync(resolve(outPath), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote ${resolve(outPath)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`askdb-tui bundle: ${formatError(error)}\n`);
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
      "  askdb-tui [--schema <dir>]         Open a Schema v2 directory for enrichment",
      "  askdb-tui bundle <dir> --out <bundle.json>",
      "  askdb-tui --version               Print package version",
      "  askdb-tui --help                  Print this help",
      "",
      "  --schema <dir>  Schema v2 directory (default: introspection.outputDir from",
      "                  askdb.config, or ASKDB_INTROSPECT_OUT env, or ./askdb/)",
      "",
      "Schema input must be a Schema v2 directory produced by `askdb introspect`",
      "(Phase 6) or hand-authored. Bundled JSON is read-only and not yet supported",
      "as a TUI input.",
      "",
      "AI suggestions are enabled when ASKDB_AI_API_KEY (or OPENAI_API_KEY) is set.",
      "For Microsoft Foundry / Azure OpenAI: set ASKDB_AI_PROVIDER=azure plus",
      "ASKDB_AI_AZURE_RESOURCE_NAME (or ASKDB_AI_BASE_URL). Override the model",
      "with ASKDB_AI_MODEL, ASKDB_MODEL, or OPENAI_MODEL.",
      "",
    ].join("\n"),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function buildSuggester(): Promise<SuggestEnrichmentForTui | undefined> {
  const runtimeConfig = getAskDbRuntimeConfig();
  const model = await createAskDbLanguageModelFromEnv(runtimeConfig.ai.aiEnv);
  if (!model) return undefined;
  return (target, context) => suggestEnrichment(target, context, model);
}
