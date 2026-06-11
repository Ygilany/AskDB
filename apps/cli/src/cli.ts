#!/usr/bin/env node
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import {
  aiKeyMissingMessage,
  createAiRegistry,
} from "@askdb/ai";
import { azureProvider } from "@askdb/ai-azure";
import { googleProvider } from "@askdb/ai-google";
import { openaiProvider } from "@askdb/ai-openai";
import { randomUUID } from "node:crypto";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  type AskDialectInput,
  type AskGenerateDeps,
  type BuiltInDialectId,
  SchemaParseError,
  SUPPORTED_DIALECT_IDS,
  formatAskDbModesV1,
  formatSupportedAskDbLogLevels,
  isBuiltInDialectId,
  isSupportedAskDbLogLevel,
  parseAskDbModeV1,
  SqlValidationError,
  ask,
  createAskDbLogger,
  loadSchema,
} from "@askdb/core";
import { Command } from "commander";
import { runInitCli } from "./init.js";
import { runIntrospectCli } from "./introspect.js";

const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider]);

// `askdb init` writes templates and should not require a valid askdb.config.
if (process.argv[2] !== "init") {
  bootstrapAskDbEnv({ cwd: process.cwd() });
}

if (process.argv[2] === "init") {
  process.exit(runInitCli(process.argv.slice(3)));
}

if (process.argv[2] === "introspect") {
  const exitCode = await runIntrospectCli(process.argv.slice(3));
  process.exit(exitCode);
}

if (process.argv[2] === "enrich") {
  process.exit(await runTuiCommand(process.argv.slice(3)));
}

if (process.argv[2] === "studio") {
  process.exit(await runStudioCommand(process.argv.slice(3)));
}

if (process.argv[2] === "bundle") {
  process.exit(await runTuiCommand(["bundle", ...process.argv.slice(3)]));
}

function printCliError(error: unknown): void {
  if (error instanceof SqlValidationError) {
    console.error(`${error.name} [${error.rule}]: ${error.message}`);
    if (error.hint) {
      console.error(`Hint: ${error.hint}`);
    }
    return;
  }
  if (error instanceof AskDbError) {
    console.error(`${error.name}: ${error.message}`);
    return;
  }
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }
  console.error(String(error));
}

async function runTuiCommand(args: string[]): Promise<number> {
  const { runTuiCli } = await import("@askdb/tui");
  return runTuiCli(args);
}

async function runStudioCommand(args: string[]): Promise<number> {
  const { runStudioCli } = await import("@askdb/studio");
  return runStudioCli(args);
}

function formatSchemaPathHint(schemaPath: string): string {
  return `Schema path: ${schemaPath}\nHint: Try \`fixtures/schemas/orders-users.schema/\` (v2 directory) as a known-good example.`;
}

function loadSchemaFromPath(schemaPath: string): ReturnType<typeof loadSchema> {
  try {
    return loadSchema(schemaPath);
  } catch (e) {
    const err = e as unknown as { code?: unknown; message?: unknown };
    const code = typeof err.code === "string" ? err.code : undefined;
    if (code === "ENOENT") {
      throw new AskDbError(`Schema path not found.\n${formatSchemaPathHint(schemaPath)}`, e);
    }
    if (code === "EACCES") {
      throw new AskDbError(`Schema path is not readable (permission denied).\n${formatSchemaPathHint(schemaPath)}`, e);
    }
    if (e instanceof SchemaParseError) {
      throw new AskDbError(`Failed to parse schema.\n${formatSchemaPathHint(schemaPath)}\nDetails: ${e.message}`, e);
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new AskDbError(`Failed to load schema.\n${formatSchemaPathHint(schemaPath)}\nDetails: ${msg}`, e);
  }
}

type SensitiveSqlReference = { table: string; column: string };
const SENSITIVE_SQL_WARNING_EVENT = "askdb.pipeline.sensitive_sql_warning" as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSensitiveReferencesInSql(
  sql: string,
  schema: Awaited<ReturnType<typeof loadSchemaFromPath>>,
): SensitiveSqlReference[] {
  const lower = sql.toLowerCase();
  const refs: SensitiveSqlReference[] = [];

  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (!t.sensitive && !c.sensitive) continue;

      const col = c.name.toLowerCase();
      const table = t.name.toLowerCase();
      const qualified = new RegExp(`\\b${escapeRegExp(table)}\\s*\\.\\s*${escapeRegExp(col)}\\b`, "i");
      const unqualified = new RegExp(`\\b${escapeRegExp(col)}\\b`, "i");

      if (qualified.test(lower) || unqualified.test(lower)) {
        refs.push({ table: t.name, column: c.name });
      }
    }
  }

  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.table}.${r.column}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
type ResolvedDialect = {
  dialect: AskDialectInput;
  source: "config" | "schema" | "default";
  note?: string;
};

const DIALECT_ID_LIST = SUPPORTED_DIALECT_IDS.join(", ");

/**
 * Resolve the NL→SQL dialect for an `ask` invocation.
 *
 * Priority: `askdb.config.dialect` → `schema.provider` (set by introspect) → `"postgres"`.
 * When config and schema disagree the config wins; the mismatch surfaces as a note
 * the caller can log/print so users know we ignored the schema's hint.
 *
 * Throws `AskDbError` when the schema persisted a provider id that has no shipped
 * `DialectSpec` (e.g. a Prisma `mysql` schema introspected before MySQL specs ship).
 */
function resolveAskDbDialect(
  configDialect: BuiltInDialectId | undefined,
  schemaProvider: string | undefined,
): ResolvedDialect {
  if (configDialect) {
    if (schemaProvider && schemaProvider !== configDialect) {
      return {
        dialect: configDialect,
        source: "config",
        note: `Using config.dialect '${configDialect}'; schema.json declared provider '${schemaProvider}'.`,
      };
    }
    return { dialect: configDialect, source: "config" };
  }
  if (schemaProvider) {
    if (!isBuiltInDialectId(schemaProvider)) {
      throw new AskDbError(
        `Schema declares provider '${schemaProvider}', but AskDB does not yet ship a DialectSpec for it.\n` +
          `Hint: set \`dialect: "postgres"\` (or another supported id) in askdb.config.ts to override. ` +
          `Supported: ${DIALECT_ID_LIST}.`,
      );
    }
    return { dialect: schemaProvider, source: "schema" };
  }
  return { dialect: "postgres", source: "default" };
}

function resolveAskDbLogLevel(opts: {
  verbose?: boolean;
  logLevel?: string;
  logFile?: string;
  logStdout?: boolean;
}): AskDbLogLevel {
  if (opts.logLevel !== undefined && opts.logLevel !== "") {
    const l = opts.logLevel.toLowerCase();
    if (!isSupportedAskDbLogLevel(l)) {
      throw new Error(
        `Invalid --log-level: ${opts.logLevel} (expected one of ${formatSupportedAskDbLogLevels()})`,
      );
    }
    return l;
  }
  const env = getAskDbRuntimeConfig().logging.level?.toLowerCase();
  if (env && isSupportedAskDbLogLevel(env)) {
    return env;
  }
  if (opts.verbose) {
    return "info";
  }
  if (opts.logFile || opts.logStdout) {
    return "info";
  }
  return "silent";
}

const program = new Command();
program.name("askdb").description("AskDB — natural language → PostgreSQL SELECT");

program
  .command("init")
  .description(
    "Create askdb.config.ts, then install @askdb/config + dotenv in the nearest non-workspace package (unless --skip-install)",
  )
  .option("-f, --force", "Overwrite an existing file", false)
  .option("--path <path>", "Output path for askdb.config.ts", "askdb.config.ts")
  .option("--skip-install", "Only write the file; do not install dependencies", false)
  .action((opts: { force?: boolean; path?: string; skipInstall?: boolean }) => {
    const args: string[] = [];
    if (opts.force) args.push("--force");
    if (opts.skipInstall) args.push("--skip-install");
    if (opts.path && opts.path !== "askdb.config.ts") args.push("--path", opts.path);
    process.exit(runInitCli(args));
  });

program
  .command("enrich")
  .description("Open the terminal UI for Schema v2 enrichment")
  .allowUnknownOption(true);

program
  .command("studio")
  .description("Start the local browser UI for Schema v2 enrichment")
  .allowUnknownOption(true);

program
  .command("bundle")
  .description("Bundle a Schema v2 directory into a single JSON file")
  .allowUnknownOption(true);

program
  .command("ask")
  .description("Generate SQL from schema + question")
  .requiredOption("-s, --schema <path>", "Path to AskDB Schema v2 directory, bundled JSON, or schema.json")
  .requiredOption("-q, --question <text>", "Natural language question")
  .option(
    "--explain",
    "After SQL, print a JSON block describing heuristic guardrails satisfied (Phase 2 explainability)",
    false,
  )
  .option("-v, --verbose", "Emit structured JSON logs (info) to stderr", false)
  .option("--log-level <level>", "Structured log level (trace|debug|info|warn|error|fatal|silent)")
  .option("--log-file <path>", "Append structured JSON logs to this file")
  .option("--log-stdout", "Mirror structured JSON logs to stdout", false)
  .option("--correlation-id <id>", "Correlation ID for logs (overrides ASKDB_CORRELATION_ID)")
  .option(
    "--mock-sql <sql>",
    "Deterministic NL→SQL for tests (bypasses live model call). Also via ASKDB_MOCK_SQL.",
  )
  .option(
    "--mode <id>",
    `Operating mode (${formatAskDbModesV1()}); default schema_only. Override with ASKDB_MODE`,
  )
  .option(
    "--omit-sensitive-from-prompt",
    "Omit sensitive column/table names from NL→SQL DDL (default: include names, tagged as sensitive)",
    false,
  )
  .action(
    async (opts: {
      schema: string;
      question: string;
      explain?: boolean;
      verbose?: boolean;
      logLevel?: string;
      logFile?: string;
      logStdout?: boolean;
      correlationId?: string;
      mockSql?: string;
      mode?: string;
      omitSensitiveFromPrompt?: boolean;
    }) => {
      let logLevel: AskDbLogLevel;
      let mode: AskDbModeV1;
      const runtime = getAskDbRuntimeConfig();
      try {
        logLevel = resolveAskDbLogLevel(opts);
        mode = parseAskDbModeV1(opts.mode ?? runtime.modes.askdbMode);
      } catch (e) {
        printCliError(e);
        process.exitCode = 1;
        return;
      }

      const correlationId =
        opts.correlationId ?? runtime.logging.correlationId ?? randomUUID();
      const logger = createAskDbLogger({
        correlationId,
        level: logLevel,
        logFile: opts.logFile ?? runtime.logging.logFile,
        logStdout: opts.logStdout ?? runtime.logging.logStdout,
      });

      const mockSql = opts.mockSql ?? runtime.dev.mockSql;
      const aiConfig = mockSql ? undefined : ai.resolveAiConfig(runtime.ai.aiEnv);
      if (!mockSql && !aiConfig) {
        console.error(aiKeyMissingMessage("NL→SQL generation"));
        console.error("Tip: in tests, set ASKDB_MOCK_SQL to bypass live model calls.");
        process.exitCode = 1;
        return;
      }
      logger.info(
        {
          event: AskDbLogEvent.RunStart,
          mode,
        },
        "askdb run start",
      );

      try {
        const schema = loadSchemaFromPath(opts.schema);
        const schemaProvider =
          "provider" in schema && typeof schema.provider === "string"
            ? schema.provider
            : undefined;
        const resolvedDialect = resolveAskDbDialect(
          runtime.nlToSql.dialect,
          schemaProvider,
        );
        if (resolvedDialect.note) {
          logger.info(
            {
              event: "askdb.pipeline.dialect_override",
              configDialect: runtime.nlToSql.dialect,
              schemaProvider,
              effectiveDialect: resolvedDialect.dialect,
            },
            resolvedDialect.note,
          );
          console.error(`Note: ${resolvedDialect.note}`);
        }

        type AskModel = Parameters<typeof ask>[0]["model"];
        const model: AskModel = mockSql
          ? // The model won't be used when `deps.generateText` is overridden.
            (undefined as unknown as AskModel)
          : ((await ai.createLanguageModelFromEnv(runtime.ai.aiEnv)) as AskModel);

        const omitSensitiveFromPrompt =
          Boolean(opts.omitSensitiveFromPrompt) || runtime.modes.omitSensitiveFromPrompt;

        const out = await ask({
          question: opts.question,
          schema,
          model,
          dialect: resolvedDialect.dialect,
          logger,
          mode,
          explain: Boolean(opts.explain),
          omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitiveFromPrompt,
          deps:
            mockSql !== undefined
              ? {
                  // `ai.generateText` has a rich return type; for test-mode we only need `text`.
                  generateText: (async () => ({ text: mockSql } as any)) as NonNullable<
                    AskGenerateDeps["generateText"]
                  >,
                }
              : undefined,
        });

        const sensitiveRefs = findSensitiveReferencesInSql(out.sql, schema);
        if (sensitiveRefs.length > 0) {
          const cols = sensitiveRefs.map((r: SensitiveSqlReference) => `${r.table}.${r.column}`);
          logger.info(
            {
              event: SENSITIVE_SQL_WARNING_EVENT,
              sensitiveColumnCount: cols.length,
              sensitiveColumns: cols,
            },
            "generated SQL references sensitive identifiers",
          );
          console.error(
            `Warning: generated SQL references sensitive columns: ${cols.join(", ")}\n` +
              "Review carefully before sharing or running this SQL outside AskDB.",
          );
        }

        console.log("-- sql --");
        console.log(`${out.sql};`);
        if (opts.explain) {
          console.log("-- explain --");
          console.log(JSON.stringify(out.explain ?? null, null, 2));
        }

        logger.info({ event: AskDbLogEvent.RunEnd, ok: true }, "askdb run end");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ event: AskDbLogEvent.RunError, errMessage: msg }, "askdb run error");
        printCliError(error);
        process.exitCode = 1;
      }
    },
  );

await program.parseAsync(process.argv);
