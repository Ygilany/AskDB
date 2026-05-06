#!/usr/bin/env node
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createOpenAI } from "@ai-sdk/openai";
import {
  AskDbError,
  AskDbLogEvent,
  type AskDbLogLevel,
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
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
  .option("-v, --verbose", "Emit structured JSON logs (info) to stderr", false)
  .option("--log-level <level>", "Structured log level (trace|debug|info|warn|error|fatal|silent)")
  .option("--log-file <path>", "Append structured JSON logs to this file")
  .option("--log-stdout", "Mirror structured JSON logs to stdout", false)
  .option("--correlation-id <id>", "Correlation ID for logs (overrides ASKDB_CORRELATION_ID)")
  .action(
    async (opts: {
      schema: string;
      question: string;
      execute?: boolean;
      json?: boolean;
      verbose?: boolean;
      logLevel?: string;
      logFile?: string;
      logStdout?: boolean;
      correlationId?: string;
    }) => {
      let logLevel: AskDbLogLevel;
      try {
        logLevel = resolveAskDbLogLevel(opts);
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

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("OPENAI_API_KEY is required for NL→SQL generation.");
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
        },
        "askdb run start",
      );

      try {
        const raw = await readFile(opts.schema, "utf8");
        const schema = loadNormalizedSchemaFromJson(raw);

        const openai = createOpenAI({
          apiKey,
          baseURL: process.env.OPENAI_BASE_URL,
        });
        const modelId = process.env.ASKDB_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
        const model = openai(modelId);

        const out = await ask({
          question: opts.question,
          schema,
          model,
          execute: Boolean(opts.execute),
          connectionString: process.env.DATABASE_URL,
          logger,
        });

        console.log("-- sql --");
        console.log(`${out.sql};`);
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
