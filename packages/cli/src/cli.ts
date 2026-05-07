#!/usr/bin/env node
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createOpenAI } from "@ai-sdk/openai";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  type AskDbModeV1,
  type GenerateSqlDeps,
  SchemaParseError,
  formatAskDbModesV1,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  parseAskDbModeV1,
  SqlValidationError,
  type TabularResult,
  ask,
  createAskDbLogger,
  loadNormalizedSchemaFromJson,
} from "@askdb/core";
import { Command } from "commander";

// Load repo/local `.env` into process.env (if present).
// We treat missing `.env` as normal (developers may export env vars another way).
{
  const { error } = dotenv.config();
  if (error) {
    // ignore missing file; surface everything else
    const err = error as unknown as { code?: unknown; message?: unknown };
    const code = typeof err.code === "string" ? err.code : undefined;
    if (code !== "ENOENT") {
      console.error(`Failed to load .env: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

function printTsv(result: TabularResult): void {
  console.log(result.columns.join("\t"));
  for (const row of result.rows) {
    console.log(row.map((c) => (c === null || c === undefined ? "" : String(c))).join("\t"));
  }
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

function formatSchemaPathHint(schemaPath: string): string {
  return `Schema path: ${schemaPath}\nHint: Try \`fixtures/schemas/orders-users.schema.json\` as a known-good example.`;
}

async function loadSchemaFromPath(schemaPath: string): Promise<ReturnType<typeof loadNormalizedSchemaFromJson>> {
  try {
    const raw = await readFile(schemaPath, "utf8");
    return loadNormalizedSchemaFromJson(raw);
  } catch (e) {
    const err = e as unknown as { code?: unknown; message?: unknown };
    const code = typeof err.code === "string" ? err.code : undefined;
    if (code === "ENOENT") {
      throw new AskDbError(`Schema file not found.\n${formatSchemaPathHint(schemaPath)}`, e);
    }
    if (code === "EACCES") {
      throw new AskDbError(`Schema file is not readable (permission denied).\n${formatSchemaPathHint(schemaPath)}`, e);
    }
    if (e instanceof SchemaParseError) {
      throw new AskDbError(`Failed to parse schema JSON.\n${formatSchemaPathHint(schemaPath)}\nDetails: ${e.message}`, e);
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
  const env = process.env.ASKDB_LOG_LEVEL?.toLowerCase();
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
program.name("askdb").description("AskDB — natural language → PostgreSQL SELECT (Phase 1 CLI)");

program
  .command("ask")
  .description("Generate SQL from schema + question; optionally execute in read-only Postgres")
  .requiredOption("-s, --schema <path>", "Path to AskDB schema JSON v1 file")
  .requiredOption("-q, --question <text>", "Natural language question")
  .option("-e, --execute", "Execute generated SQL using DATABASE_URL (read-only transaction)")
  .option("--json", "With --execute: print rows as JSON (default is TSV)")
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
      execute?: boolean;
      json?: boolean;
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
      try {
        logLevel = resolveAskDbLogLevel(opts);
        mode = parseAskDbModeV1(opts.mode ?? process.env.ASKDB_MODE);
      } catch (e) {
        printCliError(e);
        process.exitCode = 1;
        return;
      }

      const correlationId =
        opts.correlationId ?? process.env.ASKDB_CORRELATION_ID ?? randomUUID();
      const logger = createAskDbLogger({
        correlationId,
        level: logLevel,
        logFile: opts.logFile,
        logStdout: opts.logStdout,
      });

      const mockSql = opts.mockSql ?? process.env.ASKDB_MOCK_SQL;
      const apiKey = process.env.OPENAI_API_KEY;
      if (!mockSql && !apiKey) {
        console.error("OPENAI_API_KEY is required for NL→SQL generation.");
        console.error("Tip: in tests, set ASKDB_MOCK_SQL to bypass live model calls.");
        process.exitCode = 1;
        return;
      }
      if (opts.execute && !process.env.DATABASE_URL) {
        console.error("--execute requires DATABASE_URL in the environment.");
        process.exitCode = 1;
        return;
      }

      logger.info(
        {
          event: AskDbLogEvent.RunStart,
          execute: Boolean(opts.execute),
          mode,
        },
        "askdb run start",
      );

      try {
        const schema = await loadSchemaFromPath(opts.schema);

        type AskModel = Parameters<typeof ask>[0]["model"];
        const model: AskModel = mockSql
          ? // The model won't be used when `deps.generateText` is overridden.
            (undefined as unknown as AskModel)
          : (() => {
              const openai = createOpenAI({
                apiKey: apiKey!,
                baseURL: process.env.OPENAI_BASE_URL,
              });
              const modelId = process.env.ASKDB_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
              return openai(modelId);
            })();

        const omitSensitiveFromPrompt =
          Boolean(opts.omitSensitiveFromPrompt) ||
          ["1", "true", "yes"].includes(
            (process.env.ASKDB_OMIT_SENSITIVE_FROM_PROMPT ?? "").toLowerCase(),
          );

        const out = await ask({
          question: opts.question,
          schema,
          model,
          execute: Boolean(opts.execute),
          connectionString: process.env.DATABASE_URL,
          logger,
          mode,
          explain: Boolean(opts.explain),
          omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitiveFromPrompt,
          deps:
            mockSql !== undefined
              ? {
                  // `ai.generateText` has a rich return type; for test-mode we only need `text`.
                  generateText: (async () => ({ text: mockSql } as any)) as NonNullable<
                    GenerateSqlDeps["generateText"]
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
              "Review carefully before executing or sharing results.",
          );
        }

        console.log("-- sql --");
        console.log(`${out.sql};`);
        if (opts.explain) {
          console.log("-- explain --");
          console.log(JSON.stringify(out.explain ?? null, null, 2));
        }
        if (out.result) {
          console.log("-- result --");
          if (opts.json) {
            console.log(JSON.stringify(out.result, null, 2));
          } else {
            printTsv(out.result);
          }
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
