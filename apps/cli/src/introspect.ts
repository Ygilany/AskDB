import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  connectorPackageMissingMessage,
  createConnectorRegistry,
  introspect,
  isSchemaV2Json,
  renderSchemaV2Body,
  type Connector,
  type ConnectorConfig,
  type ConnectorProviderId,
  type ConnectorRegistry,
  type ConnectorResult,
  type IntrospectResult,
  type IntrospectionFilters,
} from "@askdb/introspect";
import { createOptionalDriverLoader, rethrowDriverImportError } from "@askdb/introspect/kit";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";
import { labelled } from "./error-values.js";
import { createCliLogger } from "./logger.js";
import { PRISMA_BUILD_APPROVALS } from "./prisma-install.js";
import { requireAskDbConfig } from "./project-config.js";
import { readCliVersion } from "./version.js";

/**
 * `@askdb/prisma` is an optional peer of `askdb`: it pulls in Prisma, whose
 * `@prisma/engines` build pnpm 11 refuses to run unapproved (#259). It is
 * imported only when `--engine prisma` is selected, from this install first,
 * then from the project in the working directory, where `askdb init` installs
 * it (as with database drivers, so `npx askdb` finds it too).
 */
const prismaPackage = createOptionalDriverLoader({
  packageName: "@askdb/prisma",
  importDriver: () => import("@askdb/prisma").catch(rethrowDriverImportError),
  missingMessage: connectorPackageMissingMessage({
    provider: "prisma",
    packageName: "@askdb/prisma",
    allowBuilds: PRISMA_BUILD_APPROVALS,
  }),
});

/**
 * The engines `askdb introspect` supports out of the box. Engine-specific
 * connection resolution (flag vs. config precedence, per-engine validation)
 * lives in each adapter's `resolveConnection`, not here.
 */
export const defaultConnectorRegistry: ConnectorRegistry = createConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  { provider: "prisma", load: async () => (await prismaPackage.load()).prismaConnectorProvider },
]);

export type RunIntrospectCliOptions = {
  /** Registry to dispatch `--engine` through. Defaults to the built-in engines. */
  connectorRegistry?: ConnectorRegistry;
};

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

export async function runIntrospectCli(
  argv: readonly string[],
  options: RunIntrospectCliOptions = {},
): Promise<number> {
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${readCliVersion()}\n`);
    return 0;
  }
  const registry = options.connectorRegistry ?? defaultConnectorRegistry;
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp(registry);
    return 0;
  }
  const templates = argv[0] === "templates";
  // Only an introspection run reads askdb.config. A missing or broken config propagates to
  // the CLI's top-level error handler, the same as for `askdb ask`.
  if (!templates) requireAskDbConfig();
  try {
    return templates
      ? await runTemplatesCommand(argv.slice(1), registry)
      : await runIntrospectCommand(argv, registry);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

async function runTemplatesCommand(argv: readonly string[], registry: ConnectorRegistry): Promise<number> {
  const opts = parseOptions(argv);
  const engine = await resolveEngine(registry, opts.engine);
  const bundle = registry.getTemplates(engine);
  if (!bundle) {
    // Only loaded engines are named: loading the others would import optional engine
    // packages (`@askdb/prisma`) this command doesn't use. An unloaded lazy entry throws.
    const withTemplates = registry.providers().filter((id) => {
      try {
        return registry.getTemplates(id) !== undefined;
      } catch {
        return false;
      }
    });
    throw new Error(
      `Engine '${engine}' does not provide SQL templates yet. 'askdb introspect templates' is currently supported only for ` +
        (withTemplates.length > 0 ? withTemplates.map((id) => `--engine ${id}`).join(", ") : "engines that provide them") +
        ".",
    );
  }
  const body = bundle.templates
    .map((tpl) => [`-- ${tpl.name}`, tpl.sql, ""].join("\n"))
    .join("\n");
  process.stdout.write(body);
  return 0;
}

async function runIntrospectCommand(
  argv: readonly string[],
  registry: ConnectorRegistry,
): Promise<number> {
  const opts = parseOptions(argv);
  const rt = getAskDbRuntimeConfig();
  // When --engine isn't passed, fall back to the configured introspection.provider
  // so `askdb introspect` works flag-free for any configured engine.
  const engine = await resolveEngine(registry, opts.engine ?? rt.introspection.provider);
  // Schemas (MySQL/MariaDB: databases) to introspect: `--schemas` wins, then introspection.schemas.
  if (!opts.schemas && rt.introspection.schemas) {
    opts.schemas = rt.introspection.schemas;
  }
  // The engine's adapter merges flags with askdb.config/env (flags win) and
  // rejects flags that don't apply to it.
  const resolved = registry.resolveConnection(engine, {
    explicit: { url: opts.url, fromExport: opts.fromExport, schemaPath: opts.prismaSchema },
    runtime: rt,
    surface: "cli",
  });
  if (!resolved.ok) throw new Error(resolved.error);
  const { url, fromExport, schemaPath } = resolved.connection;
  if (url && fromExport) {
    throw new Error("Use only one input mode: --url or --from-export.");
  }
  if (!opts.print && !opts.diff && !opts.out) {
    opts.out = rt.introspection.outputDir;
  }
  if (!opts.print && !opts.diff && !opts.out) {
    throw new Error(
      "Provide one output mode: --out <dir>, --print, or --diff <existing-dir> (or set introspection.outputDir in askdb.config to default --out).",
    );
  }
  if ([opts.print, Boolean(opts.diff), Boolean(opts.out)].filter(Boolean).length > 1) {
    throw new Error("Use only one output mode: --out, --print, or --diff.");
  }

  const schemaId = opts.schemaId ?? inferSchemaId(opts.out ?? opts.diff) ?? "introspected";
  const logger = createCliLogger(opts, rt);

  const connectorConfig: ConnectorConfig = {
    provider: engine,
    url,
    fromExport,
    schemaPath,
    filters: buildFilters(opts),
    schemaId,
  };
  const runConfig = registry.createConnector(connectorConfig);

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
    const rendered = renderSchemaV2Body(result.schema, {
      schemaId,
      provider: result.provider,
    });
    process.stdout.write(rendered.body);
    return { ...result, warnings: [...result.warnings, ...rendered.warnings] };
  }

  if (opts.diff) {
    const result = await introspect(input, undefined, { connector });
    const existingPath = join(opts.diff, "schema.json");
    const hasExisting = existsSync(existingPath);
    // Render exactly what `--out <same dir>` would write: same provider, same
    // ID-anchored merge (human-set `sensitive` flags carried over). Otherwise
    // --diff reports "changed" against an untouched artifact.
    // An existing schema.json that isn't valid Schema v2 is compared without the
    // merge (reported as changed); every other render error propagates, as for --out.
    const rendered = renderSchemaV2Body(result.schema, {
      schemaId,
      provider: result.provider,
      existingArtifactDir: hasExisting && isValidSchemaFile(existingPath) ? opts.diff : undefined,
    });
    const existing = hasExisting ? readFileSync(existingPath, "utf8") : "";
    const changed = rendered.body !== existing && !sameJson(existing, rendered.json);
    process.stdout.write(
      `${JSON.stringify({ changed, schemaJsonPath: existingPath }, null, 2)}\n`,
    );
    return { ...result, warnings: [...result.warnings, ...rendered.warnings] };
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

/**
 * True when `path` holds valid Schema v2 JSON, by the renderer's own check
 * (`isSchemaV2Json`), so `{ "version": 2 }` without tables doesn't seed a merge.
 */
function isValidSchemaFile(path: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  return isSchemaV2Json(parsed);
}

/** Key-order-insensitive comparison so a reformatted-but-equivalent file is not "changed". */
function sameJson(existingBody: string, generated: unknown): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(existingBody), generated);
  } catch {
    return false;
  }
}

function buildFilters(opts: CliOptions): IntrospectionFilters | undefined {
  const filters: IntrospectionFilters = {};
  if (opts.schemas) filters.schemas = opts.schemas;
  if (opts.excludeSchemas) filters.excludeSchemas = opts.excludeSchemas;
  if (opts.tables) filters.tables = opts.tables;
  return Object.keys(filters).length > 0 ? filters : undefined;
}

/**
 * Every flag `askdb introspect` accepts. `parseOptions` and `printHelp` both read this table,
 * so the help can't leave out a flag the parser takes (#281).
 */
const INTROSPECT_FLAGS: readonly {
  /** Spellings, short form first: `["-v", "--verbose"]`. */
  names: readonly string[];
  /** Placeholder for the flag's value, e.g. `<dir>`; absent for a boolean flag. */
  value?: string;
  /** The help line; a function when it depends on the engines the registry holds. */
  help: string | ((registry: ConnectorRegistry) => string);
  apply(opts: CliOptions, value: string): void;
}[] = [
  {
    names: ["--engine"],
    value: "<id>",
    help: (registry) => `${registry.providers().join(", ")}. Default: introspection.provider.`,
    apply: (opts, value) => (opts.engine = value),
  },
  {
    names: ["--url"],
    value: "<url>",
    help: "Live database connection string (a file path for SQLite).",
    apply: (opts, value) => (opts.url = value),
  },
  {
    names: ["--from-export"],
    value: "<bundle-dir>",
    help: "Read a previously exported bundle instead of a live database. Postgres only.",
    apply: (opts, value) => (opts.fromExport = value),
  },
  {
    names: ["--prisma-schema"],
    value: "<schema.prisma|schema-dir>",
    help: "Prisma schema file or directory. With --engine prisma.",
    apply: (opts, value) => (opts.prismaSchema = value),
  },
  {
    names: ["--out"],
    value: "<dir>",
    help: "Write the schema artifact here. Default: introspection.outputDir.",
    apply: (opts, value) => (opts.out = value),
  },
  {
    names: ["--print"],
    help: "Print the introspection result without writing files.",
    apply: (opts) => (opts.print = true),
  },
  {
    names: ["--diff"],
    value: "<existing-dir>",
    help: "Diff the introspection result against an existing schema artifact.",
    apply: (opts, value) => (opts.diff = value),
  },
  {
    names: ["--schema-id"],
    value: "<id>",
    help: "Identifier written into schema.json. Default: the output directory's name.",
    apply: (opts, value) => (opts.schemaId = value),
  },
  {
    names: ["--schemas"],
    value: "<a,b>",
    help: "Database schemas to include (MySQL/MariaDB: databases). Default: introspection.schemas.",
    apply: (opts, value) => (opts.schemas = parseList(value)),
  },
  {
    names: ["--exclude-schemas"],
    value: "<a,b>",
    help: "Database schemas to skip.",
    apply: (opts, value) => (opts.excludeSchemas = parseList(value)),
  },
  {
    names: ["--tables"],
    value: "<glob[,glob]>",
    help: "Tables to include. Repeatable; values accumulate.",
    apply: (opts, value) => (opts.tables = [...(opts.tables ?? []), ...parseList(value)]),
  },
  {
    names: ["-v", "--verbose"],
    help: "Emit structured JSON logs (info) to stderr.",
    apply: (opts) => (opts.verbose = true),
  },
  {
    names: ["--log-level"],
    value: "<level>",
    help: "Structured log level (trace|debug|info|warn|error|fatal|silent). Default: logging.level.",
    apply: (opts, value) => (opts.logLevel = value),
  },
  {
    names: ["--log-file"],
    value: "<path>",
    help: "Append structured JSON logs to this file. Default: logging.logFile.",
    apply: (opts, value) => (opts.logFile = value),
  },
  {
    names: ["--log-stdout"],
    help: "Mirror structured JSON logs to stdout. Default: logging.logStdout.",
    apply: (opts) => (opts.logStdout = true),
  },
  {
    names: ["--correlation-id"],
    value: "<id>",
    help: "Correlation ID for logs. Default: logging.correlationId.",
    apply: (opts, value) => (opts.correlationId = value),
  },
];

const FLAG_BY_NAME = new Map(INTROSPECT_FLAGS.flatMap((flag) => flag.names.map((name) => [name, flag] as const)));

function parseOptions(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    // Errors never repeat an argument's value: it can be a connection string, password included.
    if (!arg.startsWith("-")) {
      throw new Error(
        "Unexpected argument: askdb introspect takes no positional arguments. Pass values with their flag, such as --url <url>.",
      );
    }
    // `--flag=value` works like `--flag value`, as in `askdb rag`.
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const flag = FLAG_BY_NAME.get(name);
    if (!flag) throw new Error(labelled("Unknown option", name));
    if (!flag.value) {
      if (inline !== undefined) throw new Error(`${name} takes no value.`);
      flag.apply(opts, "");
    } else if (inline === undefined) {
      flag.apply(opts, readValue(argv, ++i, name));
    } else {
      if (!inline) throw new Error(`${name} requires a value.`);
      flag.apply(opts, inline);
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

/** The registered engine, with its adapter loaded (an optional engine package is imported here). */
async function resolveEngine(registry: ConnectorRegistry, engine = "postgres"): Promise<ConnectorProviderId> {
  if (!registry.hasProvider(engine)) {
    const supported = registry.providers().join(", ");
    throw new Error(`Unsupported introspection engine '${engine}' (expected one of: ${supported}).`);
  }
  await registry.load(engine);
  return engine;
}

function inferSchemaId(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(path);
  return name.endsWith(".schema") ? name.slice(0, -".schema".length) : name;
}

function printHelp(registry: ConnectorRegistry): void {
  const optionLines = [
    ...INTROSPECT_FLAGS.map((flag) => ({
      usage: flag.names.join(", ") + (flag.value ? ` ${flag.value}` : ""),
      help: typeof flag.help === "function" ? flag.help(registry) : flag.help,
    })),
    // Handled before option parsing, in runIntrospectCli.
    { usage: "-V, --version", help: "Print the askdb version." },
    { usage: "-h, --help", help: "Print this help." },
  ];
  const width = Math.max(...optionLines.map((line) => line.usage.length)) + 2;
  process.stdout.write(
    [
      "askdb introspect - Schema introspection for AskDB",
      "",
      "Usage:",
      "  askdb introspect                                    (engine, connection and output directory from askdb.config)",
      "  askdb introspect --out <dir>",
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
      "Defaults from askdb.config (bind a value to an environment variable with env(\"NAME\")):",
      "  --url            For the engine introspection.provider names: introspection.providerConfig.<engine>.databaseUrl",
      "                   (SQLite: introspection.providerConfig.sqlite.file). With another --engine, pass --url.",
      "  --out            introspection.outputDir (default ./askdb/) when you omit --out, --print, and --diff.",
      "  --prisma-schema  introspection.providerConfig.prisma.schemaPath when set; otherwise",
      "                   prisma/schema.prisma or schema.prisma is auto-discovered in the project root.",
      "",
      "Options:",
      ...optionLines.map((line) => `  ${line.usage.padEnd(width)}${line.help}`),
      "",
    ].join("\n"),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
