import type { AskDialect } from "@askdb/core";
import { generatePostgresSelectSql } from "./sql/generate.js";

/** Concrete `AskDialect` for PostgreSQL — validates and generates a single read-only SELECT. */
export type PostgresDialect = AskDialect;

/**
 * `AskDialect` adapter wired to the Postgres NL→SQL pipeline. Pass into `ask({ dialect })`
 * from `@askdb/core` to make the pipeline target PostgreSQL semantics.
 */
export const postgresDialect: PostgresDialect = {
  async generate(question, schema, model, options) {
    return generatePostgresSelectSql(question, schema, model, {
      generateText: options?.generateText,
      logger: options?.logger,
      explain: options?.explain,
      omitSensitiveIdentifiersFromNlToSqlPrompt:
        options?.omitSensitiveIdentifiersFromNlToSqlPrompt,
      prebuiltDdl: options?.prebuiltDdl,
    });
  },
};
