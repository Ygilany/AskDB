import type { AskDbExecutor } from "@askdb/core";
import type {
  Connector,
  IntrospectionFilters,
  IntrospectionResult,
  SqlTemplateBundle,
} from "@askdb/introspect";
import { describePostgresFromExport } from "./bundle.js";
import { describePostgres } from "./describe.js";
import { POSTGRES_TEMPLATE_BUNDLE } from "./templates.js";

/**
 * Connector input for the Postgres integration. Two modes:
 *
 * - `live` runs the catalog SQL suite through a `pg`-backed (or BYO) `AskDbExecutor`.
 * - `from-export` reads a directory of CSV/JSON files exported by an air-gapped operator
 *   running the same catalog SQL suite (`POSTGRES_TEMPLATE_BUNDLE`) in their environment.
 *
 * The shape is owned by `@askdb/postgres`; `@askdb/introspect` is engine-agnostic and does
 * not know about live vs. from-export modes.
 */
export type PostgresIntrospectionInput =
  | { mode: "live"; executor: AskDbExecutor; filters?: IntrospectionFilters }
  | { mode: "from-export"; bundlePath: string; filters?: IntrospectionFilters };

export function createPostgresConnector(): Connector<PostgresIntrospectionInput> {
  return {
    async describe(input: PostgresIntrospectionInput): Promise<IntrospectionResult> {
      if (input.mode === "from-export") {
        return describePostgresFromExport({
          bundlePath: input.bundlePath,
          filters: input.filters,
        });
      }
      return describePostgres({
        executor: input.executor,
        filters: input.filters,
      });
    },
    templates(): SqlTemplateBundle {
      return POSTGRES_TEMPLATE_BUNDLE;
    },
  };
}

export {
  POSTGRES_TEMPLATE_BUNDLE,
  POSTGRES_TEMPLATE_VERSION,
  POSTGRES_TEMPLATES,
  type PostgresSqlTemplateName,
} from "./templates.js";
export { describePostgres } from "./describe.js";
export type { DescribePostgresInput } from "./describe.js";
export { describePostgresFromExport } from "./bundle.js";
export type { DescribePostgresExportInput } from "./bundle.js";
