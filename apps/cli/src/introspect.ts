import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  createAskDbLogger,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  type AskDbLogLevel,
} from "@askdb/core";
import {
  introspect,
  toV2SchemaJson,
  type IntrospectResult,
  type IntrospectionFilters,
} from "@askdb/introspect";
import {
  createPostgresConnector,
  createPostgresCatalogQueryRunner,
  type PostgresIntrospectionInput,
} from "@askdb/postgres";

const INTROSPECT_EVENTS = {
  started: "askdb.introspect.started",
  completed: "askdb.introspect.completed",
  warning: "askdb.introspect.warning",
  error: "askdb.introspect.error",
} as const;

type CliOptions = {
  url?: string;
  fromExport?: string;
  out?: string;
  print?: boolean;
  diff?: string;
  engine?: string;
  schemaId?: string;
  schemas?: string[];
  excludeSchemas?: string[];
  tables?: string[];
  verbose?: boolean;
  logLevel?: string;
  logFile?: string;
  logStdout?: boolean;
  correlationId?: string;
};

export async function runIntrospectCli(argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes("--version") || argv.includes("-V")) {
      process.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    }
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      printHelp();
      return 0;
    }
    if (argv[0] === "templates") {
      return runTemplatesCommand(argv.slice(1));
    }
    return await runIntrospectCommand(argv);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

function runTemplatesCommand(argv: readonly string[]): number {
  const opts = parseOptions(argv);
  assertPostgresEngine(opts.engine);
  const bundle = createPostgresConnector().templates!();
  const body = bundle.templates
    .map((tpl) => [`-- ${tpl.name}`, tpl.sql, ""].join("\n"))
    .join("\n");
  process.stdout.write(body);
  return 0;
}

async function runIntrospectCommand(argv: readonly string[]): Promise<number> {
  const opts = parseOptions(argv);
  assertPostgresEngine(opts.engine);
  if (!opts.url && !opts.fromExport) {
    throw new Error("Provide either --url <postgres-url> or --from-export <bundle-dir>.");
  }
  if (opts.url && opts.fromExport) {
    throw new Error("Use only one input mode: --url or --from-export.");
  }
  if (!opts.print && !opts.diff && !opts.out) {
    throw new Error("Provide one output mode: --out <dir>, --print, or --diff <existing-dir>.");
  }
  if ([opts.print, Boolean(opts.diff), Boolean(opts.out)].filter(Boolean).length > 1) {
    throw new Error("Use only one output mode: --out, --print, or --diff.");
  }

  const schemaId = opts.schemaId ?? inferSchemaId(opts.out ?? opts.diff) ?? "introspected";
  const logLevel = resolveLogLevel(opts);
  const correlationId =
    opts.correlationId ?? process.env.ASKDB_CORRELATION_ID ?? randomUUID();
  const logger = createAskDbLogger({
    correlationId,
    level: logLevel,
    logFile: opts.logFile,
    logStdout: opts.logStdout,
  });

  const input = buildInput(opts);
  logger.info(
    {
      event: INTROSPECT_EVENTS.started,
      mode: input.mode,
      schemaId,
      outputMode: opts.print ? "print" : opts.diff ? "diff" : "out",
    },
    "askdb introspection started",
  );

  try {
    const result = await runWithOutput(input, opts, schemaId);
    for (const warning of result.warnings) {
      logger.info(
        { event: INTROSPECT_EVENTS.warning, warning },
        "askdb introspection warning",
      );
    }
    logger.info(
      {
        event: INTROSPECT_EVENTS.completed,
        ok: true,
        warningCount: result.warnings.length,
        isEmpty: result.isEmpty,
      },
      "askdb introspection completed",
    );
    return 0;
  } catch (error) {
    logger.error(
      { event: INTROSPECT_EVENTS.error, errMessage: formatError(error) },
      "askdb introspection failed",
    );
    throw error;
  }
}

async function runWithOutput(
  input: PostgresIntrospectionInput,
  opts: CliOptions,
  schemaId: string,
): Promise<IntrospectResult> {
  const connector = createPostgresConnector();
  if (opts.print) {
    const result = await introspect(input, undefined, { connector });
    process.stdout.write(`${JSON.stringify(toV2SchemaJson(result.schema, schemaId), null, 2)}\n`);
    return result;
  }

  if (opts.diff) {
    const result = await introspect(input, undefined, { connector });
    const generated = `${JSON.stringify(toV2SchemaJson(result.schema, schemaId), null, 2)}\n`;
    const existingPath = join(opts.diff, "schema.json");
    const existing = existsSync(existingPath) ? readFileSync(existingPath, "utf8") : "";
    process.stdout.write(
      `${JSON.stringify({ changed: generated !== existing, schemaJsonPath: existingPath }, null, 2)}\n`,
    );
    return result;
  }

  const outDir = opts.out!;
  return introspect(
    input,
    {
      outDir,
      schemaId,
      existingArtifactDir: existsSync(join(outDir, "schema.json")) ? outDir : undefined,
    },
    { connector },
  );
}

function buildInput(opts: CliOptions): PostgresIntrospectionInput {
  const filters = buildFilters(opts);
  if (opts.fromExport) {
    return { mode: "from-export", bundlePath: opts.fromExport, filters };
  }
  return {
    mode: "live",
    runner: createPostgresCatalogQueryRunner(opts.url!),
    filters,
  };
}

function buildFilters(opts: CliOptions): IntrospectionFilters | undefined {
  const filters: IntrospectionFilters = {};
  if (opts.schemas) filters.schemas = opts.schemas;
  if (opts.excludeSchemas) filters.excludeSchemas = opts.excludeSchemas;
  if (opts.tables) filters.tables = opts.tables;
  return Object.keys(filters).length > 0 ? filters : undefined;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--url":
        opts.url = readValue(argv, ++i, arg);
        break;
      case "--from-export":
        opts.fromExport = readValue(argv, ++i, arg);
        break;
      case "--out":
        opts.out = readValue(argv, ++i, arg);
        break;
      case "--print":
        opts.print = true;
        break;
      case "--diff":
        opts.diff = readValue(argv, ++i, arg);
        break;
      case "--engine":
        opts.engine = readValue(argv, ++i, arg);
        break;
      case "--schema-id":
        opts.schemaId = readValue(argv, ++i, arg);
        break;
      case "--schemas":
        opts.schemas = parseList(readValue(argv, ++i, arg));
        break;
      case "--exclude-schemas":
        opts.excludeSchemas = parseList(readValue(argv, ++i, arg));
        break;
      case "--tables":
        opts.tables = [...(opts.tables ?? []), ...parseList(readValue(argv, ++i, arg))];
        break;
      case "-v":
      case "--verbose":
        opts.verbose = true;
        break;
      case "--log-level":
        opts.logLevel = readValue(argv, ++i, arg);
        break;
      case "--log-file":
        opts.logFile = readValue(argv, ++i, arg);
        break;
      case "--log-stdout":
        opts.logStdout = true;
        break;
      case "--correlation-id":
        opts.correlationId = readValue(argv, ++i, arg);
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

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function assertPostgresEngine(engine = "postgres"): void {
  if (engine !== "postgres") {
    throw new Error(`Unsupported introspection engine '${engine}' (expected 'postgres').`);
  }
}

function inferSchemaId(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(path);
  return name.endsWith(".schema") ? name.slice(0, -".schema".length) : name;
}

function resolveLogLevel(opts: CliOptions): AskDbLogLevel {
  if (opts.logLevel !== undefined && opts.logLevel !== "") {
    const level = opts.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(level)) {
      throw new Error(
        `Invalid --log-level: ${opts.logLevel} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return level;
  }
  const env = process.env.ASKDB_LOG_LEVEL?.toLowerCase();
  if (env && isSupportedAskDbLogLevel(env)) return env;
  if (opts.verbose || opts.logFile || opts.logStdout) return "info";
  return "silent";
}

function readPackageVersion(): string {
  const pkgPath = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function printHelp(): void {
  process.stdout.write(
    [
      "askdb introspect - Schema introspection for AskDB",
      "",
      "Usage:",
      "  askdb introspect --url <postgres-url> --out <dir>",
      "  askdb introspect --from-export <bundle-dir> --out <dir>",
      "  askdb introspect --from-export <bundle-dir> --print",
      "  askdb introspect --from-export <bundle-dir> --diff <existing-dir>",
      "  askdb introspect templates --engine postgres",
      "",
      "Options:",
      "  --schema-id <id>",
      "  --schemas <a,b>",
      "  --exclude-schemas <a,b>",
      "  --tables <glob[,glob]>",
      "  --log-level <level>",
      "  --log-file <path>",
      "  --correlation-id <id>",
      "",
    ].join("\n"),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
