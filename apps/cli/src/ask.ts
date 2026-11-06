import { createAiRegistry } from "@askdb/ai";
import { createAskDb, type DialectResolution } from "@askdb/client";
import { getAskDbRuntimeConfig } from "@askdb/config";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  type AskGenerateDeps,
  formatAskDbModesV1,
  formatSensitiveReference,
  loadSchema,
  parseAskDbModeV1,
  SchemaParseError,
} from "@askdb/core";
import { printCliError } from "./cli-error.js";
import { runCommand, type CommandSpec, type Flag } from "./command.js";
import { createCliLogger, loggingFlags, resolveCliLogLevel, type CliLoggingFlags } from "./logger.js";

// Batteries-included surface: every built-in provider is registered, and each
// loads its @ai-sdk/* package only when first used, so env config alone
// selects the provider.
const ai = createAiRegistry();

type AskOptions = CliLoggingFlags & {
  schema?: string;
  question?: string;
  explain?: boolean;
  mockSql?: string;
  mode?: string;
  omitSensitiveFromPrompt?: boolean;
};

const ASK_FLAGS: readonly Flag<AskOptions>[] = [
  {
    names: ["-s", "--schema"],
    value: "<path>",
    help: "Schema v2 directory, bundled JSON, or schema.json. Default: introspection.outputDir, or ./askdb/.",
    apply: (opts, value) => (opts.schema = value),
  },
  {
    names: ["-q", "--question"],
    value: "<text>",
    help: "The natural-language question (required).",
    apply: (opts, value) => (opts.question = value),
  },
  {
    names: ["--mode"],
    value: "<id>",
    help: () =>
      `Operating mode (${formatAskDbModesV1()}). Can tighten config modes.askdbMode (default schema_only), never loosen it.`,
    apply: (opts, value) => (opts.mode = value),
  },
  {
    names: ["--explain"],
    help: "After the SQL, print a JSON block describing the heuristic guardrails satisfied.",
    apply: (opts) => (opts.explain = true),
  },
  {
    names: ["--omit-sensitive-from-prompt"],
    help: "Omit sensitive column/table names from the NL→SQL prompt. Default: include them, tagged as sensitive.",
    apply: (opts) => (opts.omitSensitiveFromPrompt = true),
  },
  {
    names: ["--mock-sql"],
    value: "<sql>",
    help: "Deterministic NL→SQL for tests (bypasses the live model call). Default: dev.mockSql.",
    apply: (opts, value) => (opts.mockSql = value),
  },
  ...loggingFlags<AskOptions>(),
];

/** `askdb ask`: SQL for one question, on stdout after `-- sql --`. */
export function askCommand(): CommandSpec<AskOptions> {
  return {
    name: "ask",
    summary: "Generate SQL from schema + question",
    usage: ['askdb ask --question "<text>" [--schema <path>] [--mode <id>] [--explain]'],
    flags: ASK_FLAGS,
    initial: () => ({}),
    check(opts) {
      if (opts.question === undefined) throw new Error("Missing --question <text>.");
    },
    needsConfig: () => true,
    run: runAsk,
  };
}

export function runAskCli(argv: readonly string[]): Promise<number> {
  return runCommand(askCommand(), argv);
}

async function runAsk(opts: AskOptions): Promise<number> {
  const question = opts.question!;
  let logLevel: AskDbLogLevel;
  // Only the flag is parsed here: the facade applies config `modes.askdbMode` (ADR 0025).
  let mode: AskDbModeV1 | undefined;
  const runtime = getAskDbRuntimeConfig();
  try {
    logLevel = resolveCliLogLevel(opts, runtime);
    mode = opts.mode === undefined ? undefined : parseAskDbModeV1(opts.mode);
  } catch (e) {
    printCliError(e);
    return 1;
  }

  const logger = createCliLogger(opts, runtime, logLevel);

  const mockSql = opts.mockSql ?? runtime.dev.mockSql;
  const aiConfig = mockSql ? undefined : ai.resolveAiConfig(runtime.ai.aiEnv);
  if (!mockSql && !aiConfig) {
    process.stderr.write(`${ai.keyMissingMessage("NL→SQL generation")}\n`);
    process.stderr.write("Tip: in tests, pass --mock-sql or set dev.mockSql in askdb.config to bypass live model calls.\n");
    return 1;
  }
  logger.info({ event: AskDbLogEvent.RunStart }, "askdb run start");

  try {
    const schema = loadSchemaFromPath(opts.schema ?? runtime.introspection.outputDir);

    const askdb = createAskDb({
      config: runtime,
      registry: ai,
      onResolve: (info: { dialect: DialectResolution; modelSource: "override" | "registry" | "mock" }) => {
        if (info.dialect.note) {
          logger.info({ event: "askdb.pipeline.dialect_override", note: info.dialect.note }, info.dialect.note);
          process.stderr.write(`Note: ${info.dialect.note}\n`);
        }
      },
    });

    const out = await askdb.ask(question, {
      schema: { schema },
      logger,
      ...(mode ? { mode } : {}),
      explain: Boolean(opts.explain),
      // The facade adds config `modes.omitSensitiveFromPrompt` as a floor.
      omitSensitiveIdentifiersFromNlToSqlPrompt: Boolean(opts.omitSensitiveFromPrompt),
      // When --mock-sql flag is set explicitly (not just from runtime config),
      // pass it as a per-call deps override so the flag wins over config.
      ...(opts.mockSql !== undefined
        ? {
            deps: {
              generateText: (async () => ({ text: opts.mockSql } as any)) as NonNullable<
                AskGenerateDeps["generateText"]
              >,
            },
          }
        : {}),
    });

    // `ask()` runs the sensitive-identifier guardrail in warn mode and emits
    // askdb.pipeline.sensitive_sql_warning through the logger above; the CLI
    // only renders it for the operator.
    const sensitive = out.sensitiveGuardrail;
    if (sensitive && sensitive.references.length > 0) {
      const cols = sensitive.references.map(formatSensitiveReference);
      process.stderr.write(
        `Warning: generated SQL references sensitive columns: ${cols.join(", ")}\n` +
          "Review carefully before sharing or running this SQL outside AskDB.\n",
      );
    }
    if (sensitive?.unresolvedScope) {
      process.stderr.write(`Note: ${sensitive.unresolvedScope.message}\n`);
    }

    process.stdout.write("-- sql --\n");
    process.stdout.write(`${out.sql}\n`);
    if (opts.explain) {
      process.stdout.write("-- explain --\n");
      process.stdout.write(`${JSON.stringify(out.explain ?? null, null, 2)}\n`);
    }

    logger.info({ event: AskDbLogEvent.RunEnd, ok: true }, "askdb run end");
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ event: AskDbLogEvent.RunError, errMessage: msg }, "askdb run error");
    printCliError(error);
    return 1;
  }
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
