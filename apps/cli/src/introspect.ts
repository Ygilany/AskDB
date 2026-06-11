import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  createAskDbLogger,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  type AskDbLogLevel,
} from "@askdb/core";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  introspect,
  toV2SchemaJson,
  type Connector,
  type IntrospectResult,
  type IntrospectionFilters,
} from "@askdb/introspect";
import {
  createConnectorRegistry,
  type ConnectorConfig,
  type ConnectorProvider,
  type ConnectorResult,
} from "@askdb/connectors";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";
import { prismaConnectorProvider } from "@askdb/prisma";

const connectorRegistry = createConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  prismaConnectorProvider,
]);

type Engine = ConnectorProvider;
const LIVE_DRIVER_ENGINES = ["postgres", "mysql", "sqlite", "sqlserver"] as const satisfies ReadonlyArray<
  Exclude<Engine, "prisma">
>;

const INTROSPECT_EVENTS = {
  started: "askdb.introspect.started",
  completed: "askdb.introspect.completed",
  warning: "askdb.introspect.warning",
  error: "askdb.introspect.error",
} as const;

type CliOptions = {
  url?: string;
  fromExport?: string;
  prismaSchema?: string;
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
    if (argv.includes("--help") || argv.includes("-h")) {
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
  const engine = resolveEngine(opts.engine);
  if (engine === "prisma") {
    throw new Error("Prisma introspection reads schema files and does not provide SQL templates.");
  }
  const bundle = connectorRegistry.getTemplates(engine);
  if (!bundle) {
    throw new Error(
      `Engine '${engine}' does not provide SQL templates yet. 'askdb introspect templates' is currently supported only for --engine postgres.`,
    );
  }
  const body = bundle.templates
    .map((tpl) => [`-- ${tpl.name}`, tpl.sql, ""].join("\n"))
    .join("\n");
  process.stdout.write(body);
  return 0;
}

async function runIntrospectCommand(argv: readonly string[]): Promise<number> {
  const opts = parseOptions(argv);
  const rt = getAskDbRuntimeConfig();
  // When --engine isn't passed, fall back to the configured introspection.provider
  // so `askdb introspect` works flag-free for any configured engine.
  const engine = resolveEngine(opts.engine ?? rt.introspection.provider);
  if (engine === "postgres" && !opts.url && !opts.fromExport) {
    if (rt.introspection.postgresDatabaseUrl) {
      opts.url = rt.introspection.postgresDatabaseUrl;
    } else {
      throw new Error("Provide either --url <postgres-url> or --from-export <bundle-dir>.");
    }
  }
  // For the new live-driver engines, prefer the runtime-resolved per-engine
  // field (structured config -> provider-specific env -> DATABASE_URL fallback
  // for URL-shaped engines). SQLite has no DATABASE_URL fallback by design.
  if (engine === "mysql" && !opts.url) {
    if (rt.introspection.mysqlDatabaseUrl) opts.url = rt.introspection.mysqlDatabaseUrl;
    else
      throw new Error(
        "Provide --url <mysql-url> (or set introspection.providerConfig.mysql.databaseUrl / ASKDB_INTROSPECT_MYSQL_URL / DATABASE_URL).",
      );
  }
  if (engine === "sqlserver" && !opts.url) {
    if (rt.introspection.sqlserverDatabaseUrl) opts.url = rt.introspection.sqlserverDatabaseUrl;
    else
      throw new Error(
        "Provide --url <sqlserver-url> (or set introspection.providerConfig.sqlserver.databaseUrl / ASKDB_INTROSPECT_SQLSERVER_URL / DATABASE_URL).",
      );
  }
  if (engine === "sqlite" && !opts.url) {
    if (rt.introspection.sqliteFile) opts.url = rt.introspection.sqliteFile;
    else
      throw new Error(
        "Provide --url <path-to-sqlite-file> (or set introspection.providerConfig.sqlite.file / ASKDB_INTROSPECT_SQLITE_FILE).",
      );
  }
  if ((engine === "mysql" || engine === "sqlite" || engine === "sqlserver") && opts.fromExport) {
    throw new Error(
      `--from-export is currently supported only for --engine postgres (got ${engine}).`,
    );
  }
  if (engine === "postgres" && opts.prismaSchema) {
    throw new Error("Use --prisma-schema only with --engine prisma.");
  }
  if (engine === "prisma" && !opts.prismaSchema) {
    const fromConfig = rt.introspection.prismaSchemaPath;
    if (fromConfig) {
      opts.prismaSchema = fromConfig;
    }
    // When still unset, @askdb/prisma will auto-discover prisma/schema.prisma or schema.prisma at runtime.
  }
  if (engine === "prisma" && (opts.url || opts.fromExport)) {
    throw new Error("Use --prisma-schema with --engine prisma, not --url or --from-export.");
  }
  if (opts.url && opts.fromExport) {
    throw new Error("Use only one input mode: --url or --from-export.");
  }
  if (!opts.print && !opts.diff && !opts.out) {
    opts.out = rt.introspection.outputDir;
  }
  if (!opts.print && !opts.diff && !opts.out) {
    throw new Error(
      "Provide one output mode: --out <dir>, --print, or --diff <existing-dir> (or set ASKDB_INTROSPECT_OUT to default --out).",
    );
  }
  if ([opts.print, Boolean(opts.diff), Boolean(opts.out)].filter(Boolean).length > 1) {
    throw new Error("Use only one output mode: --out, --print, or --diff.");
  }

  const schemaId = opts.schemaId ?? inferSchemaId(opts.out ?? opts.diff) ?? "introspected";
  const logLevel = resolveLogLevel(opts, rt);
  const correlationId =
    opts.correlationId ?? rt.logging.correlationId ?? randomUUID();
  const logger = createAskDbLogger({
    correlationId,
    level: logLevel,
    logFile: opts.logFile ?? rt.logging.logFile,
    logStdout: opts.logStdout ?? rt.logging.logStdout,
  });

  const connectorConfig: ConnectorConfig = {
    provider: engine,
    url: opts.url,
    fromExport: opts.fromExport,
    schemaPath: opts.prismaSchema,
    filters: buildFilters(opts),
    schemaId,
  };
  const runConfig = connectorRegistry.createConnector(connectorConfig);

  logger.info(
    {
      event: INTROSPECT_EVENTS.started,
      mode: runConfig.mode,
      engine,
      schemaId,
      outputMode: opts.print ? "print" : opts.diff ? "diff" : "out",
    },
    "askdb introspection started",
  );

  try {
    const result = await runWithOutput(runConfig, opts, schemaId);
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
  runConfig: ConnectorResult,
  opts: CliOptions,
  schemaId: string,
): Promise<IntrospectResult> {
  const connector = runConfig.connector as Connector<unknown>;
  const input = runConfig.input;

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
      case "--prisma-schema":
        opts.prismaSchema = readValue(argv, ++i, arg);
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

function resolveEngine(engine = "postgres"): Engine {
  if (
    engine === "postgres" ||
    engine === "prisma" ||
    engine === "mysql" ||
    engine === "sqlite" ||
    engine === "sqlserver"
  ) {
    return engine;
  }
  const supported = [...LIVE_DRIVER_ENGINES, "prisma"].join(", ");
  throw new Error(`Unsupported introspection engine '${engine}' (expected one of: ${supported}).`);
}

function inferSchemaId(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(path);
  return name.endsWith(".schema") ? name.slice(0, -".schema".length) : name;
}

function resolveLogLevel(opts: CliOptions, rt: ReturnType<typeof getAskDbRuntimeConfig>): AskDbLogLevel {
  if (opts.logLevel !== undefined && opts.logLevel !== "") {
    const level = opts.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(level)) {
      throw new Error(
        `Invalid --log-level: ${opts.logLevel} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return level;
  }
  const env = rt.logging.level?.toLowerCase();
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
      "  askdb introspect                                    (Postgres: DATABASE_URL + ASKDB_INTROSPECT_OUT from askdb.config after bootstrap)",
      "  askdb introspect --out <dir>                        (uses DATABASE_URL from env/.env)",
      "  askdb introspect --url <postgres-url> --out <dir>",
      "  askdb introspect --from-export <bundle-dir> --out <dir>",
      "  askdb introspect --engine mysql --url <mysql-url> --out <dir>",
      "  askdb introspect --engine sqlite --url <path-to-.db> --out <dir>",
      "  askdb introspect --engine sqlserver --url <mssql-url> --out <dir>",
      "  askdb introspect --engine prisma --prisma-schema <schema.prisma|schema-dir> --out <dir>",
      "  askdb introspect --engine prisma --prisma-schema <schema.prisma|schema-dir> --print",
      "  askdb introspect --engine prisma --prisma-schema <schema.prisma|schema-dir> --diff <existing-dir>",
      "  askdb introspect --from-export <bundle-dir> --print",
      "  askdb introspect --from-export <bundle-dir> --diff <existing-dir>",
      "  askdb introspect templates --engine postgres",
      "",
      "Defaults (after askdb.config bootstrap):",
      "  ASKDB_INTROSPECT_POSTGRES_URL  From introspection.providerConfig.postgres.databaseUrl.",
      "  ASKDB_INTROSPECT_OUT           From introspection.outputDir (default ./askdb/) when you omit --out, --print, and --diff.",
      "  --prisma-schema       From introspection.providerConfig.prisma.schemaPath when set; otherwise",
      "                        prisma/schema.prisma or schema.prisma is auto-discovered in the project root.",
      "",
      "Options:",
      "  --schema-id <id>",
      "  --prisma-schema <schema.prisma|schema-dir>",
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
